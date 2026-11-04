'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Minus, Plus, RotateCcw, Move3d } from 'lucide-react';
import type { AvatarConfig } from '@/lib/avatar-types';
import type { Avatar3DInstance } from '@/lib/avatar-3d-model';
import { buildStage, stageAction, stageAvatar, type AvatarStage } from '@/lib/avatar-stage';
import { detectQuality, supportsWebGL2 } from '@/lib/engine/quality';
import AvatarView from './AvatarView';

interface Props {
  avatar: AvatarConfig;
  action?: 'idle' | 'run' | 'jump' | 'shoot' | 'celebrate';
  className?: string;
  /** Show the zoom / reset buttons and the "drag to spin" hint. */
  controls?: boolean;
  /** Slow showcase spin until the player first touches it. */
  autoSpin?: boolean;
  testId?: string;
  /** Smaller buttons, no hint (small boxes like the profile card). */
  compact?: boolean;
}

const FOV = 30;
const MIN_ZOOM = 1;
const MAX_ZOOM = 2.8;
const BODY_FIT = 2.4; // world units of height framed at zoom 1 (head-to-toe plus halo/wings)
const BODY_CENTER = 1.0;

/**
 * Full 3D avatar you can turn and inspect.
 *  - Drag (finger or mouse) to spin, with inertia. Vertical swipes still scroll the page until
 *    you zoom in; then a vertical drag pans up and down the body.
 *  - Pinch, mouse wheel / trackpad, the +/− buttons or a double-tap to zoom (toward the point
 *    under your fingers). Horizontal trackpad scroll spins.
 *  - Arrow keys and +/− when focused.
 * Falls back to the 2D avatar when the device has no WebGL 2 or the context is lost.
 */
