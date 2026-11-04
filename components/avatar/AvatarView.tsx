'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AvatarConfig } from '@/lib/avatar-types';
import { drawAvatar, DrawAvatarOptions } from '@/lib/avatar-canvas-draw';
import { poseAction } from '@/lib/avatar-slots';
import { cachedSnapshot, snapshotAvatar, snapshotsAvailable } from '@/lib/avatar-snapshot';

interface AvatarViewProps {
  avatar: AvatarConfig;
  size?: number; // visual px size
  action?: 'idle' | 'run' | 'jump' | 'shoot' | 'celebrate';
  animate?: boolean;
  facingRight?: boolean;
  className?: string;
  showTrail?: boolean;
  /** Force the 2D drawing (no 3D still). */
  flat?: boolean;
}

/**
 * 2D avatar preview used across menus.
 * - Canvas backing store is sized once per size/DPR change (not every frame).
 * - Animation runs at ~30 fps (plenty for an idle bob) and pauses when scrolled off-screen
 *   or when the tab is hidden, so long lists of avatars cost almost nothing.
 */
export default function AvatarView({
  avatar,
  size = 120,
  action = 'idle',
  animate = true,
  facingRight = true,
  className = '',
  showTrail = true,
  flat = false,
}: AvatarViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 3D still of the avatar (rendered by one shared GPU context); the 2D drawing shows meanwhile
  // and stays as the fallback when 3D isn't available.
  const [still, setStill] = useState<{ key: string; url: string } | null>(null);
  const px = Math.round(size * 2);
  const stillKey = flat ? '' : `${px}|${action}|${JSON.stringify(avatar)}`;
  const cachedUrl = !flat && typeof window !== 'undefined' && snapshotsAvailable() ? cachedSnapshot(avatar, px, action) : null;
  const url = cachedUrl ?? (still?.key === stillKey ? still.url : null);
  useEffect(() => {
    if (flat || !snapshotsAvailable()) return;
    let live = true;
    void snapshotAvatar(avatar, px, action).then((u) => {
      if (live && u) setStill({ key: stillKey, url: u });
    });
    return () => {
      live = false;
    };
  }, [avatar, px, action, flat, stillKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || url) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    let frame = 0;
    let animId = 0;
    let visible = true;
    let last = 0;

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const opts: DrawAvatarOptions = {
        frame,
        // At rest the avatar plays its equipped emote; explicit actions (run, jump…) win.
        action: action === 'idle' ? poseAction(avatar) ?? 'idle' : action,
        facingRight,
        scale: 1,
        showTrail,
      };
      drawAvatar(ctx, avatar, size / 2, size * 0.58, size * 0.85, opts);
    };

    const loop = (t: number) => {
      animId = requestAnimationFrame(loop);
      if (t - last < 32) return; // ~30 fps
      // Advance by elapsed 60fps-frames so animation speed matches the original timing.
      frame += last ? Math.round((t - last) / 16.67) : 1;
      last = t;
      draw();
    };

    const start = () => {
      if (!animate || animId || !visible || document.hidden) return;
      last = 0;
      animId = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (animId) cancelAnimationFrame(animId);
      animId = 0;
    };

    draw();

    let io: IntersectionObserver | null = null;
    const onVis = () => (document.hidden ? stop() : start());
    if (animate) {
      io = new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) start();
        else stop();
      });
      io.observe(canvas);
      document.addEventListener('visibilitychange', onVis);
      start();
    }

    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [avatar, size, action, animate, facingRight, showTrail, url]);

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        draggable={false}
        style={{ width: `${size}px`, height: `${size}px`, transform: facingRight ? undefined : 'scaleX(-1)' }}
        className={`relative inline-block pointer-events-none select-none ${className}`}
        aria-hidden="true"
        data-avatar-3d="still"
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`relative inline-block pointer-events-none select-none ${className}`}
      aria-hidden="true"
    />
  );
}
