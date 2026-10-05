import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = {
  title: {
    default: 'VozPilot - Your Autonomous AI Chief-of-Staff',
    template: '%s | VozPilot',
  },
  description:
    'VozPilot is an agentic personal operating system that observes, plans, prioritises and acts across your goals, projects, tasks and daily schedule. By VozLook Studios.',
  applicationName: 'VozPilot',
  authors: [{ name: 'VozLook Studios' }],
  keywords: ['AI chief of staff', 'agentic AI', 'productivity', 'goals', 'projects', 'tasks', 'VozPilot', 'VozLook Studios'],
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#07070a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-ink-950 text-text-primary antialiased">
        <a
          href="#vp-main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-violet-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to main content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
