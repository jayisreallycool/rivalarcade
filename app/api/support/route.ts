import { engine, errorResponse, json } from '@/lib/server/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hits = new Map<string, number[]>();

/** Public contact form → a support ticket in the database (rate-limited per IP, spam-trapped). */
export async function POST(req: Request) {
  try {
    const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
    const now = Date.now();
    const list = (hits.get(ip) ?? []).filter((t) => t > now - 3_600_000);
    if (list.length >= 5) return json({ error: 'rate_limited' }, 429);
    const raw = await req.text();
    if (raw.length > 8000) return json({ error: 'too_large' }, 413);
    const b = JSON.parse(raw || '{}') as Record<string, unknown>;
    if (b.website) return json({ ok: true }); // bot filled the trap
    const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const email = s(b.email, 120);
    const message = s(b.message, 3000);
    if (!/^\S+@\S+\.\S+$/.test(email) || message.length < 10) return json({ error: 'invalid' }, 400);
    list.push(now);
    hits.set(ip, list);
    const id = await engine().supportTicket({ name: s(b.name, 80), email, username: s(b.username, 16), topic: s(b.topic, 60), message, ip });
    return json({ ok: true, id });
  } catch (e) {
    return errorResponse(e);
  }
}
