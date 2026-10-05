'use client';

/**
 * Quick task composer used on the dashboard.
 *
 * Validates client-side, submits to the API with an idempotency key so a
 * double-click can never create two tasks, then optimistically shows success.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button, Field, Input, Select, useToast } from './ui';
import { apiRequest, useIdempotencyKey } from './hooks';

export function TaskComposer({
  projects,
  goals,
}: {
  projects: Array<{ id: string; title: string }>;
  goals: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [projectId, setProjectId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [estimate, setEstimate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useIdempotencyKey('task');
  const [key, setKey] = useState(() => nextKey());

  const submit = async () => {
    if (title.trim().length < 2) {
      setError('Give the task a title of at least 2 characters.');
      return;
    }
    setError(null);
    setSaving(true);

    const result = await apiRequest(
      '/api/tasks',
      'POST',
      {
        title: title.trim(),
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

    toast('Task created.');
    setTitle('');
    setEstimate('');
    setKey(nextKey());
    router.refresh();
  };

  return (
    <form
      className="vp-card flex flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="text-sm font-semibold text-text-primary">Quick capture</h2>

      <Field label="Task" htmlFor="quick-task-title" error={error} required>
        <Input
          id="quick-task-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Finish the API integration"
          maxLength={300}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Priority" htmlFor="quick-task-priority">
          <Select id="quick-task-priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </Field>

        <Field label="Estimate" htmlFor="quick-task-estimate">
          <Input
            id="quick-task-estimate"
            type="number"
            min={5}
            max={1440}
            step={5}
            value={estimate}
            onChange={(event) => setEstimate(event.target.value)}
            placeholder="45"
          />
        </Field>
      </div>

      {projects.length > 0 ? (
        <Field label="Project" htmlFor="quick-task-project">
          <Select id="quick-task-project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {goals.length > 0 ? (
        <Field label="Goal" htmlFor="quick-task-goal">
          <Select id="quick-task-goal" value={goalId} onChange={(event) => setGoalId(event.target.value)}>
            <option value="">No goal</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="Due date" htmlFor="quick-task-due">
        <Input id="quick-task-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
      </Field>

      <Button type="submit" variant="primary" loading={saving} icon={<Plus aria-hidden className="size-3.5" />}>
        Add task
      </Button>
    </form>
  );
}
