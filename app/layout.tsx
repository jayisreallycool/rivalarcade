import type {Metadata, Viewport} from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RivalArcade - Competitive Skill Gaming & Playable Custom Avatars',
  description: 'Mobile-first competitive arcade platform with playable custom avatars, 1v1 skill matches, automated tournaments, and cosmetic dressing room.',
  openGraph: {
    title: 'RivalArcade - Competitive Skill Gaming',
    description: 'Play competitive arcade games with your own custom avatar. 1v1 duels, automated tournaments, and zero pay-to-win.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RivalArcade - Competitive Skill Gaming',
    description: 'Play competitive arcade games with your own custom avatar.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0b10',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className="dark bg-[#0a0b10] text-slate-100 antialiased selection:bg-cyan-500 selection:text-black">
      <body suppressHydrationWarning className="min-h-screen bg-[#0a0b10] overflow-x-hidden font-sans">
        {children}
      </body>
    </html>
  );
}
