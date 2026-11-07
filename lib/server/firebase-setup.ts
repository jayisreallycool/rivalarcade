import { adminApp } from './firestore-store';
import { FIRESTORE_DB_ID } from '../firestore-db-id';

/**
 * Turns on what sign-in needs, using the server's own Firebase admin key: phone sign-in, this
 * site's address on the allowed list, and the Firestore database. It only ever switches things
 * on (never off, never anything else), so it is safe to run on every health check. Google
 * sign-in can't be switched on from here (Google keeps its secret in the console), so that one
 * is only reported.
 */

type Res = { status: number; json: Record<string, unknown> };

async function call(method: string, url: string, body?: unknown): Promise<Res> {
  const cred = adminApp().options.credential;
  if (!cred) throw new Error('no credential');
  const { access_token } = await cred.getAccessToken();
  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await r.json()) as Record<string, unknown>;
  } catch {
    /* empty body */
  }
  return { status: r.status, json };
}

const errText = (r: Res) => {
  const e = r.json.error as { status?: string; message?: string } | undefined;
  return `${e?.status ?? r.status}${e?.message ? ` — ${e.message.slice(0, 140)}` : ''}`;
};

export interface SetupReport {
  authentication: string;
  phoneSignIn: string;
  googleSignIn: string;
  allowedSites: string;
  database: string;
}

let inFlight: Promise<SetupReport> | null = null;
let last: { at: number; report: SetupReport } | null = null;

/** Runs at most once every 30 s per server; callers in between get the last result. */
export function ensureFirebaseSetup(project: string, hosts: string[]): Promise<SetupReport> {
  if (last && Date.now() - last.at < 30_000) return Promise.resolve(last.report);
  inFlight ??= run(project, hosts)
    .then((report) => {
      last = { at: Date.now(), report };
      return report;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function run(project: string, hosts: string[]): Promise<SetupReport> {
  const rep: SetupReport = { authentication: '?', phoneSignIn: '?', googleSignIn: '?', allowedSites: '?', database: '?' };
  const idt = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}`;

  // --- Authentication settings
  try {
    const cfg = await call('GET', `${idt}/config`);
    if (cfg.status === 404 || /CONFIGURATION_NOT_FOUND/.test(JSON.stringify(cfg.json))) {
      rep.authentication = 'not started — Firebase → Authentication → Get started';
    } else if (cfg.status !== 200) {
      rep.authentication = `can't read — ${errText(cfg)}`;
    } else {
      rep.authentication = 'ok';
      const signIn = (cfg.json.signIn ?? {}) as { phoneNumber?: { enabled?: boolean } };
      if (signIn.phoneNumber?.enabled) rep.phoneSignIn = 'on';
      else {
        const r = await call('PATCH', `${idt}/config?updateMask=signIn.phoneNumber.enabled`, { signIn: { phoneNumber: { enabled: true } } });
        rep.phoneSignIn = r.status === 200 ? 'switched on just now' : `off — couldn't switch on (${errText(r)})`;
      }
      const domains = (cfg.json.authorizedDomains as string[] | undefined) ?? [];
      const missing = hosts.filter((h) => !domains.includes(h));
      if (!missing.length) rep.allowedSites = 'ok';
      else {
        const r = await call('PATCH', `${idt}/config?updateMask=authorizedDomains`, { authorizedDomains: [...domains, ...missing] });
        rep.allowedSites = r.status === 200 ? `added ${missing.join(', ')} just now` : `missing ${missing.join(', ')} — couldn't add (${errText(r)})`;
      }
    }
  } catch (e) {
    rep.authentication = `error — ${String((e as Error).message).slice(0, 140)}`;
  }

  // --- Google sign-in (report only)
  try {
    const g = await call('GET', `${idt}/defaultSupportedIdpConfigs/google.com`);
    rep.googleSignIn =
      g.status === 200 && g.json.enabled
        ? 'on'
        : g.status === 200 || g.status === 404
          ? 'off — Firebase → Authentication → Sign-in method → Google → Enable → pick support email → Save'
          : `can't read — ${errText(g)}`;
  } catch (e) {
    rep.googleSignIn = `error — ${String((e as Error).message).slice(0, 140)}`;
  }

  // --- Firestore database
  try {
    const fsBase = `https://firestore.googleapis.com/v1/projects/${project}/databases`;
    const d = await call('GET', `${fsBase}/${FIRESTORE_DB_ID}`);
    if (d.status === 200) rep.database = `ok (${FIRESTORE_DB_ID})`;
    else {
      const list = await call('GET', fsBase);
      const names = ((list.json.databases as { name?: string }[] | undefined) ?? []).map((x) => String(x.name).split('/').pop());
      rep.database = `"${FIRESTORE_DB_ID}" not found (${errText(d)}); databases in project: ${names.length ? names.join(', ') : list.status === 200 ? 'none' : errText(list)}`;
    }
  } catch (e) {
    rep.database = `error — ${String((e as Error).message).slice(0, 140)}`;
  }
  return rep;
}
