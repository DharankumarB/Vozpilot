'use client';

/**
 * Calendar — daily plan, time blocks and VozDay plan generation.
 */

import { useMemo, useState } from 'react';
import { CalendarDays, RefreshCw, Sparkles } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Field, Input, Pill, SectionHeader, SkeletonList, useToast } from '@/components/ui';
import { Timeline } from '@/components/Timeline';
import { apiRequest, useApi } from '@/components/hooks';
import { formatTime } from '@/lib/utils/dates';

interface PlanPayload {
  date: string;
  plan: { id: string; summary: string; status: string; generated_by: string } | null;
  blocks: Array<{
    id: string;
    title: string;
    start_at: string;
    end_at: string;
    kind: string;
    status: string;
    task_id: string | null;
  }>;
  workday: { start: string; end: string };
  timezone: string;
}

export default function CalendarPage() {
  const { toast } = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [generating, setGenerating] = useState(false);

  const { data, error, loading, reload } = useApi<PlanPayload>(`/api/daily-plan?date=${date}`);

  const generate = async (force: boolean) => {
    setGenerating(true);
    const result = await apiRequest<{ plan: unknown; blocks: unknown[]; skipped: Array<{ title: string; reason: string }>; regenerated: boolean; message?: string }>(
      '/api/daily-plan',
      'POST',
      { date, force },
    );
    setGenerating(false);
    if (!result.ok) {
      toast(result.error ?? 'Could not generate the plan.', 'error');
      return;
    }
    if (result.data?.regenerated) {
      const skipped = result.data.skipped ?? [];
      toast(
        skipped.length > 0
          ? `Plan rebuilt. ${skipped.length} task${skipped.length === 1 ? '' : 's'} did not fit.`
          : 'Plan rebuilt.',
      );
    } else {
      toast(result.data?.message ?? 'A plan already exists for this date.');
    }
    reload();
  };

  const blocks = data?.blocks ?? [];
  const grouped = useMemo(() => {
    const focus = blocks.filter((block) => block.kind === 'focus');
    const other = blocks.filter((block) => block.kind !== 'focus');
    return { focus, other, plannedMinutes: focus.reduce((sum, block) => sum + minutes(block), 0) };
  }, [blocks]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">Calendar</h1>
          <p className="mt-1 text-sm text-text-secondary">Your day as VozDay plans it: focus blocks, commitments and breaks.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={<Sparkles aria-hidden className="size-3.5" />}
            loading={generating}
            onClick={() => generate(blocks.length > 0)}
          >
            {blocks.length > 0 ? 'Rebuild plan' : 'Generate plan'}
          </Button>
        </div>
      </header>

      <div className="vp-card flex flex-col gap-3 p-3 sm:flex-row sm:items-end">
        <Field label="Date" htmlFor="calendar-date" className="sm:w-48">
          <Input id="calendar-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-1.5 pb-2">
          <Pill tone="neutral">Workday {data?.workday.start ?? '09:00'} – {data?.workday.end ?? '21:00'}</Pill>
          <Pill tone="violet">{grouped.focus.length} focus</Pill>
          <Pill tone="success">{Math.round(grouped.plannedMinutes)} min planned</Pill>
          <Button size="sm" variant="ghost" onClick={reload} icon={<RefreshCw aria-hidden className="size-3.5" />}>
            Refresh
          </Button>
        </div>
      </div>

      {loading ? <SkeletonList rows={3} /> : null}
      {error ? <ErrorState description={error} onRetry={reload} /> : null}

      {!loading && !error ? (
        <>
          <Card>
            <SectionHeader
              title={data?.plan ? `Plan for ${date}` : 'No plan for this date'}
              subtitle={data?.plan?.summary ?? 'Generate a plan and VozDay will fit your highest-value work into the day.'}
            />
            <div className="mt-3">
              <Timeline
                blocks={blocks as never}
                timezone={data?.timezone ?? 'UTC'}
                emptyLabel="Nothing scheduled. Generate a plan to fill your day."
              />
            </div>
          </Card>

          {blocks.length > 0 ? (
            <Card>
              <SectionHeader title="Block detail" subtitle="Everything VozDay placed, including commitments and breaks" />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
                  <thead>
                    <tr className="text-[10px] tracking-wide text-text-muted uppercase">
                      <th className="pb-2 pr-3 font-medium">Time</th>
                      <th className="pb-2 pr-3 font-medium">Block</th>
                      <th className="pb-2 pr-3 font-medium">Type</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocks.map((block) => (
                      <tr key={block.id} className="border-t border-[var(--vp-border)]">
                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-text-secondary">
                          {formatTime(block.start_at, data?.timezone ?? 'UTC')} – {formatTime(block.end_at, data?.timezone ?? 'UTC')}
                        </td>
                        <td className="py-2 pr-3 break-words text-text-primary">{block.title}</td>
                        <td className="py-2 pr-3">
                          <Pill tone={block.kind === 'break' ? 'success' : block.kind === 'commitment' ? 'gold' : 'violet'}>{block.kind}</Pill>
                        </td>
                        <td className="py-2 text-text-muted">{block.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {!loading && !error && blocks.length === 0 ? (
        <EmptyState
          title="No time blocks yet"
          description="VozDay builds a realistic timeline from your open tasks, deadlines, dependencies and working hours."
          icon={<CalendarDays aria-hidden className="size-5" />}
          action={
            <Button size="sm" variant="primary" onClick={() => generate(false)} loading={generating}>
              Generate today's plan
            </Button>
          }
        />
      ) : null}
    </div>
  );
}

function minutes(block: { start_at: string; end_at: string }): number {
  return Math.max(0, (new Date(block.end_at).getTime() - new Date(block.start_at).getTime()) / 60000);
}
