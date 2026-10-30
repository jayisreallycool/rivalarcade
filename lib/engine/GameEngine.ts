import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { detectQuality, QualityProfile } from './quality';

/**
 * RivalArcade 3D engine.
 *
 * One instance per mounted game. It owns the renderer, scene, camera, post-processing,
 * frame loop and every GPU resource, so games only describe their world and their rules.
 *
 *  - Quality tiers (lib/engine/quality.ts) decide pixel ratio, shadows, bloom, particle caps.
 *  - Neon bloom via EffectComposer (RenderPass → UnrealBloomPass → OutputPass).
 *  - Adaptive resolution: pixel ratio drops when frames run long, recovers when they are fast.
 *  - The loop pauses when the tab is hidden, the canvas is scrolled off-screen,
 *    or the WebGL context is lost, and resumes cleanly (no giant delta spike).
 *  - ResizeObserver on the host element (not window resize) so modals/rotations resize correctly.
 *  - dispose() frees every geometry, material and texture in the scene plus anything
 *    registered with own(), then releases the WebGL context.
 */

export type Updater = (dt: number, elapsed: number) => void;

export interface EngineOptions {
  background: THREE.ColorRepresentation;
  fog?: { color?: THREE.ColorRepresentation; density: number };
  camera: {
    fov: number;
    near?: number;
    far?: number;
    position: [number, number, number];
    lookAt: [number, number, number];
  };
  exposure?: number;
  bloom?: { strength?: number; radius?: number; threshold?: number };
  /** Frame-time budget the adaptive resolution aims for. Default 60. */
  targetFps?: number;
}

export interface EngineStats {
  fps: number;
  frameMs: number;
  pixelRatio: number;
  tier: QualityProfile['tier'];
  drawCalls: number;
  triangles: number;
}

const MAX_STEP = 1 / 20; // clamp simulation step so a hitch never teleports objects

export class GameEngine {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly quality: QualityProfile;

  private readonly host: HTMLElement;
  private readonly timer = new THREE.Timer();
  private readonly updaters = new Set<Updater>();
  private readonly owned = new Set<{ dispose: () => void }>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private baseBloomStrength = 0;
  private bloomKick = 0;

  private rafId = 0;
  private running = false;
  private pageVisible = true;
  private onScreen = true;
  private contextLost = false;
  private disposed = false;

  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;

  // adaptive resolution
  private pixelRatio: number;
  private readonly frameBudgetMs: number;
  private windowFrames = 0;
  private windowTime = 0;
  private goodWindows = 0;
  private upgradesLeft = 3;
  private lastFps = 0;
  private lastFrameMs = 0;

  private statsEl: HTMLDivElement | null = null;

  constructor(host: HTMLElement, options: EngineOptions) {
    this.host = host;
    this.quality = detectQuality();
    this.frameBudgetMs = 1000 / (options.targetFps ?? 60);

    const width = Math.max(1, host.clientWidth || 640);
    const height = Math.max(1, host.clientHeight || 360);

    // Scene
    this.scene.background = new THREE.Color(options.background);
    if (options.fog) {
      this.scene.fog = new THREE.FogExp2(options.fog.color ?? options.background, options.fog.density);
    }

    // Camera
    const c = options.camera;
    this.camera = new THREE.PerspectiveCamera(c.fov, width / height, c.near ?? 0.1, c.far ?? 150);
    this.camera.position.set(...c.position);
    this.camera.lookAt(...c.lookAt);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.quality.antialias && !this.quality.bloom,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = options.exposure ?? 1.2;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Count draw calls across every composer pass, reset once per frame (see frame()).
    this.renderer.info.autoReset = false;

    const canvas = this.renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.replaceChildren(canvas);

    // Post-processing (neon bloom)
    if (this.quality.bloom) {
      // High tier keeps edges clean with multisampled HDR targets (canvas MSAA is bypassed by the composer).
      const target = new THREE.WebGLRenderTarget(width * this.pixelRatio, height * this.pixelRatio, {
        type: THREE.HalfFloatType,
        samples: this.quality.antialias ? 4 : 0,
      });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(this.pixelRatio);
      composer.setSize(width, height);
      composer.addPass(new RenderPass(this.scene, this.camera));

      const b = options.bloom ?? {};
      this.baseBloomStrength = b.strength ?? 0.7;
      const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), this.baseBloomStrength, b.radius ?? 0.25, b.threshold ?? 0.85);
      // Render bloom mips at reduced resolution — the blur hides it and it is the most expensive pass.
      const scale = this.quality.bloomResolutionScale;
      const baseSetSize = bloom.setSize.bind(bloom);
      bloom.setSize = (w: number, h: number) => baseSetSize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      composer.setSize(width, height);

