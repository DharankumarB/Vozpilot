'use client';

/**
 * Settings — integrations.
 *
 * Honest status reporting: an integration that has no credentials is shown as
 * "Not configured" with exactly what is required. Nothing is faked, and the rest
 * of VozPilot keeps working without any integration.
 */

import { useEffect, useState } from 'react';
import { Calendar, Github, Mail, MessageCircle, Webhook } from 'lucide-react';
import { Button, ErrorState, Pill, SectionHeader, SkeletonList, useToast } from '@/components/ui';
import { apiRequest, useApi } from '@/components/hooks';
import type { Integration, IntegrationProvider } from '@/lib/types';

interface CatalogEntry {
  provider: IntegrationProvider;
  label: string;
  icon: typeof Calendar;
  status: string;
  description: string;
  required: string[];
  paused?: boolean;
}

const CATALOG: CatalogEntry[] = [
  {
    provider: 'calendar',
    label: 'Calendar',
    icon: Calendar,
    status: 'not_configured',
    description: 'Read fixed commitments so VozDay never schedules over them.',
    required: ['CALENDAR_PROVIDER_CLIENT_ID', 'CALENDAR_PROVIDER_CLIENT_SECRET'],
  },
  {
    provider: 'email',
    label: 'Email',
    icon: Mail,
    status: 'not_configured',
    description: 'Forward important messages into the inbox for VozInbox to analyse.',
    required: ['EMAIL_IMAP_HOST', 'EMAIL_IMAP_USER', 'EMAIL_IMAP_PASSWORD'],
  },
  {
    provider: 'github',
    label: 'GitHub',
    icon: Github,
    status: 'not_configured',
    description: 'Link issues and pull requests to projects and tasks.',
    required: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY'],
  },
  {
    provider: 'webhook',
    label: 'Webhook',
    icon: Webhook,
    status: 'not_configured',
    description: 'Push VozPilot events to your own automation.',
    required: ['WEBHOOK_TARGET_URL', 'WEBHOOK_SIGNING_SECRET'],
  },
  {
    provider: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    status: 'paused',
    description: 'Paused for this version. The notification channel registry already supports it.',
    required: [],
    paused: true,
  },
];

export default function IntegrationsSettingsPage() {
  const { toast } = useToast();
  const { data, error, loading, reload } = useApi<{ integrations: Integration[] }>('/api/integrations');
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusFor = (provider: IntegrationProvider) => data?.integrations?.find((entry) => entry.provider === provider)?.status ?? null;

  const connect = async (provider: IntegrationProvider) => {
    setSaving(provider);
    const result = await apiRequest('/api/integrations', 'PATCH', { provider, status: 'configured' });
    setSaving(null);
    if (result.ok) {
      toast('Integration marked as configured.');
      reload();
    } else {
      toast(result.error ?? 'Could not update the integration.', 'error');
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">Integrations</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Optional connections. VozPilot is fully usable without any of them — statuses below are always truthful.
        </p>
      </header>

      {loading ? <SkeletonList rows={3} /> : null}
      {error ? <ErrorState description={error} onRetry={reload} /> : null}

      <ul className="flex flex-col gap-3">
        {CATALOG.map((entry) => {
          const Icon = entry.icon;
          const status = entry.paused ? 'paused' : statusFor(entry.provider) ?? 'not_configured';
          const connected = status === 'connected' || status === 'configured';

          return (
            <li key={entry.provider} className="vp-card flex min-w-0 flex-col gap-3 p-4">
              <div className="flex min-w-0 items-start gap-3">
                <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-ink-800 text-text-secondary">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-text-primary">{entry.label}</h2>
                    <Pill tone={connected ? 'success' : entry.paused ? 'warning' : 'neutral'}>
                      {entry.paused ? 'Paused' : connected ? 'Configured' : 'Not configured'}
                    </Pill>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">{entry.description}</p>
                </div>
              </div>

              {entry.paused ? (
                <p className="rounded-[var(--radius-control)] border border-warning/25 bg-warning/8 p-3 text-[11px] leading-relaxed text-warning">
                  WhatsApp delivery is paused for this version. Web notifications remain fully active and the channel registry is
                  ready, so enabling WhatsApp later needs no changes to VozCore.
                </p>
              ) : (
                <>
                  <SectionHeader title="Required configuration" />
                  <ul className="flex flex-wrap gap-1.5">
                    {entry.required.map((variable) => (
                      <li key={variable}>
                        <code className="rounded bg-ink-800 px-2 py-1 text-[10px] text-text-secondary">{variable}</code>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] leading-relaxed text-text-muted">
                    Set these as server-side environment variables, then mark the integration configured. Credentials are never
                    stored in the browser bundle.
                  </p>
                  <div className="flex justify-end">
                    <Button size="sm" variant={connected ? 'secondary' : 'primary'} loading={saving === entry.provider} onClick={() => connect(entry.provider)}>
                      {connected ? 'Re-check' : 'Mark configured'}
                    </Button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
