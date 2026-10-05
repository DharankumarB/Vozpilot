'use client';

/**
 * Settings — notification preferences and working hours.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ErrorState, Field, Input, SectionHeader, Skeleton, Switch, useToast } from '@/components/ui';
import { apiRequest, useApi } from '@/components/hooks';
import type { UserPreferences } from '@/lib/types';

export default function NotificationSettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data, error, loading, reload } = useApi<{ preferences: UserPreferences | null }>('/api/preferences');

  const [form, setForm] = useState({
    timezone: 'UTC',
    workday_start: '09:00',
    workday_end: '21:00',
    break_minutes: 10,
    max_daily_blocks: 6,
    briefing_enabled: true,
    deadline_alerts: true,
    project_alerts: true,
    goal_alerts: true,
    inbox_alerts: true,
    agent_alerts: false,
    quiet_hours_start: '',
    quiet_hours_end: '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.preferences) {
      const preferences = data.preferences;
      setForm({
        timezone: preferences.timezone,
        workday_start: preferences.workday_start,
        workday_end: preferences.workday_end,
        break_minutes: preferences.break_minutes,
        max_daily_blocks: preferences.max_daily_blocks,
        briefing_enabled: preferences.briefing_enabled,
        deadline_alerts: preferences.deadline_alerts,
        project_alerts: preferences.project_alerts,
        goal_alerts: preferences.goal_alerts,
        inbox_alerts: preferences.inbox_alerts,
        agent_alerts: preferences.agent_alerts,
        quiet_hours_start: preferences.quiet_hours_start ?? '',
        quiet_hours_end: preferences.quiet_hours_end ?? '',
      });
    }
  }, [data]);

  const save = async () => {
    if (form.workday_start >= form.workday_end) {
      setFormError('Your workday end time must be after the start time.');
      return;
    }
    setFormError(null);
    setSaving(true);
    const result = await apiRequest('/api/preferences', 'PATCH', {
      ...form,
      quiet_hours_start: form.quiet_hours_start || null,
      quiet_hours_end: form.quiet_hours_end || null,
    });
    setSaving(false);
    if (result.ok) {
      toast('Preferences saved.');
      router.refresh();
      reload();
    } else {
      setFormError(result.error ?? 'Could not save your preferences.');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) return <ErrorState description={error} onRetry={reload} />;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">Notifications & schedule</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Choose what VozPilot tells you about and when. Web notifications only — WhatsApp is paused for this version.
        </p>
      </header>

      <section className="vp-card p-4 sm:p-5">
        <SectionHeader title="Alerts" />
        <div className="mt-2 divide-y divide-[var(--vp-border)]">
          <Switch
            label="Daily briefing"
            description="A morning summary of priorities, risks and your focus blocks."
            checked={form.briefing_enabled}
            onChange={(value) => setForm({ ...form, briefing_enabled: value })}
          />
          <Switch
            label="Deadline alerts"
            description="Warn me when tasks are due soon or overdue."
            checked={form.deadline_alerts}
            onChange={(value) => setForm({ ...form, deadline_alerts: value })}
          />
          <Switch
            label="Project alerts"
            description="Tell me when a project becomes at risk."
            checked={form.project_alerts}
            onChange={(value) => setForm({ ...form, project_alerts: value })}
          />
          <Switch
            label="Goal alerts"
            description="Celebrate milestones and flag goals falling behind."
            checked={form.goal_alerts}
            onChange={(value) => setForm({ ...form, goal_alerts: value })}
          />
          <Switch
            label="Inbox alerts"
            description="Notify me when VozInbox finds an action in a message."
            checked={form.inbox_alerts}
            onChange={(value) => setForm({ ...form, inbox_alerts: value })}
          />
          <Switch
            label="Agent activity alerts"
            description="Off by default so autonomous work does not become noise."
            checked={form.agent_alerts}
            onChange={(value) => setForm({ ...form, agent_alerts: value })}
          />
        </div>
      </section>

      <section className="vp-card flex flex-col gap-4 p-4 sm:p-5">
        <SectionHeader title="Working hours" subtitle="VozDay only schedules focus blocks inside this window." />
        {formError ? (
          <p role="alert" className="text-xs text-danger">
            {formError}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Workday start" htmlFor="pref-start">
            <Input id="pref-start" type="time" value={form.workday_start} onChange={(event) => setForm({ ...form, workday_start: event.target.value })} />
          </Field>
          <Field label="Workday end" htmlFor="pref-end">
            <Input id="pref-end" type="time" value={form.workday_end} onChange={(event) => setForm({ ...form, workday_end: event.target.value })} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Break minutes" htmlFor="pref-break" hint="Inserted after sustained focus.">
            <Input
              id="pref-break"
              type="number"
              min={0}
              max={120}
              value={form.break_minutes}
              onChange={(event) => setForm({ ...form, break_minutes: Number.parseInt(event.target.value, 10) || 0 })}
            />
          </Field>
          <Field label="Max focus blocks per day" htmlFor="pref-blocks" hint="Keeps the plan realistic.">
            <Input
              id="pref-blocks"
              type="number"
              min={1}
              max={16}
              value={form.max_daily_blocks}
              onChange={(event) => setForm({ ...form, max_daily_blocks: Number.parseInt(event.target.value, 10) || 1 })}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quiet hours start" htmlFor="pref-quiet-start" hint="Optional. Low and medium alerts are suppressed.">
            <Input
              id="pref-quiet-start"
              type="time"
              value={form.quiet_hours_start}
              onChange={(event) => setForm({ ...form, quiet_hours_start: event.target.value })}
            />
          </Field>
          <Field label="Quiet hours end" htmlFor="pref-quiet-end">
            <Input
              id="pref-quiet-end"
              type="time"
              value={form.quiet_hours_end}
              onChange={(event) => setForm({ ...form, quiet_hours_end: event.target.value })}
            />
          </Field>
        </div>

        <div className="flex justify-end">
          <Button variant="primary" onClick={save} loading={saving}>
            Save preferences
          </Button>
        </div>
      </section>
    </div>
  );
}
