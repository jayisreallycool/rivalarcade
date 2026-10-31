import * as THREE from 'three';
import type { GameEngine } from './GameEngine';

/**
 * Reusable neon-arcade set pieces. Everything here is procedural (no asset downloads)
 * and batched: whole skylines and starfields render in a single draw call each.
 */

function canvasTexture(engine: GameEngine, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = engine.own(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, engine.renderer.capabilities.getMaxAnisotropy());
  return tex;
}

/**
 * Large surfaces (floors, skylines) dominate pixel cost. On the low tier they render unlit:
 * the glow texture becomes the colour map, which reads almost identically in a dark neon
 * scene and skips all per-pixel lighting.
 */
function surfaceMaterial(engine: GameEngine, params: THREE.MeshPhysicalMaterialParameters): THREE.Material {
  if (engine.quality.tier === 'low' && params.emissiveMap) {
    const k = typeof params.emissiveIntensity === 'number' ? params.emissiveIntensity : 1;
    return new THREE.MeshBasicMaterial({ map: params.emissiveMap, color: new THREE.Color(k, k, k) });
  }
  // Glossy surfaces get a clear-coat layer: neon and light strips reflect in them like wet asphalt.
  return params.clearcoat ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
}

/** Glowing grid floor. Scroll `texture.offset.y` to fake forward motion for free. */
export function createNeonGridFloor(
  engine: GameEngine,
  opts: { width: number; length: number; color?: string; base?: string; cells?: [number, number]; lineWidth?: number; glow?: number; /** 0–1 wet/polished clear coat. */ gloss?: number },
) {
  const color = opts.color ?? '#00f0ff';
  const base = opts.base ?? '#0b0d16';
  const lw = opts.lineWidth ?? 4;
  const emissive = canvasTexture(engine, 128, 128, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(0, 0, 128, 128);
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = lw * 3;
    ctx.strokeRect(0, 0, 128, 128);
  });
  emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
  const [cx, cz] = opts.cells ?? [Math.round(opts.width / 2), Math.round(opts.length / 2)];
  emissive.repeat.set(cx, cz);

  const material = surfaceMaterial(engine, {
    color: base,
    roughness: 0.55,
    metalness: 0.35,
    emissive: new THREE.Color(1, 1, 1),
    emissiveMap: emissive,
    emissiveIntensity: opts.glow ?? 0.6,
    ...(opts.gloss ? { clearcoat: opts.gloss, clearcoatRoughness: 0.08, roughness: 0.4 } : {}),
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(opts.width, opts.length), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = engine.quality.shadows;
  return { mesh, texture: emissive, material };
}

/** Instanced skyline with lit windows; one draw call regardless of building count. */
export function createCityscape(
  engine: GameEngine,
  opts: { count: number; zMin: number; zMax: number; xInner: number; xOuter: number; heightMin?: number; heightMax?: number; seed?: number },
) {
  const windows = canvasTexture(engine, 64, 128, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 64, 128);
    const palette = ['#00f0ff', '#ff0055', '#ffb800', '#8b5cf6', '#ffffff'];
    for (let y = 4; y < 128; y += 8) {
      for (let x = 4; x < 64; x += 8) {
        if (Math.random() < 0.35) {
          ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
          ctx.globalAlpha = 0.35 + Math.random() * 0.65;
          ctx.fillRect(x, y, 4, 4);
        }
      }
    }
  });
  windows.wrapS = windows.wrapT = THREE.RepeatWrapping;
  windows.repeat.set(1, 3);

  const count = Math.max(4, Math.round(opts.count * engine.quality.propDensity));
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0); // pivot at base
  const mat = surfaceMaterial(engine, {
    color: '#0b0d18',
    roughness: 0.85,
    metalness: 0.2,
    emissive: new THREE.Color(1, 1, 1),
    emissiveMap: windows,
    emissiveIntensity: 0.7,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const hMin = opts.heightMin ?? 12;
  const hMax = opts.heightMax ?? 40;
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const w = 3 + Math.random() * 5;
    const h = hMin + Math.random() * (hMax - hMin);
    p.set(side * (opts.xInner + Math.random() * (opts.xOuter - opts.xInner)), -1, opts.zMin + Math.random() * (opts.zMax - opts.zMin));
    s.set(w, h, 3 + Math.random() * 5);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** Distant stars/dust: one Points draw call. */
export function createStarfield(engine: GameEngine, opts: { count: number; radius: number; color?: string; size?: number; yMin?: number }) {
  const count = Math.round(opts.count * engine.quality.propDensity);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.9);
    const r = opts.radius * (0.6 + Math.random() * 0.4);
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    positions[i * 3 + 1] = Math.max(opts.yMin ?? 2, Math.cos(phi) * r);
    positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: opts.color ?? '#9feaff',
    size: opts.size ?? 0.18,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    fog: false,
  });
  return new THREE.Points(geo, mat);
}

/** Soft fake contact shadow: keeps characters grounded on tiers without shadow maps. */
export function createBlobShadow(engine: GameEngine, radius = 0.6, opacity = 0.55) {
  const tex = canvasTexture(engine, 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  return mesh;
}

/** Thin emissive ring/line pieces used for arena trims. Bright enough to bloom. */
export function neonMaterial(color: THREE.ColorRepresentation, intensity = 2.2) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false });
}

/** Standard 3-light neon arena rig (hemi + key + coloured rim). Key light respects shadow tier. */
export function addArenaLights(
  engine: GameEngine,
  opts: { sky?: THREE.ColorRepresentation; ground?: THREE.ColorRepresentation; hemi?: number; key?: number; keyPos?: [number, number, number]; rim?: THREE.ColorRepresentation; rimPos?: [number, number, number]; shadowFrustum?: number } = {},
) {
  const hemi = new THREE.HemisphereLight(opts.sky ?? 0x5fe8ff, opts.ground ?? 0x181a28, opts.hemi ?? 1.1);
  const key = new THREE.DirectionalLight(0xffffff, opts.key ?? 2.0);
  key.position.set(...(opts.keyPos ?? [6, 14, 9]));
  engine.configureShadows(key, opts.shadowFrustum);
  const rim = new THREE.DirectionalLight(opts.rim ?? 0xff2d7a, 1.1);
  rim.position.set(...(opts.rimPos ?? [-8, 6, -10]));
  engine.scene.add(hemi, key, key.target, rim);
  return { hemi, key, rim };
}
