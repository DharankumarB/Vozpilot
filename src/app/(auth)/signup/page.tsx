'use client';

/**
 * Signup.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from '@/components/ui';
import { apiRequest } from '@/components/hooks';

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    const result = await apiRequest<{ needsEmailConfirmation: boolean; message: string }>('/api/auth/signup', 'POST', {
      full_name: fullName,
      email,
      password,
      timezone,
    });
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? 'Could not create your account.');
      return;
    }
    if (result.data.needsEmailConfirmation) {
      setNotice(result.data.message);
      return;
    }
    router.push('/onboarding');
    router.refresh();
  };

  return (
    <section className="vp-card flex flex-col gap-5 p-5 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-text-primary">Create your account</h1>
        <p className="mt-1 text-xs text-text-secondary">VozPilot will guide you through onboarding next.</p>
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
        <Field label="Full name" htmlFor="signup-name" required>
          <Input
            id="signup-name"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Dharan Kumar"
            maxLength={120}
            required
          />
        </Field>

        <Field label="Email" htmlFor="signup-email" required>
          <Input
            id="signup-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </Field>

        <Field
          label="Password"
          htmlFor="signup-password"
          error={error}
          hint="At least 8 characters, including a letter and a number or symbol."
          required
        >
          <Input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            minLength={8}
            required
          />
        </Field>

        <Field label="Timezone" htmlFor="signup-timezone" hint="Detected from your device. You can change it later.">
          <Input id="signup-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} maxLength={64} />
        </Field>

        <Button type="submit" variant="primary" loading={loading} disabled={fullName.trim().length === 0 || email.length === 0 || password.length < 8}>
          Create account
        </Button>
      </form>

      <p className="text-center text-xs text-text-muted">
        Already have an account?{' '}
        <Link href="/login" className="text-violet-soft hover:underline">
          Sign in
        </Link>
      </p>
    </section>
  );
}
