import type { MetadataRoute } from 'next';

/** Installed to the Home Screen, RivalArcade runs full screen in portrait with no browser UI. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RivalArcade',
    short_name: 'RivalArcade',
    description: 'Competitive 3D skill games with your own avatar.',
    start_url: '/',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'portrait',
    background_color: '#0b0b10',
    theme_color: '#0b0b10',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
