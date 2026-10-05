'use client';

/**
 * Password recovery request.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Button, Field, Input } from '@/components/ui';
import { apiRequest } from '@/components/hooks';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    const result = await apiRequest<{ message: string }>('/api/auth/forgot-password', 'POST', { email });
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? 'Could not send the reset link.');
      return;
    }
    setNotice(result.data.message);
  };

  return (
    <section className="vp-card flex flex-col gap-5 p-5 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-text-primary">Reset your password</h1>
        <p className="mt-1 text-xs text-text-secondary">We will email you a secure reset link.</p>
      </header>

      {notice ? (
        <p role="status" className="rounded-[var(--radius-control)] border border-success/30 bg-success/8 p-3 text-[11px] leading-relaxed text-success">
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
        <Field label="Email" htmlFor="forgot-email" error={error} required>
          <Input
            id="forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </Field>

        <Button type="submit" variant="primary" loading={loading} disabled={email.length === 0}>
          Send reset link
        </Button>
      </form>

      <p className="text-center text-xs text-text-muted">
        <Link href="/login" className="text-violet-soft hover:underline">
          Back to sign in
        </Link>
      </p>
    </section>
  );
}
