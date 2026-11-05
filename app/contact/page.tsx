import type { Metadata } from 'next';
import InfoShell from '@/components/info/InfoShell';
import ContactForm from '@/components/info/ContactForm';

export const metadata: Metadata = { title: 'Contact · RivalArcade', description: 'Get help with your account, a match result, payments or privacy requests.' };

export default function ContactPage() {
  return (
    <InfoShell kicker="Support" title="Contact us" summary="Account, match results, payments, privacy and deletion requests — tell us what’s up and we’ll get back to you, usually within one business day." current="/contact">
      <ContactForm />
    </InfoShell>
  );
}
