'use client';
/**
 * Sign-in for the app: phone number + text code (Firebase Auth, with its invisible reCAPTCHA
 * bot check) or Google, which must then add a phone number — one account per phone.
 *
 * Local test runs (NEXT_PUBLIC_RA_TEST_AUTH=1) swap Firebase for a stand-in that accepts the
 * code 123456, so the whole flow can be tested without sending real texts.
 */
import type { Auth, ConfirmationResult, RecaptchaVerifier, User } from 'firebase/auth';

export interface Session {
  uid: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  provider: 'phone' | 'google' | 'test' | 'guest';
  token: (refresh?: boolean) => Promise<string>;
}

export const TEST_AUTH = process.env.NEXT_PUBLIC_RA_TEST_AUTH === '1';

/**
 * Firebase web config for the "rivalarcade" project. These values are public by design (they ship in
 * every browser bundle); env vars override them for a different project.
 */
export const firebaseClientConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyDDPfHmXGWtvd1HycWVGxZ5ElxcMlKSELg',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'rivalarcadedev.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'rivalarcadedev',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:501777083388:web:85121cc08ce2f10e00e079',
};
/** Sign-in turns on only when this deployment's server also has its Firebase key (else guest mode). */
const firebaseReady = !!(firebaseClientConfig.apiKey && firebaseClientConfig.projectId) && process.env.NEXT_PUBLIC_RA_SERVER_READY === '1';
/**
 * Guest mode (no sign-in): on when NEXT_PUBLIC_GUEST_MODE=1, or automatically while Firebase isn't
 * set up yet. The game runs on this device with local progress; real-player matches need sign-in.
 */
export const GUEST = !TEST_AUTH && (process.env.NEXT_PUBLIC_GUEST_MODE === '1' || !firebaseReady);
/** Live sync (Firestore listeners) only with real accounts. */
export const LIVE_SYNC = !TEST_AUTH && !GUEST;
export const authConfigured = () => true;

