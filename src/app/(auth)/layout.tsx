import Link from 'next/link';

export const metadata = {
  title: 'Sign in',
};

/**
 * Auth layout - a quiet, focused shell for login / signup / recovery.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-ink-950 px-4 py-10">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-violet-accent/8 blur-3xl" />
      </div>

      <div className="relative flex w-full max-w-md flex-col gap-6">
        <Link href="/" className="flex items-center justify-center gap-2.5">
          <span
            aria-hidden
            className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-accent to-violet-deep text-sm font-bold text-white"
          >
            V
          </span>
          <span>
            <span className="block text-base font-semibold leading-tight tracking-tight text-text-primary">VozPilot</span>
            <span className="block text-[10px] leading-tight text-text-muted">by VozLook Studios</span>
          </span>
        </Link>

        {!configured ? (
          <div
            role="alert"
            className="rounded-[var(--radius-card)] border border-warning/30 bg-warning/8 p-4 text-xs leading-relaxed text-warning"
          >
            <strong className="block font-semibold">Supabase is not configured.</strong>
            Set <code className="rounded bg-ink-800 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-ink-800 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your environment, then apply the
            migrations in <code className="rounded bg-ink-800 px-1">supabase/migrations</code>. Authentication cannot work until
            then - VozPilot will not pretend otherwise.
          </div>
        ) : null}

        {children}
      </div>

      <p className="relative mt-8 max-w-md text-center text-[11px] leading-relaxed text-text-muted">
        Your Autonomous AI Chief-of-Staff. Plan less. Execute more.
      </p>
    </main>
  );
}
