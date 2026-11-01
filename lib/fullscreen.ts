/**
 * Full-screen play on phones.
 *
 *  - Android / desktop: the Fullscreen API hides the browser bars; portrait is then locked.
 *    It must be called from a tap (user gesture), so we call it when a match is opened.
 *  - iPhone Safari has no element fullscreen. Installed to the Home Screen the app runs with
 *    `display: fullscreen` (see app/manifest.ts) and no browser UI at all; in the browser the
 *    game still fills the whole viewport (100dvh, safe-area aware).
 */

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: (opts?: unknown) => Promise<void> | void };

export function isFullscreen() {
  if (typeof document === 'undefined') return false;
  const d = document as FsDoc;
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Running as an installed app (Home Screen), where the OS already gives us the full screen. */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return Boolean(nav.standalone) || window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches;
}

export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && /Mobile/.test(navigator.userAgent));
}

const touchDevice = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** Enter full screen for gameplay (touch devices only — desktop players keep their window). Call from a tap. */
export function enterGameFullscreen() {
  if (typeof document === 'undefined' || !touchDevice() || isStandalone() || isFullscreen()) return;
  const el = document.documentElement as FsEl;
  try {
    const req = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
    Promise.resolve(req)
      .then(() => {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        return o?.lock?.('portrait');
      })
      .catch(() => {});
  } catch {
    /* not supported (iPhone Safari) — the layout is already full-viewport */
  }
}

export function exitGameFullscreen() {
  if (!isFullscreen()) return;
  const d = document as FsDoc;
  try {
    const o = screen.orientation as ScreenOrientation & { unlock?: () => void };
    o?.unlock?.();
    void Promise.resolve(d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()).catch(() => {});
  } catch {
    /* ignore */
  }
}
