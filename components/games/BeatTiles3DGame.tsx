'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import { ParticleBursts, useGameEngine, useLatest, useThrottledHud } from '@/lib/engine';
import { GameProps } from '@/lib/game-types';
import { mulberry32, randomSeed } from '@/lib/rng';
import { award, popStyle, ScoreBook } from '@/lib/scoring';
import GameShell, { PopupApi, useSwipe } from './GameShell';
import { Pointer, Music, Gauge } from 'lucide-react';

/**
 * BEAT TILES — four lanes of glowing tiles roll down the screen. Tap the lowest tile each time —
 * every tap plays the next note of the song. Tap an empty lane, or let a tile slip off the bottom,
 * and the run is over. The music speeds up as you go; later rows bring DOUBLE tiles (tap both).
 * Tap a tile inside the glowing BEAT ZONE near the bottom for a PERFECT — braver taps, more points.
 * Score (small numbers): tile 1 · PERFECT +1 · 5 perfects in a row = ON FIRE ×2.
 * Same song and tile pattern for every player.
 */

const LANES = 4;
const CAM_Z = 20;
const FOV = 30;
const VIEW_H = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2)); // world units tall
const TILE_H = VIEW_H / 4.2;
const ZONE = 0.34; // the lowest 34% of the screen is the beat zone
const TILE_COLORS = [0x22d3ee, 0xa855f7, 0xf472b6, 0x34d399];
/** A cheerful pentatonic melody walk (seeded), with a bass note every 4 taps. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

type Phase = 'ready' | 'playing' | 'over';
interface Row {
  y: number; // bottom edge
  lanes: number[];
  tapped: number[];
  meshes: THREE.Mesh[];
  note: number;
}

export default function BeatTiles3DGame({ onFinish, seed, rival, match, onExit }: GameProps) {
  const onFinishRef = useLatest(onFinish);
  const seedRef = useLatest(seed);
  const popups = useRef<PopupApi | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, tiles: 0, bpm: 120, perfect: 0 });
  const api = useRef({ start: () => {}, tap: (_x: number) => {} });

  const startGame = useCallback(() => {
    api.current.start();
    setPhase('playing');
  }, []);
  const surface = useSwipe({ onDrag: (s, ph) => ph === 'start' && api.current.tap(s.startX) });
  useEffect(() => {
    // keyboard: D F J K for the four lanes
    const lanes: Record<string, number> = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
    const k = (e: KeyboardEvent) => {
      if (e.code in lanes) {
        e.preventDefault();
        api.current.tap(-1 - lanes[e.code]);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const { hostRef } = useGameEngine(
    {
      background: 0x07040f,
      camera: { fov: FOV, near: 1, far: 60, position: [0, 0, CAM_Z], lookAt: [0, 0, 0] },
      exposure: 1.1,
      bloom: { strength: 0.8, radius: 0.5, threshold: 0.5 },
      environment: 0.3,
      grade: { saturation: 1.2, vignette: 0.35 },
    },
    (engine) => {
      const { scene, camera } = engine;
      let viewW = 6;
      let surfaceW = 390;
      void camera;

      // lanes: faint dividers, a pulsing beat zone and a glow line at its top
      const laneMat = engine.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 }));
      const lineGeo = engine.own(new THREE.PlaneGeometry(0.03, VIEW_H));
      const dividers = [1, 2, 3].map(() => {
        const m = new THREE.Mesh(lineGeo, laneMat);
        scene.add(m);
        return m;
      });
      const zoneMat = engine.own(new THREE.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.12, depthWrite: false }));
      const zone = new THREE.Mesh(engine.own(new THREE.PlaneGeometry(1, VIEW_H * ZONE)), zoneMat);
      zone.position.set(0, -VIEW_H / 2 + (VIEW_H * ZONE) / 2, -0.2);
      const zoneLineMat = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc084fc).multiplyScalar(2), toneMapped: false }));
      const zoneLine = new THREE.Mesh(engine.own(new THREE.PlaneGeometry(1, 0.05)), zoneLineMat);
      zoneLine.position.set(0, -VIEW_H / 2 + VIEW_H * ZONE, -0.1);
      scene.add(zone, zoneLine);
      const layout = () => {
        dividers.forEach((d, i) => (d.position.x = -viewW / 2 + ((i + 1) * viewW) / LANES));
        zone.scale.x = viewW;
        zoneLine.scale.x = viewW;
        rows.forEach(placeRow);
      };
      // drifting background equaliser bars
      const barMat = engine.own(new THREE.MeshBasicMaterial({ color: 0x3b0764, transparent: true, opacity: 0.5 }));
      const bars = Array.from({ length: 16 }, (_, i) => {
        const b = new THREE.Mesh(engine.own(new THREE.PlaneGeometry(0.5, 1)), barMat);
        b.position.set(-7 + i * 0.95, -VIEW_H / 2, -3);
        scene.add(b);
        return b;
      });

      const tileGeo = engine.own(new THREE.PlaneGeometry(1, 1));
      const tileMats = TILE_COLORS.map((c) => engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.3), toneMapped: false })));
      const doneMat = engine.own(new THREE.MeshBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.6 }));
      const failMat = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xef4444).multiplyScalar(1.5), toneMapped: false }));
      const particles = new ParticleBursts(engine);
      const tmp = new THREE.Vector3();

      const rows: Row[] = [];
      let rng = mulberry32(1);
      let spawned = 0;
      let lastLane = -1;
      let melody = 4;
      let speed = 0; // world units per second (0 until the first tap)
      let tiles = 0;
      let perfectStreak = 0;
      let playing = false;
      let dead = false;
      let deadT = 0;
      let failRow: Row | null = null;
      let book = new ScoreBook();
      let beat = 0;

      const laneX = (l: number) => -viewW / 2 + (l + 0.5) * (viewW / LANES);
      const placeRow = (r: Row) => {
        r.meshes.forEach((m, k) => {
          m.position.set(laneX(r.lanes[k]), r.y + TILE_H / 2, 0);
          m.scale.set(viewW / LANES - 0.06, TILE_H - 0.06, 1);
        });
      };
      const addRow = () => {
        const top = rows.length ? rows[rows.length - 1].y + TILE_H : -VIEW_H / 2 + VIEW_H * 0.12;
        let lane = Math.floor(rng() * LANES);
        if (lane === lastLane && rng() < 0.6) lane = (lane + 1 + Math.floor(rng() * 3)) % LANES;
        lastLane = lane;
        const lanes = [lane];
        // double tiles once you're warmed up
        if (spawned > 30 && rng() < Math.min(0.28, 0.08 + spawned * 0.002)) lanes.push((lane + 2) % LANES);
        melody = Math.max(0, Math.min(SCALE.length - 1, melody + Math.floor(rng() * 5) - 2));
        const meshes = lanes.map((l) => {
          const m = new THREE.Mesh(tileGeo, tileMats[l]);
          scene.add(m);
          return m;
        });
        const r: Row = { y: top, lanes, tapped: [], meshes, note: 60 + SCALE[melody] };
        placeRow(r);
        rows.push(r);
        spawned += 1;
      };
      const fill = () => {
        while (rows.length === 0 || rows[rows.length - 1].y < VIEW_H / 2 + TILE_H) addRow();
      };

      // (registered here, after the rows exist: onResize may fire straight away)
      engine.onResize((w, _h, aspect) => {
        surfaceW = w;
        viewW = VIEW_H * aspect;
        layout();
      });
      const reset = () => {
        rows.forEach((r) => r.meshes.forEach((m) => scene.remove(m)));
        rows.length = 0;
        rng = mulberry32(seedRef.current ?? randomSeed());
        spawned = 0;
        lastLane = -1;
        melody = 4;
        speed = 0;
        tiles = 0;
        perfectStreak = 0;
        dead = false;
        deadT = 0;
        failRow = null;
        book = new ScoreBook();
        particles.clear();
        fill();
      };
      reset();

      /** Speed: ~2.4 tiles a second to start, building to ~8 (tiles/s = BPM / 60 × 2). */
      const targetSpeed = () => TILE_H * Math.min(8, 2.4 + tiles * 0.035);

      const fail = (r: Row, lane: number, why: string) => {
        dead = true;
        playing = false;
        failRow = r;
        // flash where it went wrong
        const m = new THREE.Mesh(tileGeo, failMat);
        m.position.set(laneX(lane), r.y + TILE_H / 2, 0.05);
        m.scale.set(viewW / LANES - 0.06, TILE_H - 0.06, 1);
        scene.add(m);
        r.meshes.push(m);
        r.lanes.push(lane);
        sound.playLose();
        haptic('fail');
        engine.flash(0.5);
        popups.current?.banner(`${why} · ${tiles} TILES`, '#f87171');
        pushHud({ score: book.score, tiles, perfect: 0 }, true);
        setPhase('over');
        setTimeout(() => onFinishRef.current(book.score, { maxCombo: perfectStreak, breakdown: book.breakdown() }), 1600);
      };

      api.current.start = () => {
        reset();
        playing = true;
        pushHud({ score: 0, tiles: 0, bpm: 72, perfect: 0 }, true);
        popups.current?.banner('TAP THE LOWEST TILE', '#c084fc');
      };
      api.current.tap = (x: number) => {
        if (!playing || dead) return;
        const lane = x < 0 ? -1 - x : Math.max(0, Math.min(LANES - 1, Math.floor((x / surfaceW) * LANES)));
        const r = rows.find((row) => row.tapped.length < row.lanes.length);
        if (!r) return;
        if (!r.lanes.includes(lane) || r.tapped.includes(lane)) {
          fail(r, lane, 'WRONG TILE');
          return;
        }
        r.tapped.push(lane);
        const k = r.lanes.indexOf(lane);
        r.meshes[k].material = doneMat;
        if (speed === 0) speed = targetSpeed(); // the song starts on your first tap
        sound.playNote(r.note + (r.lanes.length > 1 && r.tapped.length === 2 ? 4 : 0), 0.32);
        if (tiles % 4 === 0) sound.playNote(r.note - 24, 0.5, 0.08);
        haptic('tap');
        tiles += 1;
        beat = 1;
        // PERFECT: tapped while the tile sits in the beat zone
        const centre = r.y + TILE_H / 2;
        const inZone = centre < -VIEW_H / 2 + VIEW_H * ZONE;
        perfectStreak = inZone ? perfectStreak + 1 : 0;
        const a = award(inZone ? 2 : 1, { streak: perfectStreak });
        book.record(a, inZone ? { Tiles: 1, Perfects: a.total - 1 } : { Tiles: a.total });
        const p = engine.toScreen(tmp.set(laneX(lane), centre, 0));
        popups.current?.pop(inZone ? `PERFECT +${a.total}` : `+${a.total}`, p.x, p.y, inZone ? { color: '#f0abfc', size: 'sm' } : popStyle(a.total));
        particles.emit(tmp.set(laneX(lane), centre, 0.2), TILE_COLORS[lane], { count: inZone ? 14 : 6, speed: 3, life: 0.4, gravity: 0 });
        if (tiles % 50 === 0) popups.current?.banner(`${tiles} TILES · FASTER!`, '#67e8f9');
        pushHud({ score: book.score, tiles, bpm: Math.round((targetSpeed() / TILE_H) * 30), perfect: perfectStreak }, true);
      };

      engine.addUpdate((dt, t) => {
        if (playing && speed > 0) {
          speed += (targetSpeed() - speed) * Math.min(1, dt * 2);
          for (const r of rows) r.y -= speed * dt;
          // the lowest untapped tile slid off the bottom: missed
          const low = rows.find((row) => row.tapped.length < row.lanes.length);
          if (low && low.y + TILE_H < -VIEW_H / 2) {
            const lane = low.lanes.find((l) => !low.tapped.includes(l)) ?? low.lanes[0];
            fail(low, lane, 'MISSED');
          }
          while (rows.length && rows[0].y + TILE_H < -VIEW_H / 2 - TILE_H && rows[0].tapped.length === rows[0].lanes.length) {
            rows.shift()!.meshes.forEach((m) => scene.remove(m));
          }
          fill();
          rows.forEach(placeRow);
        }
        if (dead && failRow) {
          // roll back so you can see the tile you missed, then blink it
          deadT += dt;
          const want = -VIEW_H / 2 + TILE_H * 0.6;
          const d = (want - failRow.y) * Math.min(1, dt * 6);
          if (failRow.y + TILE_H < -VIEW_H / 2 + TILE_H) for (const r of rows) r.y += d;
          rows.forEach(placeRow);
          failMat.color.setRGB(Math.floor(deadT * 6) % 2 ? 2 : 0.6, 0.2, 0.2);
        }
        // the first tile shows "TAP"; everything pulses with the beat
        beat = Math.max(0, beat - dt * 4);
        zoneMat.opacity = 0.1 + beat * 0.12;
        zoneLineMat.color.setRGB(1.5 + beat, 0.8, 2.4);
        bars.forEach((b, i) => {
          const h = 1 + Math.abs(Math.sin(t * 3 + i * 0.7)) * (2 + beat * 4);
          b.scale.y = h;
          b.position.y = -VIEW_H / 2 + h / 2;
        });
      });

      return () => {
        api.current = { start: () => {}, tap: () => {} };
      };
    },
    [],
  );

  return (
    <GameShell
      title="BEAT TILES"
      accent="#c084fc"
      hostRef={hostRef}
      popupsRef={popups}
      phase={phase}
      onStart={startGame}
      score={hud.score}
      chips={
        <>
          <span className="px-2 py-0.5 rounded-full bg-black/50 text-violet-200 text-[11px] font-black whitespace-nowrap" data-testid="tiles-count">
            ♪ {hud.tiles}
          </span>
          {hud.perfect >= 3 && <span className="px-2 py-0.5 rounded-full bg-fuchsia-400 text-black text-[11px] font-black whitespace-nowrap">PERFECT ×{hud.perfect}</span>}
        </>
      }
      rival={rival}
      match={match}
      onExit={onExit}
      surface={surface}
      hint="Tap the lowest tile · in the zone = PERFECT"
      guide={{
        goal: 'Tap the lowest tile, every time. Never tap an empty lane.',
        controls: [{ gesture: 'tap', label: 'Tap the tile' }],
        points: [
          { label: 'Tile', value: '1' },
          { label: 'In the beat zone', value: '+1', tone: 'bonus' },
          { label: '5 perfects', value: '×2', tone: 'fire' },
        ],
        ends: 'Wrong tap or a missed tile ends it',
      }}
      tutorial={[
        { icon: <Pointer className="w-6 h-6" />, label: 'Tap the tile' },
        { icon: <Music className="w-6 h-6" />, label: 'Play the song' },
        { icon: <Gauge className="w-6 h-6" />, label: 'It speeds up' },
      ]}
      scoring="Tiles roll down four lanes. Tap the lowest tile each time — every tap plays the next note of the song. Tap an empty lane, or let a tile slide off the bottom, and the run is over. The song speeds up as you go, and later rows bring DOUBLE tiles: tap both. Tile 1 · tap it inside the glowing beat zone near the bottom for a PERFECT +1 · 5 perfects in a row = ON FIRE ×2. Keyboard: D F J K. Same song for every player."
    />
  );
}
