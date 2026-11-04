'use client';

import { useEffect, useState } from 'react';
import { RARITY, SHOP_ITEMS, getStarterAvatar, itemImage } from '@/lib/cosmetics-catalog';
import { withItem } from '@/lib/avatar-slots';
import AvatarView from '@/components/avatar/AvatarView';

/** ?view=compare: each product image next to the 2D avatar wearing it (visual QA). */
function Compare() {
  const base = { ...getStarterAvatar('neutral'), hairStyleId: 'hair_short_fade', hairColorId: 'jet_black', skinToneId: 'golden' };
  const only = new URLSearchParams(location.search).get('only')?.split(',');
  return (
    <main className="min-h-screen bg-[#05060c] p-3 text-white">
      <div className="grid grid-cols-3 gap-2">
        {SHOP_ITEMS()
          .filter((i) => i.category !== 'banner' && (!only || only.includes(i.id)))
          .map((item) => (
            <figure key={item.id} data-testid={`cmp-${item.id}`} className="flex items-center gap-1 rounded-lg border p-1" style={{ borderColor: RARITY[item.rarity].color }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={itemImage(item.id)} alt="" className="w-[180px] h-[180px] rounded" />
              <AvatarView avatar={withItem(base, item)} size={220} animate={false} action={item.id === 'pose_victory_flex' ? 'celebrate' : 'idle'} />
              <figcaption className="text-[9px] font-bold w-14 break-words">{item.name}</figcaption>
            </figure>
          ))}
      </div>
    </main>
  );
}

/**
 * Internal tool: renders a product image for every cosmetic (see lib/item-render.ts) and shows a
 * contact sheet. scripts/render-items.cjs opens this page and saves window.__items to
 * public/items/<id>.webp. Optional ?only=id1,id2 renders a subset.
 */
declare global {
  interface Window {
    __items?: Record<string, string>;
    __itemsDone?: boolean;
  }
}

export default function ItemLab() {
  const [view, setView] = useState<string | null | undefined>(undefined);
  // Read the query after mount so server and client render the same first frame.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setView(new URLSearchParams(location.search).get('view')), []);
  if (view === undefined) return null;
  if (view === 'compare') return <Compare />;
  return <Renderer />;
}

function Renderer() {
  const [shots, setShots] = useState<{ id: string; name: string; rarity: string; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ItemRenderer } = await import('@/lib/item-render');
        const only = new URLSearchParams(location.search).get('only')?.split(',');
        const size = Number(new URLSearchParams(location.search).get('size') || 512);
        const items = SHOP_ITEMS().filter((i) => !only || only.includes(i.id));
        const r = new ItemRenderer(size);
        const out: Record<string, string> = {};
        for (const item of items) {
          if (cancelled) return;
          const url = r.render(item).toDataURL('image/webp', 0.86);
          out[item.id] = url;
          setShots((s) => [...s, { id: item.id, name: item.name, rarity: item.rarity, url }]);
          await new Promise((res) => setTimeout(res, 0));
        }
        r.dispose();
        window.__items = out;
        window.__itemsDone = true;
      } catch (e) {
        setError(String(e));
        window.__itemsDone = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#05060c] p-4 text-white">
      <h1 className="text-lg font-black mb-3">Item Lab · {shots.length} rendered</h1>
      {error && <p className="text-rose-400 font-mono text-xs mb-3">{error}</p>}
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
        {shots.map((s) => (
          <figure key={s.id} className="rounded-xl overflow-hidden border-2" style={{ borderColor: RARITY[s.rarity as keyof typeof RARITY].color }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.url} alt={s.name} className="w-full aspect-square" />
            <figcaption className="px-1.5 py-1 text-[10px] font-bold truncate bg-black/60">{s.name}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
