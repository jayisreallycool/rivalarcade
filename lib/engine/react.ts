'use client';

import { DependencyList, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EngineOptions, GameEngine, reportEngineFailure } from './GameEngine';

// Layout effect on the client (runs before passive effects), no-op warning-free on the server.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Mounts a GameEngine into `hostRef` exactly once per `deps` change (normally just the avatar),
 * runs `setup` to build the world, and tears everything down on unmount.
 *
 * Gameplay state changes (start, game over, score…) must NOT be in deps — read them from refs
 * inside engine.addUpdate() instead. Rebuilding a WebGL scene on every state change was the
 * #1 cost in the original implementation.
 */
export function useGameEngine(options: EngineOptions, setup: (engine: GameEngine) => void | (() => void), deps: DependencyList) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const setupRef = useRef(setup);
  const optionsRef = useRef(options);
  useIsoLayoutEffect(() => {
    setupRef.current = setup;
    optionsRef.current = options;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Creating the WebGL context or building the scene can fail on some phones (no WebGL2,
    // GPU blocklisted, out of memory). Never crash the page: report it so the match flow can
    // retry in safe mode or switch to the 2D edition.
    let engine: GameEngine;
    try {
      engine = new GameEngine(host, optionsRef.current);
    } catch (err) {
      reportEngineFailure('create', err);
      return;
    }
    engineRef.current = engine;
    let cleanup: void | (() => void);
    try {
      cleanup = setupRef.current(engine);
      engine.start();
    } catch (err) {
      engine.dispose();
      engineRef.current = null;
      reportEngineFailure('setup', err);
      return;
    }
    return () => {
      cleanup?.();
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { hostRef, engineRef };
}

/** Always-current ref to a value (e.g. a parent callback) without re-running effects. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useIsoLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Structural identity for plain config objects, so a store re-render with an equal avatar doesn't rebuild the scene. */
export function useStructuralMemo<T>(value: T): T {
  const key = JSON.stringify(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [key]);
}

/**
 * HUD state that game loops can push into at 60 fps while React re-renders at most ~10×/s.
 * Pass `immediate` for events the player must see instantly (game over, big score).
 */
export function useThrottledHud<T extends Record<string, unknown>>(initial: T, intervalMs = 100) {
  const [hud, setHud] = useState(initial);
  const pending = useRef(initial);
  const lastFlush = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    lastFlush.current = performance.now();
    setHud(pending.current);
  }, []);

  const push = useCallback(
    (patch: Partial<T>, immediate = false) => {
      let changed = false;
      for (const k in patch) {
        if (pending.current[k] !== patch[k]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      pending.current = { ...pending.current, ...patch };

      const since = performance.now() - lastFlush.current;
      if (immediate || since >= intervalMs) {
        if (timer.current) clearTimeout(timer.current);
        flush();
      } else if (!timer.current) {
        timer.current = setTimeout(flush, intervalMs - since);
      }
    },
    [flush, intervalMs],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return [hud, push] as const;
}
