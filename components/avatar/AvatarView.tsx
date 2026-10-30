'use client';

import React, { useEffect, useRef } from 'react';
import { AvatarConfig } from '@/lib/avatar-types';
import { drawAvatar, DrawAvatarOptions } from '@/lib/avatar-canvas-draw';

interface AvatarViewProps {
  avatar: AvatarConfig;
  size?: number; // visual px size
  action?: 'idle' | 'run' | 'jump' | 'shoot' | 'celebrate';
  animate?: boolean;
  facingRight?: boolean;
  className?: string;
  showTrail?: boolean;
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
}: AvatarViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
        action: avatar.pose === 'victory' ? 'celebrate' : action,
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
  }, [avatar, size, action, animate, facingRight, showTrail]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`inline-block pointer-events-none select-none ${className}`}
      aria-hidden="true"
    />
  );
}