function guestSession(): Session {
  let id = '';
  try {
    id = localStorage.getItem('ra_guest_id') ?? '';
    if (!id) {
      id = `guest${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      localStorage.setItem('ra_guest_id', id);
    }
  } catch {
    id = 'guestlocal';
  }
  return { uid: id, phone: null, email: null, name: null, provider: 'guest', token: async () => 'guest' };
}

/** Friendly messages for the errors players can actually hit. */
export function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? (e instanceof Error ? e.message : String(e));
  const map: Record<string, string> = {
    'auth/invalid-phone-number': 'That phone number doesn’t look right.',
    'auth/missing-phone-number': 'Enter your phone number.',
    'auth/invalid-verification-code': 'That code isn’t right. Check the text and try again.',
    'auth/code-expired': 'That code expired. Send a new one.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.',
    'auth/quota-exceeded': 'Too many codes sent. Try again later.',
    'auth/credential-already-in-use': 'This phone number already has an account. Sign in with your phone number instead.',
    'auth/account-exists-with-different-credential': 'This phone number already has an account.',
    'auth/provider-already-linked': 'A phone number is already on this account.',
    'auth/popup-closed-by-user': 'Google sign-in was closed.',
    'auth/captcha-check-failed': 'The security check failed. Reload and try again.',
    'auth/operation-not-allowed': 'Phone sign-in isn’t switched on for this app yet.',
    'auth/unauthorized-domain': 'This web address isn’t allowed to sign in yet (add it in Firebase → Authentication → Settings).',
    'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this site and tap again.',
    'auth/cancelled-popup-request': 'Google sign-in was closed.',
    'auth/network-request-failed': 'Can’t reach Google. Check your connection and try again.',
    'auth/configuration-not-found': 'Sign-in isn’t set up yet: open Firebase → Authentication and click “Get started”.',
    'auth/admin-restricted-operation': 'That sign-in method isn’t switched on yet (Firebase → Authentication → Sign-in method).',
    'auth/billing-not-enabled': 'Text-message codes need billing turned on for the Firebase project. Use Google for now.',
    'auth/invalid-app-credential': 'The security check failed. Reload the page and try again.',
    'auth/missing-app-credential': 'The security check didn’t load. Reload the page and try again.',
    'auth/web-storage-unsupported': 'This browser is blocking storage (private mode?). Try a normal tab.',
    'auth/internal-error': 'Google sign-in hit a problem. Reload and try again.',
    'auth/invalid-api-key': 'This app’s Firebase key isn’t valid.',
    'auth/app-not-authorized': 'This web address isn’t allowed to use this Firebase project.',
    phone_in_use: 'This phone number already has an account.',
    voip_not_allowed: 'Internet / VoIP and toll-free numbers can’t be used. Use your mobile number.',
  };
  // unknown problems still say which one it was, so it can be fixed
  return map[code] ?? (code && code !== '[object Object]' ? `Sign-in failed (${code.replace(/^auth\//, '')}). Try again.` : 'Something went wrong. Try again.');
}

// ------------------------------------------------------------------------------- firebase

let fbAuth: Auth | null = null;
let authMod: typeof import('firebase/auth') | null = null;
let redirectChecked = false;
async function fb() {
  if (fbAuth) return fbAuth;
  const { initializeApp, getApps } = await import('firebase/app');
  const { getAuth, browserLocalPersistence, setPersistence } = await import('firebase/auth');
  const app = getApps()[0] ?? initializeApp(firebaseClientConfig);
  fbAuth = getAuth(app);
  fbAuth.useDeviceLanguage();
  await setPersistence(fbAuth, browserLocalPersistence);
  authMod = await import('firebase/auth');
  return fbAuth;
}

/**
 * Load Firebase before the player taps a sign-in button: phones only open the Google window when
 * it's opened straight from the tap, with nothing to wait for first. Also finishes a sign-in that
 * came back through a redirect (and reports its error, if any).
 */
export async function warmAuth(): Promise<string | null> {
  if (GUEST || TEST_AUTH) return null;
  const auth = await fb();
  if (redirectChecked) return null;
  redirectChecked = true;
  try {
    await authMod!.getRedirectResult(auth);
    return null;
  } catch (e) {
    return authMessage(e);
  }
}

const fromUser = (u: User): Session => ({
  uid: u.uid,
  phone: u.phoneNumber,
  email: u.email,
  name: u.displayName,
  provider: u.providerData.some((p) => p.providerId === 'google.com') ? 'google' : 'phone',
  token: (refresh) => u.getIdToken(refresh),
});

let verifier: RecaptchaVerifier | null = null;
async function recaptcha(containerId: string) {
  const auth = await fb();
  const { RecaptchaVerifier } = await import('firebase/auth');
  verifier?.clear();
  verifier = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
  return verifier;
}

// ------------------------------------------------------------------------------- test stand-in

const TEST_KEY = 'ra_test_session';
const testListeners = new Set<(s: Session | null) => void>();
function testSession(): Session | null {
  try {
    const raw = localStorage.getItem(TEST_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { uid: string; phone: string | null; provider: 'test' | 'google' };
    return { ...s, email: null, name: null, provider: s.provider === 'google' ? 'google' : 'test', token: async () => `test.${s.uid}.${s.phone ?? 'none'}` };
  } catch {
    return null;
  }
}
function setTestSession(s: { uid: string; phone: string | null; provider: 'test' | 'google' } | null) {
  if (s) localStorage.setItem(TEST_KEY, JSON.stringify(s));
  else localStorage.removeItem(TEST_KEY);
  const cur = testSession();
  testListeners.forEach((l) => l(cur));
}
/** Test numbers that behave like a VoIP line or a number already in use. */
const testPending = { phone: '', link: false };

// ------------------------------------------------------------------------------- API

export function onSession(cb: (s: Session | null) => void): () => void {
  if (GUEST) {
    cb(guestSession());
    return () => {};
  }
  if (TEST_AUTH) {
    testListeners.add(cb);
    cb(testSession());
    return () => testListeners.delete(cb);
  }
  let off = () => {};
  let dead = false;
  void fb().then(async (auth) => {
    const { onIdTokenChanged } = await import('firebase/auth');
    if (dead) return;
    off = onIdTokenChanged(auth, (u) => cb(u ? fromUser(u) : null));
  });
  return () => {
    dead = true;
    off();
  };
}

let confirmation: ConfirmationResult | null = null;

/** Text a code to `phone` (E.164). `link` adds the number to the signed-in Google account. */
export async function sendCode(phone: string, containerId: string, link = false) {
  if (TEST_AUTH) {
    if (!/^\+1\d{10}$/.test(phone)) throw Object.assign(new Error(), { code: 'auth/invalid-phone-number' });
    testPending.phone = phone;
    testPending.link = link;
    return;
  }
  const auth = await fb();
  const v = await recaptcha(containerId);
  const { signInWithPhoneNumber, linkWithPhoneNumber } = await import('firebase/auth');
  confirmation = link && auth.currentUser ? await linkWithPhoneNumber(auth.currentUser, phone, v) : await signInWithPhoneNumber(auth, phone, v);
}

export async function confirmCode(code: string) {
  if (TEST_AUTH) {
    if (code !== '123456') throw Object.assign(new Error(), { code: 'auth/invalid-verification-code' });
    const cur = testSession();
    if (testPending.link && cur) setTestSession({ uid: cur.uid, phone: testPending.phone, provider: 'google' });
    else setTestSession({ uid: `p${testPending.phone.slice(-10)}`, phone: testPending.phone, provider: 'test' });
    return;
  }
  if (!confirmation) throw Object.assign(new Error(), { code: 'auth/code-expired' });
  const cred = await confirmation.confirm(code);
  confirmation = null;
  await cred.user.getIdToken(true); // pick up the phone_number claim right away
}

export async function signInWithGoogle() {
  if (TEST_AUTH) {
    setTestSession({ uid: `g${Math.random().toString(36).slice(2, 10)}`, phone: null, provider: 'google' });
    return;
  }
  // Already loaded (warmAuth)? Then open the Google window right now, inside the tap.
  const auth = fbAuth ?? (await fb());
  const m = authMod ?? (await import('firebase/auth'));
  const provider = new m.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await m.signInWithPopup(auth, provider);
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/popup-blocked') await m.signInWithRedirect(auth, provider);
    else throw e;
  }
}

export async function signOut() {
  if (TEST_AUTH) return setTestSession(null);
  const auth = await fb();
  const { signOut } = await import('firebase/auth');
  await signOut(auth);
}

/** Stable per-device id (random, stored) mixed with hardware traits, hashed. */
export async function deviceHash(): Promise<string> {
  let id = '';
  try {
    id = localStorage.getItem('ra_device') ?? '';
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('ra_device', id);
    }
  } catch {
    /* private mode */
  }
  const n = navigator as Navigator & { deviceMemory?: number };
  const traits = [id, n.userAgent, n.language, n.hardwareConcurrency, n.deviceMemory, screen.width, screen.height, screen.colorDepth, Intl.DateTimeFormat().resolvedOptions().timeZone].join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(traits));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
