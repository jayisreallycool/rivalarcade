import { json } from '@/lib/server/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hits = new Map<string, number[]>();

/** POST { "name": "Chris" } → { "text": "…Gemini's reply…" }. Rate-limited per IP. */
export async function POST(req: Request) {
  const { aiConfigured, helloFlow } = await import('@/lib/server/ai');
  if (!aiConfigured()) return json({ error: 'ai_not_configured' }, 503);
  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => t > now - 60_000);
  if (list.length >= 10) return json({ error: 'rate_limited' }, 429);
  hits.set(ip, [...list, now]);
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!name) return json({ error: 'name_required' }, 400);
  try {
    return json({ text: await helloFlow(name) });
  } catch (e) {
    console.error('[ai]', e);
    return json({ error: 'ai_error' }, 502);
  }
}
