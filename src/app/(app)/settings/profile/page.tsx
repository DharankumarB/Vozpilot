'use client';

/**
 * Settings — profile and timezone.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ErrorState, Field, Input, SectionHeader, Skeleton, useToast } from '@/components/ui';
import { apiRequest, useApi } from '@/components/hooks';

interface ProfilePayload {
  profile: { id: string; full_name: string; avatar_url: string | null; timezone: string; locale: string } | null;
  email: string;
}

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Paris',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export default function ProfileSettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data, error, loading, reload } = useApi<ProfilePayload>('/api/profile');

  const [fullName, setFullName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [locale, setLocale] = useState('en-US');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.profile) {
      setFullName(data.profile.full_name ?? '');
      setTimezone(data.profile.timezone ?? 'UTC');
      setLocale(data.profile.locale ?? 'en-US');
    }
  }, [data]);

  const save = async () => {
    if (fullName.trim().length < 1) {
      setFormError('Your name cannot be empty.');
      return;
    }
    setFormError(null);
    setSaving(true);
    const result = await apiRequest('/api/profile', 'PATCH', {
      full_name: fullName.trim(),
      timezone,
      locale,
    });
    setSaving(false);
    if (result.ok) {
      toast('Profile saved.');
      router.refresh();
      reload();
    } else {
      setFormError(result.error ?? 'Could not save your profile.');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) return <ErrorState description={error} onRetry={reload} />;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">Profile</h1>
        <p className="mt-1 text-sm text-text-secondary">How VozPilot addresses you and which timezone it schedules in.</p>
      </header>

      <section className="vp-card flex flex-col gap-4 p-4 sm:p-5">
        <SectionHeader title="Your details" />

        <Field label="Full name" htmlFor="profile-name" error={formError} required>
          <Input id="profile-name" value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={120} />
        </Field>

        <Field label="Email" htmlFor="profile-email" hint="Email changes are handled by your authentication provider.">
          <Input id="profile-email" value={data?.email ?? ''} disabled readOnly />
        </Field>

        <Field
          label="Timezone"
          htmlFor="profile-timezone"
          hint="All scheduling and deadline maths use this timezone. Timestamps are stored in UTC."
        >
          <select id="profile-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} className="vp-input">
            {Array.from(new Set([timezone, ...TIMEZONES])).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Locale" htmlFor="profile-locale">
          <select id="profile-locale" value={locale} onChange={(event) => setLocale(event.target.value)} className="vp-input">
            {['en-US', 'en-GB', 'en-IN', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'ja-JP'].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex justify-end">
          <Button variant="primary" onClick={save} loading={saving}>
            Save changes
          </Button>
        </div>
      </section>
    </div>
  );
}
