'use client';

/**
 * Tasks page — filters, quick capture and the priority-ordered queue.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListChecks, Plus } from 'lucide-react';
import { Button, EmptyState, ErrorState, Field, Input, Modal, Pill, Select, SkeletonList, Textarea, useToast } from '@/components/ui';
import { TaskCard } from '@/components/cards';
import { apiRequest, useApi, useIdempotencyKey } from '@/components/hooks';
import type { Priority, Task, TaskStatus } from '@/lib/types';

interface TaskRow extends Task {
  projectTitle: string | null;
  goalTitle: string | null;
  score: number;
  scoreReason: string;
  isBlocked: boolean;
  blockedByCount: number;
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'Everything' },
];

export default function TasksPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState('open');
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status === 'open' ? 'todo,in_progress,blocked,inbox' : status);
    if (priority) params.set('priority', priority);
    return `/api/tasks?${params.toString()}`;
  }, [status, priority]);

  const { data, error, loading, reload } = useApi<{ tasks: TaskRow[]; blockedTaskIds: string[] }>(url);

  const tasks = (data?.tasks ?? []).filter((task) =>
    query.trim().length === 0 ? true : task.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const completeTask = async (task: Task) => {
    if (task.status === 'completed') {
      const result = await apiRequest(`/api/tasks/${task.id}`, 'PATCH', { status: 'todo' });
      if (result.ok) {
        toast('Task reopened.');
        reload();
      }
      return;
    }
    const result = await apiRequest(`/api/tasks/${task.id}/complete`, 'POST', {});
    if (result.ok) {
      toast(`Completed "${task.title}".`);
      reload();
    } else {
      toast(result.error ?? 'Could not complete the task.', 'error');
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">Tasks</h1>
          <p className="mt-1 text-sm text-text-secondary">Ordered by VozPilot's priority score, not by creation date.</p>
        </div>
        <Button variant="primary" icon={<Plus aria-hidden className="size-4" />} onClick={() => setComposerOpen(true)}>
          New task
        </Button>
      </header>

      <div className="vp-card flex flex-col gap-3 p-3 sm:flex-row sm:items-end">
        <Field label="Status" htmlFor="task-status-filter" className="sm:w-40">
          <Select id="task-status-filter" value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Priority" htmlFor="task-priority-filter" className="sm:w-40">
          <Select id="task-priority-filter" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="">Any priority</option>
            {['critical', 'high', 'medium', 'low'].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Search" htmlFor="task-query" className="flex-1">
          <Input id="task-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by title…" />
        </Field>

        <span className="shrink-0 pb-2.5 text-xs text-text-muted">
          {tasks.length} shown
        </span>
      </div>

      {loading ? <SkeletonList rows={4} /> : null}
      {error ? <ErrorState description={error} onRetry={reload} /> : null}

      {!loading && !error && tasks.length === 0 ? (
        <EmptyState
          title="No tasks here"
          description="Capture work and VozPilot will rank it by deadline, importance, project risk and dependencies."
          icon={<ListChecks aria-hidden className="size-5" />}
          action={
            <Button size="sm" variant="primary" onClick={() => setComposerOpen(true)}>
              Create a task
            </Button>
          }
        />
      ) : null}

      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {tasks.map((task) => (
          <div key={task.id} className="flex flex-col gap-1.5">
            <TaskCard task={task} timezone="UTC" onComplete={completeTask} projectTitle={task.projectTitle} goalTitle={task.goalTitle} isBlocked={task.isBlocked} />
            <div className="flex flex-wrap items-center gap-1.5 px-1">
              <Pill tone="violet">score {task.score}</Pill>
              {task.blockedByCount > 0 ? <Pill tone="gold">blocks {task.blockedByCount}</Pill> : null}
              <span className="min-w-0 flex-1 truncate text-[10px] text-text-muted">{task.scoreReason}</span>
            </div>
          </div>
        ))}
      </div>

      <TaskComposerModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={() => {
          setComposerOpen(false);
          toast('Task created.');
          reload();
          router.refresh();
        }}
      />
    </div>
  );
}

function TaskComposerModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { data } = useApi<{ projects: Array<{ id: string; title: string }>; goals: Array<{ id: string; title: string }> }>(
    open ? '/api/projects' : null,
  );
  const goals = useApi<{ goals: Array<{ id: string; title: string }> }>(open ? '/api/goals' : null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [taskStatus, setTaskStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<Priority>('medium');
  const [projectId, setProjectId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [estimate, setEstimate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useIdempotencyKey('task-modal');
  const [key, setKey] = useState(() => nextKey());

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setTaskStatus('todo');
      setPriority('medium');
      setProjectId('');
      setGoalId('');
      setDueDate('');
      setEstimate('');
      setError(null);
      setKey(nextKey());
    }
  }, [open, nextKey]);

  const submit = async () => {
    if (title.trim().length < 2) {
      setError('Give the task a title of at least 2 characters.');
      return;
    }
    setSaving(true);
    const result = await apiRequest(
      '/api/tasks',
      'POST',
      {
        title: title.trim(),
        description: description.trim() || undefined,
        status: taskStatus,
        priority,
        project_id: projectId || undefined,
        goal_id: goalId || undefined,
        due_date: dueDate ? new Date(`${dueDate}T09:00:00`).toISOString() : undefined,
        estimated_minutes: estimate ? Number.parseInt(estimate, 10) : undefined,
      },
      { 'idempotency-key': key },
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not create the task.');
      return;
    }
    onCreated();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a task"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            Create task
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Title" htmlFor="task-modal-title" error={error} required>
          <Input id="task-modal-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Build the authentication UI" maxLength={300} />
        </Field>

        <Field label="Description" htmlFor="task-modal-description">
          <Textarea id="task-modal-description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="task-modal-status">
            <Select id="task-modal-status" value={taskStatus} onChange={(event) => setTaskStatus(event.target.value as TaskStatus)}>
              {['inbox', 'todo', 'in_progress', 'blocked', 'completed', 'cancelled'].map((option) => (
                <option key={option} value={option}>
                  {option.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="task-modal-priority">
            <Select id="task-modal-priority" value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
              {['low', 'medium', 'high', 'critical'].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project" htmlFor="task-modal-project">
            <Select id="task-modal-project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">No project</option>
              {(data?.projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Goal" htmlFor="task-modal-goal">
            <Select id="task-modal-goal" value={goalId} onChange={(event) => setGoalId(event.target.value)}>
              <option value="">No goal</option>
              {(goals.data?.goals ?? []).map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Due date" htmlFor="task-modal-due">
            <Input id="task-modal-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
          <Field label="Estimate (minutes)" htmlFor="task-modal-estimate">
            <Input id="task-modal-estimate" type="number" min={5} max={1440} step={5} value={estimate} onChange={(event) => setEstimate(event.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
