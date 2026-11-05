import type { Metadata } from 'next';
import Link from 'next/link';
import InfoShell from '@/components/info/InfoShell';
import { FAQ } from '@/lib/info-pages';

export const metadata: Metadata = { title: 'Help & FAQ · RivalArcade', description: 'Answers about contests, prizes, cash play, withdrawals, fair play and your account.' };

const CARDS = [
  { href: '/rules', title: 'Contest rules', text: 'Formats, prizes, ties and refunds.' },
  { href: '/fair-play', title: 'Fair play', text: 'How every match is kept fair.' },
  { href: '/responsible-play', title: 'Responsible play', text: 'Limits, breaks and support.' },
  { href: '/contact', title: 'Contact support', text: 'We usually reply within a day.' },
];

export default function HelpPage() {
  return (
    <InfoShell kicker="Help center" title="How can we help?" summary="Quick answers about playing, contests, cash and your account." current="/help">
      <div className="grid sm:grid-cols-2 gap-3 mb-10">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="group rounded-2xl p-5 bg-gradient-to-br from-white/[0.06] to-white/[0.02] ring-1 ring-white/[0.08] hover:ring-cyan-400/40 transition">
            <div className="text-white font-black">{c.title} <span className="text-cyan-300 group-hover:translate-x-0.5 inline-block transition">→</span></div>
            <div className="text-sm text-slate-400 mt-1">{c.text}</div>
          </Link>
        ))}
      </div>
      <h2 className="text-xl font-black text-white mb-3">Frequently asked</h2>
      <div className="space-y-2" data-testid="faq">
        {FAQ.map((f) => (
          <details key={f.q} className="group rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] open:ring-cyan-400/30">
            <summary className="cursor-pointer list-none p-4 sm:p-5 flex items-center justify-between gap-4 font-bold text-white">
              {f.q}
              <span className="w-7 h-7 shrink-0 rounded-full bg-white/[0.06] flex items-center justify-center text-cyan-300 transition group-open:rotate-45">+</span>
            </summary>
            <p className="px-4 sm:px-5 pb-5 -mt-1 text-[15px] leading-relaxed text-slate-300">{f.a}</p>
          </details>
        ))}
      </div>
    </InfoShell>
  );
}
