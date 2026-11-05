import { engine, errorResponse, json } from '@/lib/server/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Scheduled sweep: settle contests whose window closed and open the next cups. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401);
  try {
    return json({ settled: await engine().tick() });
  } catch (e) {
    return errorResponse(e);
  }
}
