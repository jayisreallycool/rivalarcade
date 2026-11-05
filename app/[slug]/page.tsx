import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import InfoShell from '@/components/info/InfoShell';
import { INFO_PAGES } from '@/lib/info-pages';

export const dynamicParams = false;
export function generateStaticParams() {
  return INFO_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = INFO_PAGES.find((x) => x.slug === slug);
  return p ? { title: `${p.title} · RivalArcade`, description: p.summary } : {};
}

function Paragraphs({ body }: { body: string[] }) {
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: string) => {
    if (!list.length) return;
    out.push(
      <ul key={k} className="space-y-2 my-3">
        {list.map((b, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
            <span>{b}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  body.forEach((p, i) => {
    if (p.startsWith('• ')) list.push(p.slice(2));
    else {
      flush(`l${i}`);
      out.push(
        <p key={i} className="my-3">
          {p}
        </p>,
      );
    }
  });
  flush('end');
  return <>{out}</>;
}

export default async function InfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = INFO_PAGES.find((p) => p.slug === slug);
  if (!page) notFound();
  const toc = (
    <nav aria-label="On this page" className="sticky top-32">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">On this page</div>
      <ul className="space-y-2 text-sm">
        {page.sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className="text-slate-400 hover:text-white">
              {s.heading}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
  return (
    <InfoShell kicker={page.kicker} title={page.title} summary={page.summary} updated={page.updated} current={`/${page.slug}`} aside={toc}>
      <div className="space-y-4">
        {page.sections.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-32 rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] p-5 sm:p-6">
            <h2 className="text-lg font-black text-white">{s.heading}</h2>
            <div className="text-[15px] leading-relaxed text-slate-300">
              <Paragraphs body={s.body} />
            </div>
          </section>
        ))}
      </div>
    </InfoShell>
  );
}
