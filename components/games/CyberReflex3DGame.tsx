'use client';

import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import {
  CameraFeel,
  Pool,
  ParticleBursts,
  addArenaLights,
  createFirstPersonRig,
  createNeonGridFloor,
  createStarfield,
  neonMaterial,
  useGameEngine,
  useLatest,
  useStructuralMemo,
  useThrottledHud,
} from '@/lib/engine';
import { GameProps } from '@/lib/game-types';
import { mulberry32, randomSeed } from '@/lib/rng';
import GameShell, { PopupApi, useSwipe } from './GameShell';
import { Pointer, Hand, ShieldAlert } from 'lucide-react';

type CyberReflex3DProps = GameProps;

type NodeType = 'target' | 'hazard' | 'bonus';
const NODE_COLORS: Record<NodeType, number> = { target: 0x00f0ff, hazard: 0xff0055, bonus: 0xffb800 };
const ROUND_SECONDS = 40;
const RING_START = 2.4;
/**
 * Difficulty by time into the round (same for every player): k goes 0 → 1 over RAMP_SECONDS.
 * Early: one or two slow targets at a time, no hazards, a wide "perfect" window.
 * Late: up to five fast nodes, red hazards mixed in, a tight perfect window.
 */
const RAMP_SECONDS = 32;
const rampK = (elapsed: number) => {
  const x = Math.min(1, Math.max(0, elapsed / RAMP_SECONDS));
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const CLUTCH_SECONDS = 10;
const TOUCH_SLOP = 46; // px: a near-miss tap still counts on phones
const EYE_Y = 1.62;
/** Nodes are seen up close in first person, so they are drawn smaller than in the old overhead view. */
const NODE_SCALE = 0.62;

interface NodeObj {
  group: THREE.Group;
  orb: THREE.Mesh;
  ring: THREE.Mesh;
  type: NodeType;
  ringScale: number;
}

type Phase = 'ready' | 'playing' | 'over';

export default function CyberReflex3DGame({ avatar, onFinish, seed, rival, match, onExit }: CyberReflex3DProps) {
  const seedRef = useLatest(seed);
  const rngRef = useRef(mulberry32(seed ?? randomSeed()));
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS, clutch: false });
  const popups = useRef<PopupApi | null>(null);
  const hitRef = useRef<(x: number, y: number, isTap: boolean) => void>(() => {});
  const resetWorldRef = useRef<() => void>(() => {});
  const flashRef = useRef<HTMLDivElement | null>(null);
  const hitFlash = useCallback(() => {
    const el = flashRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = '1';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 500ms ease-out';
      el.style.opacity = '0';
    });
  }, []);

  const fresh = () => ({ playing: true, score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS, spawnTimer: 0, clutchAnnounced: false, hits: 0, perfects: 0, hazards: 0, pHits: 0, pPerfect: 0, pStreak: 0, pClutch: 0, pHazard: 0 });
  const sim = useRef({ ...fresh(), playing: false });

  const startGame = useCallback(() => {
    Object.assign(sim.current, fresh());
    rngRef.current = mulberry32(seedRef.current ?? randomSeed());
    resetWorldRef.current();
    pushHud({ score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS, clutch: false }, true);
    setPhase('playing');
  }, [pushHud, seedRef]);

  // Tap a node, or slash across several in one stroke.
  const surface = useSwipe({
    onDrag: (sw, ph) => {
      if (ph === 'start') hitRef.current(sw.startX, sw.startY, true);
      else if (ph === 'move') hitRef.current(sw.endX, sw.endY, false);
    },
  });

  const { hostRef } = useGameEngine(
    {
      background: 0x080911,
      fog: { density: 0.03 },
      camera: { fov: 70, near: 0.03, far: 90, position: [0, EYE_Y, 0], lookAt: [0, EYE_Y, -10] },
      exposure: 1.1,
      bloom: { strength: 0.5, radius: 0.28, threshold: 0.9 },
      environment: 0.65,
      ao: true,
      studio: { top: 0x1a1640, left: 0x00f0ff, right: 0x8b5cf6 },
    },
    (engine) => {
      const { scene, camera } = engine;

      // First person: you stand on the command platform and nodes materialise in front of you.
      // Node spots are seeded as screen fractions + depth, so every player sees the same layout
      // on any screen shape; the lens widens on tall phones.
      engine.onResize((_w, _h, aspect) => {
        camera.fov = aspect < 0.6 ? 76 : aspect < 0.8 ? 70 : 60;
        camera.updateProjectionMatrix();
      });
      const feel = new CameraFeel();
      let lookX = 0;
      let lookY = 0;

      addArenaLights(engine, { sky: 0x00f0ff, ground: 0x1a1233, hemi: 1.2, key: 1.8, keyPos: [6, 12, 8], rim: 0x8b5cf6, shadowFrustum: 6 });

      const floor = createNeonGridFloor(engine, { width: 60, length: 60, cells: [30, 30], color: '#8b5cf6', lineWidth: 2, glow: 0.45, gloss: 0.9 });
      scene.add(floor.mesh);
      scene.add(createStarfield(engine, { count: 600, radius: 50, yMin: 3 }));

      // Command platform
      const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 0.4, 48), new THREE.MeshPhysicalMaterial({ color: 0x121424, roughness: 0.25, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.06 }));
      platform.position.y = 0.2;
      platform.receiveShadow = engine.quality.shadows;
      const pRing = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.035, 8, 96), neonMaterial(0x00f0ff, 1.2));
      pRing.rotation.x = -Math.PI / 2;
      pRing.position.y = 0.42;
      scene.add(platform, pRing);

      // Orbiting halo rings for depth
      const halo = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(4.2 + i * 0.9, 0.015, 6, 128), neonMaterial(i === 1 ? 0x8b5cf6 : 0x00f0ff, 1.2));
        r.rotation.x = Math.PI / 2 + (i - 1) * 0.25;
        halo.add(r);
      }
      halo.position.set(0, 2.2, -9);
      scene.add(halo);

      // Your arms: the right hand fires the laser.
      const arms = createFirstPersonRig(engine, stableAvatar, { spread: 0.24, drop: 0.42, depth: 0.5 });
      let recoil = 0;
      const muzzle = new THREE.Vector3();

      // Laser beam (one reusable mesh, stretched between avatar and target)
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
      const beamGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true);
      beamGeo.rotateX(Math.PI / 2); // align with +Z for lookAt
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.visible = false;
      scene.add(beam);
      let beamLife = 0;

      const particles = new ParticleBursts(engine);

      // Shared node resources: 1 orb geo + 1 ring geo + 3 orb mats + 3 ring mats, regardless of spawns
      const orbGeo = engine.own(new THREE.DodecahedronGeometry(0.5));
      const ringGeo = engine.own(new THREE.TorusGeometry(0.62, 0.04, 8, 32));
      const orbMats = {} as Record<NodeType, THREE.Material>;
      const ringMats = {} as Record<NodeType, THREE.Material>;
      (Object.keys(NODE_COLORS) as NodeType[]).forEach((t) => {
        orbMats[t] = engine.own(new THREE.MeshPhysicalMaterial({ color: NODE_COLORS[t], emissive: NODE_COLORS[t], emissiveIntensity: 0.55, roughness: 0.12, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.4, envMapIntensity: 1.6 }));
        ringMats[t] = engine.own(neonMaterial(NODE_COLORS[t], 1.4));
      });

      const pool = new Pool<NodeObj>(
        () => {
          const orb = new THREE.Mesh(orbGeo);
          const ring = new THREE.Mesh(ringGeo);
          const group = new THREE.Group();
          group.add(orb, ring);
          return { group, orb, ring, type: 'target', ringScale: RING_START };
        },
        (n) => scene.add(n.group),
        (n) => scene.remove(n.group),
      );
      pool.warm(6);
      const nodes: NodeObj[] = [];
      const hitTargets: THREE.Object3D[] = [];
      const tmp = new THREE.Vector3();

      const removeNode = (i: number) => {
        pool.release(nodes[i]);
        nodes.splice(i, 1);
      };

      resetWorldRef.current = () => {
        while (nodes.length) removeNode(nodes.length - 1);
        particles.clear();
      };

      const scr = new THREE.Vector3();
      /** Node under (x, y) in surface px: exact raycast first, then nearest node within the touch slop. */
      const pickNode = (x: number, y: number) => {
        const r = engine.renderer.domElement.getBoundingClientRect();
        hitTargets.length = 0;
        nodes.forEach((n) => hitTargets.push(n.group));
        const hits = engine.raycast(r.left + x, r.top + y, hitTargets, true);
        if (hits.length) {
          const idx = nodes.findIndex((n) => n.orb === hits[0].object || n.ring === hits[0].object);
          if (idx >= 0) return idx;
        }
        let best = -1;
        let bestD = TOUCH_SLOP;
        nodes.forEach((n, i) => {
          n.group.getWorldPosition(scr);
          const p = engine.toScreen(scr);
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        return best;
      };

      hitRef.current = (x, y, isTap) => {
        const s = sim.current;
        if (!s.playing) return;
        const idx = pickNode(x, y);
        if (idx < 0) {
          // Only a deliberate tap on empty space breaks the streak; slashing between nodes doesn't.
          if (isTap && s.combo !== 0) {
            s.combo = 0;
            pushHud({ combo: 0 }, true);
          }
          return;
        }
        const node = nodes[idx];
        node.group.getWorldPosition(tmp);
        const sp = engine.toScreen(tmp);
        const clutch = s.timeLeft <= CLUTCH_SECONDS ? 2 : 1;

        if (node.type === 'hazard') {
          const loss = Math.min(s.score, 150 * clutch);
          s.score -= loss;
          s.pHazard -= loss;
          s.hazards += 1;
          if (s.combo >= 5) popups.current?.banner('STREAK BROKEN', '#fb7185');
          s.combo = 0;
          sound.playLose();
          haptic('fail');
          feel.kick(0.7);
          hitFlash();
          particles.emit(tmp, 0xff0055, { count: 30, speed: 6 });
          popups.current?.pop(`-${loss}`, sp.x, sp.y, { color: '#fb7185', size: 'md' });
        } else {
          const accurate = Math.abs(node.ringScale - 1.0) < lerp(0.42, 0.22, rampK(ROUND_SECONDS - s.timeLeft));
          const bonus = node.type === 'bonus' ? 2 : 1;
          const hitBase = 160 * bonus;
          const perfectBase = accurate ? 90 * bonus : 0;
          s.combo += 1;
          s.bestCombo = Math.max(s.bestCombo, s.combo);
          const mult = Math.min(5, 1 + Math.floor(s.combo / 5));
          const pre = hitBase + perfectBase;
          const pts = pre * mult * clutch;
          s.pHits += hitBase;
          s.pPerfect += perfectBase;
          s.pStreak += pre * (mult - 1);
          s.pClutch += pre * mult * (clutch - 1);
          s.score += pts;
          s.hits += 1;
          if (accurate) s.perfects += 1;
          sound.playScore(1 + (s.combo % 8) * 0.1);
          haptic(accurate ? 'score' : 'light');
          engine.flash(accurate ? 0.55 : 0.25);
          particles.emit(tmp, NODE_COLORS[node.type], { count: accurate ? 28 : 16, speed: accurate ? 6 : 4 });
          popups.current?.pop(`+${pts}`, sp.x, sp.y - 18, { color: accurate ? '#fde047' : '#7df9ff', size: pts >= 1000 ? 'lg' : 'md' });
          if (accurate) popups.current?.pop('PERFECT', sp.x, sp.y + 16, { color: '#fde047', size: 'sm' });
          if (s.combo > 0 && s.combo % 5 === 0) popups.current?.banner(`STREAK ×${mult}`, '#7df9ff');
          // Laser from your right hand to the node; the view leans toward it a touch.
          recoil = 1;
          feel.kick(0.18);
          arms.right.hand.getWorldPosition(muzzle);
          beamMat.color.setHex(NODE_COLORS[node.type]).multiplyScalar(2);
          beam.position.copy(muzzle).lerp(tmp, 0.5);
          beam.scale.set(1, 1, muzzle.distanceTo(tmp));
          beam.lookAt(tmp);
          beam.visible = true;
          beamLife = 0.18;
          lookX = THREE.MathUtils.clamp(tmp.x * 0.05, -0.25, 0.25);
          lookY = THREE.MathUtils.clamp((tmp.y - EYE_Y) * 0.05, -0.15, 0.15);
        }
        pushHud({ score: s.score, combo: s.combo, bestCombo: s.bestCombo }, true);
        removeNode(idx);
      };

      const finish = () => {
        const s = sim.current;
        s.playing = false;
        sound.playWin();
        haptic('big');
        const breakdown = [
          { label: `Targets hit (${s.hits})`, points: s.pHits },
          { label: `Perfect timing (${s.perfects})`, points: s.pPerfect },
          { label: `Streak multiplier (best ${s.bestCombo})`, points: s.pStreak },
          { label: 'Clutch time ×2', points: s.pClutch },
          { label: `Hazards hit (${s.hazards})`, points: s.pHazard },
        ].filter((b) => b.points !== 0);
        pushHud({ timeLeft: 0, score: s.score, clutch: false }, true);
        setPhase('over');
        onFinishRef.current(s.score, { maxCombo: s.bestCombo, breakdown });
      };

      engine.addUpdate((dt, t) => {
        const s = sim.current;

        halo.rotation.y += dt * 0.25;
        halo.children.forEach((c, i) => (c.rotation.z += dt * (0.2 + i * 0.15)));

        if (beamLife > 0) {
          beamLife -= dt;
          beamMat.opacity = Math.max(0, beamLife / 0.18);
          if (beamLife <= 0) beam.visible = false;
        }

        if (s.playing) {
          s.timeLeft -= dt;
          if (!s.clutchAnnounced && s.timeLeft <= CLUTCH_SECONDS) {
            s.clutchAnnounced = true;
            popups.current?.banner('CLUTCH TIME ×2', '#fbbf24');
            haptic('big');
          }
          if (s.timeLeft <= 0) finish();
          else pushHud({ timeLeft: s.timeLeft, clutch: s.timeLeft <= CLUTCH_SECONDS });

          s.spawnTimer += dt;
          const k = rampK(ROUND_SECONDS - s.timeLeft);
          const maxNodes = Math.round(lerp(2, 5, k));
          if (s.spawnTimer > lerp(1.05, 0.5, k) && nodes.length < maxNodes) {
            s.spawnTimer = 0;
            const rng = rngRef.current;
            const hz = rng();
            const isHazard = ROUND_SECONDS - s.timeLeft > 7 && hz < lerp(0.08, 0.24, k);
            const isBonus = !isHazard && rng() < 0.25;
            const type: NodeType = isHazard ? 'hazard' : isBonus ? 'bonus' : 'target';
            const n = pool.acquire();
            n.type = type;
            n.ringScale = RING_START;
            n.orb.material = orbMats[type];
            n.ring.material = ringMats[type];
            // Seeded spot as a fraction of the view (same for everyone) + depth in metres.
            const u = rng() * 2 - 1;
            const v = rng() * 2 - 1;
            const d = 5 + rng() * 3;
            const hh = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
            const hw = hh * camera.aspect;
            // Vertically: from just above the floor up to well above eye level (never under the HUD).
            const top = EYE_Y + hh * 0.42;
            n.group.position.set(u * hw * 0.72, 1.1 + ((v + 1) / 2) * (top - 1.1), -d);
            n.group.scale.setScalar(0.01);
            nodes.push(n);
          }
        }

        for (let i = nodes.length - 1; i >= 0; i--) {
          const n = nodes[i];
          if (n.group.scale.x < NODE_SCALE) n.group.scale.setScalar(Math.min(NODE_SCALE, n.group.scale.x + dt * 4)); // pop-in
          if (s.playing) n.ringScale -= lerp(0.62, 1.25, rampK(ROUND_SECONDS - s.timeLeft)) * dt;
          n.ring.scale.setScalar(n.ringScale);
          n.orb.rotation.y += 2 * dt;
          n.orb.rotation.x += 1.3 * dt;
          n.ring.lookAt(camera.position);
          if (n.ringScale <= 0.6 || !s.playing) {
            if (s.playing && n.type !== 'hazard' && s.combo !== 0) {
              s.combo = 0;
              pushHud({ combo: 0 }, true);
            }
            removeNode(i);
          }
        }

        // First-person camera: tiny lean toward the last shot, settles back; shake on hazards.
        lookX *= 1 - Math.min(1, dt * 2);
        lookY *= 1 - Math.min(1, dt * 2);
        const off = feel.update(dt, t, 0);
        camera.position.set(off.x, EYE_Y + Math.sin(t * 1.2) * 0.008 + off.y, 0);
        camera.lookAt(lookX * 10, EYE_Y + lookY * 10, -10);

        // Arms ready; right hand kicks back on each shot.
        arms.ready(t);
        if (recoil > 0) {
          recoil = Math.max(0, recoil - dt * 6);
          arms.right.pivot.position.z += recoil * 0.07;
          arms.right.pivot.rotation.x = recoil * 0.35;
        }
        arms.setGlow(Math.min(1.5, s.combo * 0.1));
      });

      return () => {
        hitRef.current = () => {};
        resetWorldRef.current = () => {};
      };
    },
    [stableAvatar],
  );

  const mult = Math.min(5, 1 + Math.floor(hud.combo / 5));
  const chips = (
    <>
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${mult > 1 ? 'bg-cyan-400 text-black' : 'bg-black/50 text-cyan-300'}`}>
        {hud.combo} streak{mult > 1 ? ` · ×${mult}` : ''}
      </span>
    </>
  );

  return (
    <GameShell
      title="CYBER REFLEX"
      accent="#38bdf8"
      hostRef={hostRef}
      popupsRef={popups}
      phase={phase}
      onStart={startGame}
      score={hud.score}
      timeLeft={phase === 'ready' ? ROUND_SECONDS : hud.timeLeft}
      roundSeconds={ROUND_SECONDS}
      clutch={hud.clutch}
      chips={chips}
      rival={rival}
      match={match}
      onExit={onExit}
      surface={surface}
      hint="Tap or slash nodes as the ring closes"
      tutorial={[
        { icon: <Pointer className="w-6 h-6" />, label: 'Tap nodes' },
        { icon: <Hand className="w-6 h-6" />, label: 'Slash across many' },
        { icon: <ShieldAlert className="w-6 h-6" />, label: 'Avoid red' },
      ]}
      scoring="First-person laser drill. Starts slow with no red nodes; speeds up as the clock runs. Hit 160 · Perfect ring timing +90 · Gold ×2 · Every 5 in a row raises the multiplier (max ×5) · Red −150 · Last 10s ×2."
    >
      <div ref={flashRef} className="absolute inset-0 z-10 pointer-events-none opacity-0" style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(255,0,72,0.55) 100%)' }} />
    </GameShell>
  );
}
