'use client';

/**
 * Project detail: health panel, milestones, tasks and dependency management.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, GitBranch, Plus, Sparkles } from 'lucide-react';
import { Button, EmptyState, ErrorState, Field, Input, Modal, Pill, Select, SkeletonList, useToast } from '@/components/ui';
import { ProjectHealthPanel, TaskCard } from '@/components/cards';
import { apiRequest, useApi } from '@/components/hooks';
import type { MilestoneStatus, Task } from '@/lib/types';

interface ProjectDetail {
  project: {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    target_date: string | null;
    start_date: string | null;
    health: number;
    progress: number;
    notes: string;
    health_note: string;
  };
  milestones: Array<{ id: string; title: string; due_date: string | null; status: MilestoneStatus; description: string }>;
  tasks: Task[];
  dependencies: Array<{ id: string; task_id: string; depends_on_task_id: string }>;
  health: {
    score: number;
    label: string;
    reasons: string[];
    metrics: { progress: number; openTasks: number; completedTasks: number; overdueTasks: number; dueSoonTasks: number; blockedTasks: number };
  };
  goal: { id: string; title: string } | null;
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const projectId = params.id;

  const { data, error, loading, reload } = useApi<ProjectDetail>(`/api/projects/${projectId}`);
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [dependencyOpen, setDependencyOpen] = useState(false);
  const [status, setStatus] = useState('');

  const updateStatus = async (next: string) => {
    const result = await apiRequest(`/api/projects/${projectId}`, 'PATCH', { status: next });
    if (result.ok) {
      toast('Project status updated.');
      reload();
    } else {
      toast(result.error ?? 'Could not update the project.', 'error');
    }
  };

  const completeTask = async (task: Task) => {
    const result = await apiRequest(`/api/tasks/${task.id}/complete`, 'POST', {});
    if (result.ok) {
      toast(`Completed "${task.title}".`);
      reload();
    } else {
      toast(result.error ?? 'Could not complete the task.', 'error');
    }
  };

  const updateMilestone = async (milestoneId: string, next: MilestoneStatus) => {
    const result = await apiRequest(`/api/milestones/${milestoneId}`, 'PATCH', { status: next });
    if (result.ok) {
      toast('Milestone updated.');
      reload();
    } else {
      toast(result.error ?? 'Could not update the milestone.', 'error');
    }
  };

  if (loading) return <SkeletonList rows={3} />;
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (!data) return <EmptyState title="Project not found" description="It may have been deleted." />;

  const { project, milestones, tasks, dependencies, health, goal } = data;
  const taskTitle = (id: string) => tasks.find((task) => task.id === id)?.title ?? 'a removed task';

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <Link href="/projects" className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-primary">
        <ArrowLeft aria-hidden className="size-3.5" /> All projects
      </Link>

      <header className="vp-card flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone="violet">{project.status.replace('_', ' ')}</Pill>
              <Pill tone={project.priority === 'critical' ? 'danger' : project.priority === 'high' ? 'warning' : 'neutral'}>{project.priority}</Pill>
              {goal ? <Pill tone="neutral">Goal: {goal.title}</Pill> : null}
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight break-words text-text-primary sm:text-2xl">{project.title}</h1>
            {project.description ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-secondary">{project.description}</p> : null}
            <p className="mt-2 text-xs text-text-muted">
              Target {project.target_date ? new Date(project.target_date).toLocaleDateString() : 'not set'} · {project.health_note}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="project-status-select" className="sr-only">
              Project status
            </label>
            <Select
              id="project-status-select"
              value={status || project.status}
              onChange={(event) => {
                setStatus(event.target.value);
                void updateStatus(event.target.value);
              }}
              className="w-36"
            >
              {['planning', 'active', 'blocked', 'at_risk', 'completed', 'archived'].map((option) => (
                <option key={option} value={option}>
                  {option.replace('_', ' ')}
                </option>
              ))}
            </Select>
            <Link href="/ai">
              <Button size="sm" variant="primary" icon={<Sparkles aria-hidden className="size-3.5" />}>
                Ask VozCore
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-text-primary">Tasks ({tasks.length})</h2>
            {tasks.length === 0 ? (
              <EmptyState
                title="No tasks yet"
                description="Ask VozCore: “Create a task for this project” or add one from the Tasks page."
                action={
                  <Link href="/tasks">
                    <Button size="sm" variant="primary">
                      Go to tasks
                    </Button>
                  </Link>
                }
              />
            ) : (
              <div className="grid gap-2.5 md:grid-cols-2">
                {tasks.map((task) => (
                  <TaskCard key={task.id} task={task} timezone="UTC" onComplete={completeTask} showProject={false} />
                ))}
              </div>
            )}
          </section>

          <section className="vp-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-text-primary">Dependencies ({dependencies.length})</h2>
              <Button size="sm" variant="secondary" icon={<GitBranch aria-hidden className="size-3.5" />} onClick={() => setDependencyOpen(true)}>
                Add dependency
              </Button>
            </div>
            {dependencies.length === 0 ? (
              <EmptyState className="mt-3" title="No dependencies" description="Model blockers so VozPilot never recommends work that cannot start yet." />
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {dependencies.map((dependency) => (
                  <li
                    key={dependency.id}
                    className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--vp-border)] bg-ink-850/50 p-3 text-xs"
                  >
                    <span className="min-w-0 flex-1 break-words text-text-primary">{taskTitle(dependency.task_id)}</span>
                    <Pill tone="neutral">waits for</Pill>
                    <span className="min-w-0 flex-1 break-words text-text-secondary">{taskTitle(dependency.depends_on_task_id)}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        const result = await apiRequest(`/api/tasks/dependencies/${dependency.id}`, 'DELETE');
                        if (result.ok) {
                          toast('Dependency removed.');
                          reload();
                        } else {
                          toast(result.error ?? 'Could not remove the dependency.', 'error');
                        }
                      }}
                      className="shrink-0 text-[11px] text-text-muted hover:text-danger"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <ProjectHealthPanel score={health.score} label={health.label} reasons={health.reasons} metrics={health.metrics} />

          <section className="vp-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-text-primary">Milestones</h2>
              <Button size="sm" variant="secondary" icon={<Plus aria-hidden className="size-3.5" />} onClick={() => setMilestoneOpen(true)}>
                Add
              </Button>
            </div>
            {milestones.length === 0 ? (
              <EmptyState className="mt-3" title="No milestones" description="Milestones make progress measurable." />
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {milestones.map((milestone) => (
                  <li key={milestone.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--vp-border)] bg-ink-850/50 p-3">
                    <label htmlFor={`pms-${milestone.id}`} className="sr-only">
                      {milestone.title} status
                    </label>
                    <Select
                      id={`pms-${milestone.id}`}
                      value={milestone.status}
                      onChange={(event) => updateMilestone(milestone.id, event.target.value as MilestoneStatus)}
                      className="w-32 shrink-0"
                    >
                      {['pending', 'in_progress', 'completed', 'missed'].map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </Select>
                    <span className="min-w-0 flex-1 text-xs break-words text-text-primary">{milestone.title}</span>
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
        projectId={projectId}
      />

      <DependencyComposer
        open={dependencyOpen}
        onClose={() => setDependencyOpen(false)}
        tasks={tasks.map((task) => ({ id: task.id, title: task.title }))}
        onCreated={() => {
          setDependencyOpen(false);
          toast('Dependency created.');
          reload();
        }}
      />
    </div>
  );
}

function MilestoneComposer({
  open,
  onClose,
  onCreated,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  projectId: string;
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
    const result = await apiRequest(`/api/projects/${projectId}/milestones`, 'POST', {
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
        <Field label="Milestone" htmlFor="pms-title" error={error} required>
          <Input id="pms-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Authentication complete" maxLength={200} />
        </Field>
        <Field label="Due date" htmlFor="pms-due">
          <Input id="pms-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function DependencyComposer({
  open,
  onClose,
  tasks,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tasks: Array<{ id: string; title: string }>;
  onCreated: () => void;
}) {
  const [taskId, setTaskId] = useState('');
  const [dependsOn, setDependsOn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!taskId || !dependsOn) {
      setError('Choose both tasks.');
      return;
    }
    if (taskId === dependsOn) {
      setError('A task cannot depend on itself.');
      return;
    }
    setSaving(true);
    const result = await apiRequest('/api/tasks/dependencies', 'POST', { task_id: taskId, depends_on_task_id: dependsOn });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not create the dependency.');
      return;
    }
    setTaskId('');
    setDependsOn('');
    onCreated();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a dependency"
      description="The first task will not be recommended until the second is complete."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            Create dependency
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="This task" htmlFor="dep-task" error={error} required>
          <Select id="dep-task" value={taskId} onChange={(event) => setTaskId(event.target.value)}>
            <option value="">Choose a task</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Waits for" htmlFor="dep-on" required>
          <Select id="dep-on" value={dependsOn} onChange={(event) => setDependsOn(event.target.value)}>
            <option value="">Choose a task</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