export default function Avatar3DView({ avatar, action = 'idle', className = '', controls = true, autoSpin = true, testId = 'avatar-3d', compact = false }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [box, setBox] = useState(0);
  const [hint, setHint] = useState(true);
  const api = useRef<{ setAvatar: (a: AvatarConfig) => void; setAction: (a: string) => void; zoomBy: (f: number) => void; reset: () => void } | null>(null);
  const latest = useRef({ avatar, action });
  useEffect(() => {
    latest.current = { avatar, action };
  }, [avatar, action]);
  const act = useCallback((kind: 'in' | 'out' | 'reset') => {
    const a = api.current;
    if (!a) return;
    if (kind === 'reset') a.reset();
    else a.zoomBy(kind === 'in' ? 1.35 : 1 / 1.35);
  }, []);

  // Measure for the 2D fallback.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox(Math.min(el.clientWidth, el.clientHeight)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    if (!supportsWebGL2()) {
      // Capability check on mount (server render can't know): show the 2D avatar instead.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }
    const q = detectQuality();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: q.tier !== 'low', alpha: true, powerPreference: 'default' });
    } catch {
      setFailed(true);
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.maxPixelRatio, 2));
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const lite = q.tier === 'low';
    let stage: AvatarStage;
    try {
      stage = buildStage(renderer, { shadows: q.shadows, env: !lite });
    } catch {
      renderer.dispose();
      setFailed(true);
      return;
    }
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 40);
    const turntable = new THREE.Group();
    stage.scene.add(turntable);

    let inst: Avatar3DInstance | null = null;
    let avatarKey = '';
    const setAvatar = (a: AvatarConfig) => {
      const k = JSON.stringify(a);
      if (k === avatarKey) return;
      avatarKey = k;
      if (inst) {
        turntable.remove(inst.group);
        inst.dispose();
      }
      inst = stageAvatar(a, lite);
      turntable.add(inst.group);
      dirty = true;
    };
    let curAction = latest.current.action as string;
    const setAction = (a: string) => {
      curAction = a;
    };

    // ---- view state ----
    const DEFAULT_YAW = 0.35;
    const DEFAULT_PITCH = 0.1;
    let yaw = DEFAULT_YAW;
    let pitch = DEFAULT_PITCH;
    let zoom = 1;
    let panY = 0; // target height offset (only meaningful when zoomed in)
    let spinVel = 0; // rad/s inertia
    let touched = false;
    let dirty = true;
    let width = 1;
    let height = 1;

    const baseDist = () => BODY_FIT / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / Math.min(1, width / height);
    const visibleH = () => (2 * (baseDist() / zoom) * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    const clampPan = () => {
      const room = Math.max(0, (BODY_FIT - visibleH()) / 2 + 0.1);
      panY = Math.max(-room, Math.min(room, panY));
    };
    const setTouchAction = () => {
      // Unzoomed: vertical swipes keep scrolling the page. Zoomed: every drag is ours (pan).
      host.style.touchAction = zoom > 1.02 ? 'none' : 'pan-y';
    };
    /** Zoom by `factor`, keeping the body point under screen-y `sy` (0..1 from top) still. */
    const zoomAt = (factor: number, sy = 0.4) => {
      const before = BODY_CENTER + panY + (0.5 - sy) * visibleH();
      zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
      const after = BODY_CENTER + panY + (0.5 - sy) * visibleH();
      panY += before - after;
      if (zoom === MIN_ZOOM) panY = 0;
      clampPan();
      setTouchAction();
      dirty = true;
      markTouched();
    };
    const markTouched = () => {
      if (!touched) {
        touched = true;
        setHint(false);
      }
    };
    const reset = () => {
      yaw = DEFAULT_YAW;
      pitch = DEFAULT_PITCH;
      zoom = 1;
      panY = 0;
      spinVel = 0;
      setTouchAction();
      dirty = true;
    };

    // ---- input ----
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let lastMoveT = 0;
    let lastTap = 0;
    const rect = () => host.getBoundingClientRect();
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      host.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      spinVel = 0;
      lastMoveT = performance.now();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      // double-tap / double-click: zoom in on that spot, or back out
      const now = performance.now();
      if (pointers.size === 1 && now - lastTap < 300) {
        const r = rect();
        if (zoom > 1.3) reset();
        else zoomAt(2.4 / zoom, (e.clientY - r.top) / r.height);
        lastTap = 0;
      } else lastTap = now;
    };
    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      const r = rect();
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) zoomAt(d / pinchDist, ((a.y + b.y) / 2 - r.top) / r.height);
        pinchDist = d;
        return;
      }
      const now = performance.now();
      const dtm = Math.max(1, now - lastMoveT) / 1000;
      lastMoveT = now;
      const dYaw = (dx / Math.max(200, r.width)) * Math.PI * 1.25;
      yaw += dYaw;
      spinVel = spinVel * 0.6 + (dYaw / dtm) * 0.4;
      if (zoom > 1.02) {
        panY += (dy / r.height) * visibleH();
        clampPan();
      } else if (e.pointerType === 'mouse') {
        pitch = Math.max(-0.2, Math.min(0.55, pitch + dy * 0.005));
      }
      if (Math.abs(dx) + Math.abs(dy) > 2) markTouched();
      dirty = true;
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (performance.now() - lastMoveT > 80) spinVel = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = rect();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        yaw -= e.deltaX * 0.006;
        markTouched();
        dirty = true;
      } else zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), (e.clientY - r.top) / r.height);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') yaw -= 0.25;
      else if (e.key === 'ArrowRight') yaw += 0.25;
      else if (e.key === 'ArrowUp' && zoom > 1) panY += 0.1;
      else if (e.key === 'ArrowDown' && zoom > 1) panY -= 0.1;
      else if (e.key === '+' || e.key === '=') return zoomAt(1.25);
      else if (e.key === '-' || e.key === '_') return zoomAt(0.8);
      else if (e.key === '0') return reset();
      else return;
      e.preventDefault();
      clampPan();
      markTouched();
      dirty = true;
    };
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('keydown', onKey);
    setTouchAction();

    // ---- size ----
    const resize = () => {
      width = Math.max(1, host.clientWidth);
      height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      clampPan();
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    setAvatar(latest.current.avatar);

    // ---- loop (paused off-screen / in background tabs) ----
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let visible = true;
    const minFrame = q.tier === 'low' ? 1000 / 30 : 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const elapsed = now - last;
      if (elapsed < minFrame) return;
      const dt = Math.min(0.05, elapsed / 1000);
      last = now;
      t += dt;
      if (!pointers.size && Math.abs(spinVel) > 0.01) {
        yaw += spinVel * dt;
        spinVel *= Math.exp(-dt * 3.5);
      } else if (!touched && autoSpin) yaw += dt * 0.35;
      if (!inst) return;
      inst.updateAnimation(t, stageAction(latest.current.avatar, curAction) as never, dt);
      turntable.rotation.y = yaw;
      const dist = baseDist() / zoom;
      const ty = BODY_CENTER + panY;
      camera.position.set(0, ty + Math.sin(pitch) * dist, Math.cos(pitch) * dist);
      camera.lookAt(0, ty, 0);
      renderer.render(stage.scene, camera);
      if (dirty) {
        host.dataset.yaw = yaw.toFixed(2);
        host.dataset.zoom = zoom.toFixed(2);
        host.dataset.ready = '1';
        dirty = false;
      }
    };
    const start = () => {
      if (!raf && visible && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const io = new IntersectionObserver((es) => {
      visible = es.some((x) => x.isIntersecting);
      if (visible) start();
      else stop();
    });
    io.observe(host);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    const onLost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    start();

    api.current = { setAvatar, setAction, zoomBy: (f) => zoomAt(f), reset };

    return () => {
      api.current = null;
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onUp);
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('keydown', onKey);
      inst?.dispose();
      stage.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
    // The scene is built once; avatar / action changes are pushed in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.setAvatar(avatar);
  }, [avatar]);
  useEffect(() => {
    api.current?.setAction(action);
  }, [action]);

  if (failed) {
    return (
      <div ref={hostRef} className={`flex items-center justify-center ${className}`} data-testid={testId} data-fallback="2d">
        {box > 0 && <AvatarView avatar={avatar} size={Math.round(box * 0.95)} action={action} flat />}
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className={`${/\babsolute\b/.test(className) ? '' : 'relative'} select-none outline-none cursor-grab active:cursor-grabbing ${className}`}
      data-testid={testId}
      tabIndex={0}
      role="img"
      aria-label="3D avatar preview. Drag to spin, pinch or scroll to zoom."
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
      {controls && (
        <>
          {hint && !compact && (
            <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold text-white/85 backdrop-blur">
              <Move3d className="w-3.5 h-3.5" /> Drag to spin · pinch to zoom
            </div>
          )}
          <div className={`absolute right-2 bottom-2 flex flex-col ${compact ? 'gap-1' : 'gap-1.5'}`}>
            {[
              { icon: Plus, label: 'Zoom in', kind: 'in' as const, id: 'zoom-in' },
              { icon: Minus, label: 'Zoom out', kind: 'out' as const, id: 'zoom-out' },
              { icon: RotateCcw, label: 'Reset view', kind: 'reset' as const, id: 'reset-view' },
            ].map(({ icon: Icon, label, kind, id }) => (
              <button
                key={id}
                type="button"
                onClick={() => act(kind)}
                aria-label={label}
                data-testid={`avatar-${id}`}
                className={`${compact ? 'w-7 h-7' : 'w-9 h-9'} rounded-full bg-black/60 border border-white/15 text-white flex items-center justify-center backdrop-blur active:scale-95 hover:bg-black/80`}
              >
                <Icon className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