      this.composer = composer;
      this.bloomPass = bloom;
    }

    this.bindLifecycle(canvas);

    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fps')) {
      this.statsEl = document.createElement('div');
      this.statsEl.style.cssText =
        'position:absolute;left:6px;bottom:6px;z-index:30;font:10px/1.3 ui-monospace,monospace;color:#7dfcff;background:rgba(0,0,0,.6);padding:3px 6px;border-radius:4px;pointer-events:none;white-space:pre';
      host.parentElement?.appendChild(this.statsEl);
    }
  }

  // ---------------------------------------------------------------- lifecycle

  private readonly onVisibility = () => {
    this.pageVisible = document.visibilityState !== 'hidden';
    this.syncRunning();
  };

  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    this.syncRunning();
  };

  private readonly onContextRestored = () => {
    this.contextLost = false;
    this.syncRunning();
  };

  private bindLifecycle(canvas: HTMLCanvasElement) {
    document.addEventListener('visibilitychange', this.onVisibility);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.host);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        this.onScreen = entries.some((e) => e.isIntersecting);
        this.syncRunning();
      });
      this.intersectionObserver.observe(this.host);
    }
  }

  /** Begin rendering. Safe to call more than once. */
  start() {
    this.running = true;
    this.syncRunning();
  }

  private syncRunning() {
    const shouldRun = this.running && this.pageVisible && this.onScreen && !this.contextLost && !this.disposed;
    if (shouldRun && !this.rafId) {
      this.timer.reset();
      this.timer.update(performance.now());
      this.rafId = requestAnimationFrame(this.frame);
    } else if (!shouldRun && this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private readonly frame = (timestamp: number) => {
    this.rafId = requestAnimationFrame(this.frame);
    this.timer.update(timestamp);
    const realDt = this.timer.getDelta();
    const dt = Math.min(realDt, MAX_STEP);
    const elapsed = this.timer.getElapsed();

    this.renderer.info.reset();
    for (const fn of this.updaters) fn(dt, elapsed);

    if (this.bloomPass) {
      this.bloomKick = Math.max(0, this.bloomKick - dt * 2.5);
      this.bloomPass.strength = this.baseBloomStrength + this.bloomKick;
    }

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.adapt(realDt);
  };

  // ------------------------------------------------------- adaptive resolution

  private adapt(realDt: number) {
    if (realDt <= 0 || realDt > 0.5) return; // ignore resume gaps
    this.windowFrames++;
    this.windowTime += realDt;
    if (this.windowTime < 1) return;

    const avgMs = (this.windowTime / this.windowFrames) * 1000;
    this.lastFps = this.windowFrames / this.windowTime;
    this.lastFrameMs = avgMs;
    this.windowFrames = 0;
    this.windowTime = 0;

    const { minPixelRatio, maxPixelRatio } = this.quality;
    const cap = Math.min(window.devicePixelRatio || 1, maxPixelRatio);

    if (avgMs > this.frameBudgetMs * 1.3 && this.pixelRatio > minPixelRatio) {
      this.setPixelRatio(Math.max(minPixelRatio, this.pixelRatio - 0.15));
      this.goodWindows = 0;
    } else if (avgMs < this.frameBudgetMs * 1.08 && this.pixelRatio < cap && this.upgradesLeft > 0) {
      // Recover slowly, and only a few times, so we never oscillate.
      if (++this.goodWindows >= 4) {
        this.setPixelRatio(Math.min(cap, this.pixelRatio + 0.1));
        this.goodWindows = 0;
        this.upgradesLeft--;
      }
    } else {
      this.goodWindows = 0;
    }

    if (this.statsEl) {
      const info = this.renderer.info.render;
      this.statsEl.textContent = `${this.quality.tier.toUpperCase()}  ${this.lastFps.toFixed(0)} fps  ${avgMs.toFixed(1)} ms\npx ${this.pixelRatio.toFixed(2)}  calls ${info.calls}  tris ${info.triangles}`;
    }
  }

  private setPixelRatio(pr: number) {
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.composer?.setPixelRatio(pr);
    this.resize();
  }

  resize() {
    if (this.disposed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
  }

  // ------------------------------------------------------------------ API

  /** Register per-frame logic. Returns an unsubscribe function. */
  addUpdate(fn: Updater): () => void {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  /** Track a resource that may not live in the scene graph (pooled meshes' shared geo/materials, textures…). */
  own<T extends { dispose: () => void }>(resource: T): T {
    this.owned.add(resource);
    return resource;
  }

  /** Apply the quality tier's shadow settings to a light. */
  configureShadows(light: THREE.DirectionalLight | THREE.SpotLight, frustum = 14) {
    light.castShadow = this.quality.shadows;
    if (!this.quality.shadows) return;
    light.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.02;
    if (light instanceof THREE.DirectionalLight) {
      const cam = light.shadow.camera;
      cam.left = -frustum;
      cam.right = frustum;
      cam.top = frustum;
      cam.bottom = -frustum;
      cam.near = 0.5;
      cam.far = 60;
      cam.updateProjectionMatrix();
    }
  }

  /** Raycast from a screen point against objects. Allocation-free apart from the result array. */
  raycast(clientX: number, clientY: number, objects: THREE.Object3D[], recursive = true) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.intersectObjects(objects, recursive);
  }

  /** Brief bloom flare for impacts, scores, combos. */
  flash(amount = 0.6) {
    this.bloomKick = Math.min(1.5, this.bloomKick + amount);
  }

  get elapsed() {
    return this.timer.getElapsed();
  }

  getStats(): EngineStats {
    const info = this.renderer.info.render;
    return {
      fps: this.lastFps,
      frameMs: this.lastFrameMs,
      pixelRatio: this.pixelRatio,
      tier: this.quality.tier,
      drawCalls: info.calls,
      triangles: info.triangles,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.syncRunning();
    this.updaters.clear();

    document.removeEventListener('visibilitychange', this.onVisibility);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.statsEl?.remove();

    disposeObjectTree(this.scene);
    this.owned.forEach((r) => r.dispose());
    this.owned.clear();
    this.scene.clear();

    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
  }
}

/** Dispose every geometry, material and texture under root (each exactly once). */
export function disposeObjectTree(root: THREE.Object3D) {
  const seen = new Set<{ dispose: () => void }>();
  const add = (d: { dispose: () => void } | null | undefined) => {
    if (d) seen.add(d);
  };
  root.traverse((obj) => {
    const o = obj as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    add(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      add(m);
      for (const value of Object.values(m)) {
        if (value instanceof THREE.Texture) add(value);
      }
    }
    if (obj instanceof THREE.InstancedMesh) add(obj);
  });
  seen.forEach((d) => d.dispose());
}
