import React from 'react';

/** The equipped banner, drawn as the backdrop behind an avatar (wardrobe preview, profile card). */
export function bannerStyle(bannerId?: string): React.CSSProperties {
  switch (bannerId) {
    case 'banner_neon_city':
      return {
        background: [
          'radial-gradient(circle at 50% 52%, #fde68a 0 17%, rgba(253,230,138,0) 17.5%)',
          'linear-gradient(0deg, #0f0524 0 16%, transparent 16%)',
          'repeating-linear-gradient(90deg, #0f0524 0 9%, transparent 9% 12%, #0f0524 12% 18%, transparent 18% 22%)',
          'linear-gradient(180deg, #2e1065 0%, #db2777 62%, #f59e0b 100%)',
        ].join(','),
        backgroundSize: '100% 100%, 100% 100%, 100% 34%, 100% 100%',
        backgroundPosition: 'center, center, bottom, center',
        backgroundRepeat: 'no-repeat',
      };
    case 'banner_grandmaster':
      return {
        background: [
          'radial-gradient(circle at 50% 40%, rgba(255,247,237,0.35), rgba(255,247,237,0) 55%)',
          'repeating-linear-gradient(60deg, rgba(255,255,255,0.12) 0 2px, transparent 2px 22px)',
          'repeating-linear-gradient(-60deg, rgba(255,255,255,0.12) 0 2px, transparent 2px 22px)',
          'linear-gradient(135deg, #78350f, #f59e0b 50%, #92400e)',
        ].join(','),
      };
    default:
      return {
        background: [
          'linear-gradient(rgba(56,189,248,0.18) 1px, transparent 1px)',
          'linear-gradient(90deg, rgba(56,189,248,0.18) 1px, transparent 1px)',
          'radial-gradient(circle at 50% 45%, #16213a, #0a0b12 70%)',
        ].join(','),
        backgroundSize: '22px 22px, 22px 22px, 100% 100%',
      };
  }
}

export default function BannerBackdrop({ bannerId, className = '' }: { bannerId?: string; className?: string }) {
  return <div className={`absolute inset-0 ${className}`} style={bannerStyle(bannerId)} data-testid="banner-backdrop" data-banner={bannerId ?? 'banner_rookie'} aria-hidden />;
}
