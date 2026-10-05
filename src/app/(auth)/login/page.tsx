'use client';

/**
 * Login.
 */

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Input } from '@/components/ui';
import { apiRequest } from '@/components/hooks';

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginSkeleton() {
  return <section className="vp-card h-80 animate-pulse" aria-busy="true" aria-label="Loading sign in" />;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice] = useState<string | null>(params.get('verified') ? 'Email confirmed. You can sign in now.' : null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    const result = await apiRequest<{ redirect: string }>('/api/auth/login', 'POST', { email, password });
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? 'Could not sign in.');
      return;
    }
    router.push(result.data.redirect ?? '/dashboard');
    router.refresh();
  };

  return (
    <section className="vp-card flex flex-col gap-5 p-5 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-text-primary">Welcome back</h1>
        <p className="mt-1 text-xs text-text-secondary">Sign in to your autonomous chief-of-staff.</p>
      </header>

      {params.get('setup') === 'required' ? (
        <p role="alert" className="rounded-[var(--radius-control)] border border-warning/30 bg-warning/8 p-3 text-[11px] leading-relaxed text-warning">
          VozPilot is not connected to a database yet, so sign-in is unavailable.
        </p>
      ) : null}

      {params.get('next') ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--vp-border)] bg-ink-850/60 p-3 text-[11px] text-text-muted">
          Sign in to continue to {params.get('next')}.
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="rounded-[var(--radius-control)] border border-success/30 bg-success/8 p-3 text-[11px] text-success">
          {notice}
        </p>
      ) : null}

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Email" htmlFor="login-email" required>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </Field>

        <Field label="Password" htmlFor="login-password" error={error} required>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            required
          />
        </Field>

        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-[11px] text-violet-soft hover:underline">
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" variant="primary" loading={loading} disabled={email.length === 0 || password.length === 0}>
          Sign in
        </Button>
      </form>

      <p className="text-center text-xs text-text-muted">
        New to VozPilot?{' '}
        <Link href="/signup" className="text-violet-soft hover:underline">
          Create an account
        </Link>
      </p>
    </section>
  );
}
