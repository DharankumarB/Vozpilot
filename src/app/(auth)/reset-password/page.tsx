'use client';

/**
 * Set a new password from a recovery link.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from '@/components/ui';
import { apiRequest } from '@/components/hooks';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setError(null);
    setLoading(true);
    const result = await apiRequest('/api/auth/reset-password', 'POST', { password });
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not update your password.');
      return;
    }
    router.push('/login?verified=1');
  };

  return (
    <section className="vp-card flex flex-col gap-5 p-5 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-text-primary">Choose a new password</h1>
        <p className="mt-1 text-xs text-text-secondary">This link is single-use and expires shortly.</p>
      </header>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="New password" htmlFor="reset-password" error={error} required>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </Field>

        <Field label="Confirm password" htmlFor="reset-confirm" required>
          <Input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            minLength={8}
            required
          />
        </Field>

        <Button type="submit" variant="primary" loading={loading}>
          Update password
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
