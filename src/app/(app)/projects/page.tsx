'use client';

/**
 * Projects list + creation.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderKanban, Plus } from 'lucide-react';
import { Button, EmptyState, ErrorState, Field, Input, Modal, Select, SkeletonList, Textarea, useToast } from '@/components/ui';
import { ProjectCard } from '@/components/cards';
import { apiRequest, useApi } from '@/components/hooks';
import type { Project, ProjectStatus } from '@/lib/types';

interface ProjectRow extends Project {
  metrics: { progress: number; openTasks: number; completedTasks: number; overdueTasks: number; dueSoonTasks: number };
  healthLabel: string;
  reasons: string[];
  goalTitle: string | null;
  healthReport: { score: number; label: string; reasons: string[]; metrics: { progress: number; openTasks: number; completedTasks: number; overdueTasks: number; dueSoonTasks: number } };
}

export default function ProjectsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [composerOpen, setComposerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useApi<{ projects: ProjectRow[] }>('/api/projects?archived=1');

  const projects = (data?.projects ?? []).filter((project) =>
    query.trim().length === 0 ? true : project.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">Projects</h1>
          <p className="mt-1 text-sm text-text-secondary">Execution units with milestones, dependencies and computed health.</p>
        </div>
        <Button variant="primary" icon={<Plus aria-hidden className="size-4" />} onClick={() => setComposerOpen(true)}>
          New project
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="project-filter" className="sr-only">
          Filter projects
        </label>
        <Input
          id="project-filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter projects…"
          className="max-w-xs"
        />
        <span className="text-xs text-text-muted">
          {projects.length} project{projects.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? <SkeletonList rows={3} /> : null}
      {error ? <ErrorState description={error} onRetry={reload} /> : null}

      {!loading && !error && projects.length === 0 ? (
        <EmptyState
          title={query ? 'No projects match that filter' : 'No projects yet'}
          description={
            query
              ? 'Try a different search term.'
              : 'Create your first project and let VozPilot organize the execution, milestones and risk tracking.'
          }
          icon={<FolderKanban aria-hidden className="size-5" />}
          action={
            query ? (
              <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                Clear filter
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => setComposerOpen(true)}>
                Create project
              </Button>
            )
          }
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <button key={project.id} type="button" onClick={() => router.push(`/projects/${project.id}`)} className="text-left">
            <ProjectCard project={project} goalTitle={project.goalTitle} health={project.healthReport} />
          </button>
        ))}
      </div>

      <ProjectComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={(project) => {
          setComposerOpen(false);
          toast(`Project "${project.title}" created.`);
          reload();
        }}
      />
    </div>
  );
}

function ProjectComposer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const { data } = useApi<{ goals: Array<{ id: string; title: string }> }>('/api/goals');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [goalId, setGoalId] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('planning');
  const [priority, setPriority] = useState('medium');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setGoalId('');
      setStatus('planning');
      setPriority('medium');
      setTargetDate('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (title.trim().length < 2) {
      setError('Give the project a name.');
      return;
    }
    setSaving(true);
    const result = await apiRequest<{ project: Project }>('/api/projects', 'POST', {
      title: title.trim(),
      description: description.trim() || undefined,
      goal_id: goalId || undefined,
      status,
      priority,
      target_date: targetDate || undefined,
    });
    setSaving(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? 'Could not create the project.');
      return;
    }
    onCreated(result.data.project);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a project"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            Create project
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Project name" htmlFor="project-title" error={error} required>
          <Input id="project-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="VozPilot dashboard" maxLength={200} />
        </Field>

        <Field label="Description" htmlFor="project-description">
          <Textarea
            id="project-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What does done look like?"
          />
        </Field>

        {(data?.goals?.length ?? 0) > 0 ? (
          <Field label="Linked goal" htmlFor="project-goal" hint="Optional. Links this project to a long-term goal.">
            <Select id="project-goal" value={goalId} onChange={(event) => setGoalId(event.target.value)}>
              <option value="">No goal</option>
              {(data?.goals ?? []).map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="project-status">
            <Select id="project-status" value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}>
              {['planning', 'active', 'blocked', 'at_risk', 'completed', 'archived'].map((option) => (
                <option key={option} value={option}>
                  {option.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="project-priority">
            <Select id="project-priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
              {['low', 'medium', 'high', 'critical'].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Target date" htmlFor="project-target">
          <Input id="project-target" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
