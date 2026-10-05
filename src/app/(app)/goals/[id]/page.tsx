'use client';

/**
 * Goal detail: milestones, linked projects, linked tasks and health.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FolderKanban, Plus, Sparkles, Target } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, Pill, Select, SkeletonList, useToast } from '@/components/ui';
import { ProjectHealthPanel, TaskCard } from '@/components/cards';
import { apiRequest, useApi } from '@/components/hooks';
import type { MilestoneStatus, Priority, Project, Task } from '@/lib/types';

interface GoalDetail {
  goal: {
    id: string;
    title: string;
    description: string;
    category: string;
    priority: Priority;
    status: string;
    target_date: string | null;
    progress: number;
    health: number;
    health_note: string;
  };
  milestones: Array<{
    id: string;
    title: string;
    description: string;
    due_date: string | null;
    status: MilestoneStatus;
    position: number;
  }>;
  projects: Project[];
  tasks: Task[];
  health: {
    score: number;
    label: string;
    reasons: string[];
    metrics: { progress: number; openTasks: number; completedTasks: number; overdueTasks: number; milestoneCompletion: number };
  };
}

export default function GoalDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const goalId = params.id;

  const { data, error, loading, reload } = useApi<GoalDetail>(`/api/goals/${goalId}`);
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const updateMilestone = async (milestoneId: string, status: MilestoneStatus) => {
    const result = await apiRequest(`/api/milestones/${milestoneId}`, 'PATCH', { status });
    if (result.ok) {
      toast('Milestone updated.');
      reload();
    } else {
      toast(result.error ?? 'Could not update the milestone.', 'error');
    }
  };

  const updateGoalStatus = async (status: string) => {
    const result = await apiRequest(`/api/goals/${goalId}`, 'PATCH', { status });
    if (result.ok) {
      toast('Goal updated.');
      reload();
    } else {
      toast(result.error ?? 'Could not update the goal.', 'error');
    }
  };

  const removeGoal = async () => {
    setDeleting(true);
    const result = await apiRequest(`/api/goals/${goalId}`, 'DELETE');
    setDeleting(false);
    if (result.ok) {
      toast('Goal deleted.');
      router.push('/goals');
    } else {
      toast(result.error ?? 'Could not delete the goal.', 'error');
    }
  };

  if (loading) return <SkeletonList rows={3} />;
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (!data) return <EmptyState title="Goal not found" description="It may have been deleted." />;

  const { goal, milestones, projects, tasks, health } = data;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <Link href="/goals" className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-primary">
        <ArrowLeft aria-hidden className="size-3.5" /> All goals
      </Link>

      <header className="flex flex-col gap-4 vp-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone="violet">{goal.category}</Pill>
              <Pill tone={goal.priority === 'critical' ? 'danger' : goal.priority === 'high' ? 'warning' : 'neutral'}>{goal.priority}</Pill>
              <Pill tone="neutral">{goal.status}</Pill>
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight break-words text-text-primary sm:text-2xl">{goal.title}</h1>
            {goal.description ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-secondary">{goal.description}</p> : null}
            <p className="mt-2 text-xs text-text-muted">
              Target {goal.target_date ? new Date(goal.target_date).toLocaleDateString() : 'not set'} · {goal.health_note}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/ai">
              <Button size="sm" variant="primary" icon={<Sparkles aria-hidden className="size-3.5" />}>
                Break into milestones
              </Button>
            </Link>
            <Button size="sm" variant="secondary" onClick={() => updateGoalStatus(goal.status === 'completed' ? 'active' : 'completed')}>
              {goal.status === 'completed' ? 'Reopen' : 'Mark complete'}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}>
              Delete
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <section className="vp-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-text-primary">Milestones</h2>
              <Button size="sm" variant="secondary" icon={<Plus aria-hidden className="size-3.5" />} onClick={() => setMilestoneOpen(true)}>
                Add milestone
              </Button>
            </div>

            {milestones.length === 0 ? (
              <EmptyState
                className="mt-3"
                title="No milestones yet"
                description="Milestones turn a distant goal into checkable steps."
                action={
                  <Button size="sm" variant="primary" onClick={() => setMilestoneOpen(true)}>
                    Add the first milestone
                  </Button>
                }
              />
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {milestones.map((milestone) => (
                  <li key={milestone.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-[var(--vp-border)] bg-ink-850/50 p-3">
                    <label htmlFor={`ms-${milestone.id}`} className="sr-only">
                      {milestone.title} status
                    </label>
                    <Select
                      id={`ms-${milestone.id}`}
                      value={milestone.status}
                      onChange={(event) => updateMilestone(milestone.id, event.target.value as MilestoneStatus)}
                      className="w-36 shrink-0"
                    >
                      {['pending', 'in_progress', 'completed', 'missed'].map((status) => (
                        <option key={status} value={status}>
                          {status.replace('_', ' ')}
                        </option>
                      ))}
                    </Select>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm break-words text-text-primary">{milestone.title}</span>
                      <span className="block text-[11px] text-text-muted">
                        {milestone.due_date ? `Due ${new Date(milestone.due_date).toLocaleDateString()}` : 'No due date'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-text-primary">Linked tasks ({tasks.length})</h2>
            {tasks.length === 0 ? (
              <EmptyState title="No tasks linked" description="Ask VozCore to create tasks for this goal, or add them from the Tasks page." />
            ) : (
              <div className="grid gap-2.5 md:grid-cols-2">
                {tasks.map((task) => (
                  <TaskCard key={task.id} task={task} timezone="UTC" showProject={false} />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <ProjectHealthPanel
            score={health.score}
            label={health.label}
            reasons={health.reasons}
            metrics={{
              progress: health.metrics.progress,
              openTasks: health.metrics.openTasks,
              completedTasks: health.metrics.completedTasks,
              overdueTasks: health.metrics.overdueTasks,
              dueSoonTasks: 0,
              blockedTasks: tasks.filter((task) => task.status === 'blocked').length,
            }}
          />

          <section className="vp-card p-4">
            <h2 className="text-sm font-semibold text-text-primary">Linked projects ({projects.length})</h2>
            {projects.length === 0 ? (
              <EmptyState
                className="mt-3"
                title="No projects linked"
                description="Projects carry the executable work for this goal."
                icon={<FolderKanban aria-hidden className="size-5" />}
                action={
                  <Link href="/projects">
                    <Button size="sm" variant="primary">
                      Create project
                    </Button>
                  </Link>
                }
              />
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {projects.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/projects/${project.id}`}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--vp-border)] bg-ink-850/50 p-3 transition-colors hover:border-violet-accent/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-text-primary">{project.title}</span>
                        <span className="block text-[11px] text-text-muted">{project.status}</span>
                      </span>
                      <Pill tone={project.health >= 70 ? 'success' : project.health >= 50 ? 'warning' : 'danger'}>{project.health}%</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <MilestoneComposer
        open={milestoneOpen}
        onClose={() => setMilestoneOpen(false)}
        onCreated={() => {
          setMilestoneOpen(false);
          toast('Milestone added.');
          reload();
        }}
        goalId={goalId}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={removeGoal}
        title="Delete this goal?"
        description="The goal, its milestones and links will be removed. Linked projects and tasks are kept."
        confirmLabel="Delete goal"
        destructive
        loading={deleting}
      />
    </div>
  );
}

function MilestoneComposer({
  open,
  onClose,
  onCreated,
  goalId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  goalId: string;
}) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (title.trim().length < 2) {
      setError('Give the milestone a title.');
      return;
    }
    setSaving(true);
    const result = await apiRequest(`/api/goals/${goalId}/milestones`, 'POST', {
      title: title.trim(),
      due_date: dueDate || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not create the milestone.');
      return;
    }
    setTitle('');
    setDueDate('');
    onCreated();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a milestone"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            Add milestone
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Milestone" htmlFor="milestone-title" error={error} required>
          <Input id="milestone-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Master React fundamentals" maxLength={200} />
        </Field>
        <Field label="Due date" htmlFor="milestone-due">
          <Input id="milestone-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export { Target };
