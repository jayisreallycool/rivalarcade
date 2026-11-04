import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Item Lab', robots: { index: false, follow: false } };

export default function ItemLabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
