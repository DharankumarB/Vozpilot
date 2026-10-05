'use client';

/**
 * Goals list + creation.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Target } from 'lucide-react';
import { Button, EmptyState, ErrorState, Field, Input, Modal, Select, SkeletonList, Textarea, useToast } from '@/components/ui';
import { GoalCard } from '@/components/cards';
import { apiRequest, useApi } from '@/components/hooks';
import type { Goal } from '@/lib/types';

interface GoalRow extends Goal {
  metrics: { progress: number; overdueTasks: number; openTasks: number; completedTasks: number };
  healthLabel: string;
  reasons: string[];
  milestoneCount: number;
  projectCount: number;
  healthReport: { score: number; label: string; reasons: string[]; metrics: { progress: number; overdueTasks: number } };
}

export default function GoalsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [composerOpen, setComposerOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { data, error, loading, reload } = useApi<{ goals: GoalRow[] }>('/api/goals?archived=1');

  const goals = (data?.goals ?? []).filter((goal) =>
    query.trim().length === 0 ? true : goal.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">Goals</h1>
          <p className="mt-1 text-sm text-text-secondary">Long-term outcomes, broken into milestones, projects and daily actions.</p>
        </div>
        <Button variant="primary" icon={<Plus aria-hidden className="size-4" />} onClick={() => setComposerOpen(true)}>
          New goal
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="goal-filter" className="sr-only">
          Filter goals
        </label>
        <Input
          id="goal-filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter goals…"
          className="max-w-xs"
        />
        <span className="text-xs text-text-muted">
          {goals.length} goal{goals.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? <SkeletonList rows={3} /> : null}
      {error ? <ErrorState description={error} onRetry={reload} /> : null}

      {!loading && !error && goals.length === 0 ? (
        <EmptyState
          title={query ? 'No goals match that filter' : 'No goals yet'}
          description={
            query
              ? 'Try a different search term.'
              : 'Create your first goal and let VozPilot organise the execution into milestones, projects and tasks.'
          }
          icon={<Target aria-hidden className="size-5" />}
          action={
            query ? (
              <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                Clear filter
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => setComposerOpen(true)}>
                Create goal
              </Button>
            )
          }
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {goals.map((goal) => (
          <button key={goal.id} type="button" onClick={() => router.push(`/goals/${goal.id}`)} className="text-left">
            <GoalCard
              goal={goal}
              projectCount={goal.projectCount}
              milestoneCount={goal.milestoneCount}
              health={goal.healthReport}
            />
          </button>
        ))}
      </div>

      <GoalComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={(goal) => {
          setComposerOpen(false);
          toast(`Goal "${goal.title}" created.`);
          reload();
        }}
      />
    </div>
  );
}

function GoalComposer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (goal: Goal) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('career');
  const [priority, setPriority] = useState('medium');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setCategory('career');
      setPriority('medium');
      setTargetDate('');
      setError(null);
    }
  }, [open]);

  const submit = useCallback(async () => {
    if (title.trim().length < 2) {
      setError('Give the goal a title of at least 2 characters.');
      return;
    }
    setSaving(true);
    const result = await apiRequest<{ goal: Goal }>('/api/goals', 'POST', {
      title: title.trim(),
      description: description.trim() || undefined,
      category,
      priority,
      target_date: targetDate || undefined,
    });
    setSaving(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? 'Could not create the goal.');
      return;
    }
    onCreated(result.data.goal);
  }, [title, description, category, priority, targetDate, onCreated]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a goal"
      description="VozPilot will track progress, health and linked work automatically."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            Create goal
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Goal" htmlFor="goal-title" error={error} required>
          <Input
            id="goal-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Become job-ready as a full-stack developer"
            maxLength={200}
          />
        </Field>

        <Field label="Description" htmlFor="goal-description" hint="Optional. What does success look like?">
          <Textarea
            id="goal-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Ship three production apps and pass technical interviews."
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="goal-category">
            <Select id="goal-category" value={category} onChange={(event) => setCategory(event.target.value)}>
              {['career', 'learning', 'health', 'finance', 'personal', 'project', 'general'].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="goal-priority">
            <Select id="goal-priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
              {['low', 'medium', 'high', 'critical'].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Target date" htmlFor="goal-target">
          <Input id="goal-target" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
