'use client';

/**
 * Settings — AI permissions.
 *
 * This is the explicit permission model that gates every agent tool call.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { Button, ErrorState, SectionHeader, Skeleton, Switch, useToast } from '@/components/ui';
import { apiRequest, useApi } from '@/components/hooks';
import type { AiPermissions } from '@/lib/types';

type PermissionKey = keyof Omit<AiPermissions, 'user_id' | 'created_at' | 'updated_at'>;

const GROUPS: Array<{ title: string; description: string; rows: Array<{ key: PermissionKey; label: string; hint?: string }> }> = [
  {
    title: 'Write actions',
    description: 'VozCore may perform these without asking each time.',
    rows: [
      { key: 'create_tasks', label: 'Create tasks' },
      { key: 'update_tasks', label: 'Update tasks' },
      { key: 'reschedule_tasks', label: 'Reschedule tasks', hint: 'Move due dates when the plan changes.' },
      { key: 'create_reminders', label: 'Create reminders' },
      { key: 'create_milestones', label: 'Create milestones' },
      { key: 'update_goals', label: 'Update goals' },
      { key: 'update_projects', label: 'Update projects' },
      { key: 'update_project_status', label: 'Update project status' },
      { key: 'plan_daily_schedule', label: 'Plan the daily schedule' },
    ],
  },
  {
    title: 'Creation of larger structures',
    description: 'Off by default: VozCore asks before creating goals or projects.',
    rows: [
      { key: 'create_goals', label: 'Create goals' },
      { key: 'create_projects', label: 'Create projects' },
    ],
  },
  {
    title: 'Sensitive actions',
    description: 'Destructive or bulk operations. These always need confirmation unless you disable confirmation below.',
    rows: [
      { key: 'delete_tasks', label: 'Delete tasks automatically' },
      { key: 'delete_projects', label: 'Delete projects automatically' },
      { key: 'delete_goals', label: 'Delete goals automatically' },
      { key: 'bulk_operations', label: 'Allow bulk modifications' },
      { key: 'sensitive_actions', label: 'Allow other sensitive actions' },
    ],
  },
];

export default function AiPermissionsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data, error, loading, reload } = useApi<{ permissions: AiPermissions | null }>('/api/ai-permissions');

  const [form, setForm] = useState<Record<string, boolean>>({});
  const [requireConfirmation, setRequireConfirmation] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.permissions) {
      const permissions = data.permissions;
      const next: Record<string, boolean> = {};
      for (const group of GROUPS) {
        for (const row of group.rows) next[row.key] = permissions[row.key] === true;
      }
      setForm(next);
      setRequireConfirmation(permissions.require_confirmation !== false);
    }
  }, [data]);

  const save = async () => {
    setFormError(null);
    setSaving(true);
    const result = await apiRequest('/api/ai-permissions', 'PATCH', { ...form, require_confirmation: requireConfirmation });
    setSaving(false);
    if (result.ok) {
      toast('AI permissions saved.');
      router.refresh();
      reload();
    } else {
      setFormError(result.error ?? 'Could not save AI permissions.');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (error) return <ErrorState description={error} onRetry={reload} />;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">AI permissions</h1>
        <p className="mt-1 text-sm text-text-secondary">
          VozCore requests tool calls; the backend decides. Anything switched off here is rejected before it touches your data.
        </p>
      </header>

      <section className="vp-card flex flex-col gap-2 p-4 sm:p-5">
        <div className="flex items-start gap-2.5">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-violet-soft" />
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Confirmation for sensitive actions</h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              When enabled, VozCore shows a preview and waits for your approval before running anything sensitive. Read actions are
              always allowed.
            </p>
          </div>
        </div>
        <Switch label="Ask me before sensitive actions" checked={requireConfirmation} onChange={setRequireConfirmation} />
      </section>

      {GROUPS.map((group) => (
        <section key={group.title} className="vp-card p-4 sm:p-5">
          <SectionHeader title={group.title} subtitle={group.description} />
          <div className="mt-2 divide-y divide-[var(--vp-border)]">
            {group.rows.map((row) => (
              <Switch
                key={row.key}
                label={row.label}
                description={row.hint}
                checked={form[row.key] === true}
                onChange={(value) => setForm({ ...form, [row.key]: value })}
              />
            ))}
          </div>
        </section>
      ))}

      {formError ? (
        <p role="alert" className="text-xs text-danger">
          {formError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button variant="primary" onClick={save} loading={saving}>
          Save permissions
        </Button>
      </div>
    </div>
  );
}
