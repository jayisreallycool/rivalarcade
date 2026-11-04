'use client';

import React, { useState } from 'react';
import type { CosmeticItem } from '@/lib/avatar-types';
import { RARITY, itemImage } from '@/lib/cosmetics-catalog';

/**
 * Product image for a cosmetic: the generated render (public/items/<id>.webp) in a rarity frame.
 * Legendary and mythic items get an animated foil sheen; mythic adds a shifting holo border.
 */
export default function ItemImage({ item, size = 'md', badge = true, className = '' }: { item: CosmeticItem; size?: 'sm' | 'md' | 'lg'; badge?: boolean; className?: string }) {
  const r = RARITY[item.rarity];
  const [broken, setBroken] = useState(false);
  const radius = size === 'sm' ? 'rounded-lg' : 'rounded-xl';
  return (
    <div
      className={`relative aspect-square overflow-hidden ${radius} ${item.rarity === 'mythic' ? 'ra-holo-ring' : ''} ${className}`}
      style={{ boxShadow: `0 0 0 2px ${r.color}, 0 0 ${size === 'lg' ? 28 : 14}px ${r.glow}`, background: `radial-gradient(circle at 50% 40%, ${r.from}, ${r.to})` }}
      data-testid="item-image"
    >
      {!broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={itemImage(item.id)} alt={item.name} loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover select-none" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-2xl font-black" style={{ color: r.color }}>
          {item.name.charAt(0)}
        </span>
      )}
      {r.rank >= 3 && <span className="ra-sheen absolute inset-0 pointer-events-none" aria-hidden />}
      {badge && size !== 'sm' && (
        <span className="absolute left-1.5 top-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wide text-black" style={{ background: r.color }}>
          {r.label}
        </span>
      )}
    </div>
  );
}
