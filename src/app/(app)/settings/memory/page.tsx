'use client';

/**
 * Settings — memory review and control.
 *
 * Memories belong strictly to the signed-in user. Nothing here is shared, and
 * retrieval elsewhere in the product only pulls the relevant slice.
 */

import { useState } from 'react';
import { Brain, Pin, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Pill, SectionHeader, SkeletonList, Textarea, useToast } from '@/components/ui';
import { apiRequest, useApi } from '@/components/hooks';
import type { Memory, MemoryCategory } from '@/lib/types';

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  user_preferences: 'User preferences',
  goals: 'Goals',
  projects: 'Projects',
  working_style: 'Working style',
  recurring_patterns: 'Recurring patterns',
  important_context: 'Important context',
  completed_milestones: 'Completed milestones',
  historical_decisions: 'Historical decisions',
};

export default function MemorySettingsPage() {
  const { toast } = useToast();
  const { data, error, loading, reload } = useApi<{ memories: Memory[] }>('/api/memories');
  const [pendingDelete, setPendingDelete] = useState<Memory | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [category, setCategory] = useState<MemoryCategory | 'all'>('all');

  const memories = (data?.memories ?? []).filter((memory) => category === 'all' || memory.category === category);
  const grouped = new Map<MemoryCategory, Memory[]>();
  for (const memory of memories) {
    grouped.set(memory.category, [...(grouped.get(memory.category) ?? []), memory]);
  }

  const togglePin = async (memory: Memory) => {
    const result = await apiRequest(`/api/memories/${memory.id}`, 'PATCH', { pinned: !memory.pinned });
    if (result.ok) {
      toast(memory.pinned ? 'Memory unpinned.' : 'Memory pinned.');
      reload();
    } else {
      toast(result.error ?? 'Could not update the memory.', 'error');
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    const result = await apiRequest(`/api/memories/${pendingDelete.id}`, 'DELETE');
    if (result.ok) {
      toast('Memory deleted.');
      reload();
    } else {
      toast(result.error ?? 'Could not delete the memory.', 'error');
    }
    setPendingDelete(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">Memory</h1>
          <p className="mt-1 text-sm text-text-secondary">
            What VozPilot remembers about you. Only the relevant slice is ever sent to the model — never the whole store.
          </p>
        </div>
        <Button variant="primary" onClick={() => setComposerOpen((open) => !open)}>
          {composerOpen ? 'Close' : 'Add memory'}
        </Button>
      </header>

      {composerOpen ? (
        <MemoryComposer
          onCreated={() => {
            setComposerOpen(false);
            toast('Memory saved.');
            reload();
          }}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="memory-filter" className="sr-only">
          Filter memories by category
        </label>
        <select
          id="memory-filter"
          value={category}
          onChange={(event) => setCategory(event.target.value as MemoryCategory | 'all')}
          className="vp-input max-w-56"
        >
          <option value="all">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-muted">{memories.length} stored</span>
      </div>

      {loading ? <SkeletonList rows={3} /> : null}
      {error ? <ErrorState description={error} onRetry={reload} /> : null}

      {!loading && !error && memories.length === 0 ? (
        <EmptyState
          title="Nothing remembered yet"
          description="Tell VozCore “remember that I prefer deep work in the morning” and it will show up here."
          icon={<Brain aria-hidden className="size-5" />}
        />
      ) : null}

      {[...grouped.entries()].map(([group, items]) => (
        <section key={group} className="flex flex-col gap-2">
          <SectionHeader title={CATEGORY_LABELS[group] ?? group} subtitle={`${items.length} item${items.length === 1 ? '' : 's'}`} />
          <ul className="flex flex-col gap-2">
            {items.map((memory) => (
              <li key={memory.id} className="vp-card flex min-w-0 flex-col gap-2 p-3.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone="violet">{memory.source}</Pill>
                  <Pill tone="neutral">importance {memory.importance}</Pill>
                  <Pill tone="neutral">used {memory.use_count}×</Pill>
                  {memory.pinned ? <Pill tone="gold">pinned</Pill> : null}
                </div>
                <p className="text-sm leading-relaxed break-words text-text-primary">{memory.content}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" icon={<Pin aria-hidden className="size-3.5" />} onClick={() => togglePin(memory)}>
                    {memory.pinned ? 'Unpin' : 'Pin'}
                  </Button>
                  <Button size="sm" variant="danger" icon={<Trash2 aria-hidden className="size-3.5" />} onClick={() => setPendingDelete(memory)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={remove}
        title="Delete this memory?"
        description="VozPilot will no longer use it for context. This cannot be undone."
        confirmLabel="Delete memory"
        destructive
      />
    </div>
  );
}

function MemoryComposer({ onCreated }: { onCreated: () => void }) {
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<MemoryCategory>('working_style');
  const [importance, setImportance] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (content.trim().length < 3) {
      setError('Write the memory you want VozPilot to keep.');
      return;
    }
    setSaving(true);
    const result = await apiRequest('/api/memories', 'POST', { content: content.trim(), category, importance });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not save the memory.');
      return;
    }
    setContent('');
    onCreated();
  };

  return (
    <section className="vp-card flex flex-col gap-4 p-4">
      <SectionHeader title="Add a memory" subtitle="Stored only for your account." />
      <Field label="Memory" htmlFor="memory-content" error={error} required>
        <Textarea
          id="memory-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="I do my best deep work between 9 and 11 AM."
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="memory-category">
          <select id="memory-category" value={category} onChange={(event) => setCategory(event.target.value as MemoryCategory)} className="vp-input">
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Importance" htmlFor="memory-importance">
          <Input
            id="memory-importance"
            type="number"
            min={0}
            max={100}
            value={importance}
            onChange={(event) => setImportance(Number.parseInt(event.target.value, 10) || 0)}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={submit} loading={saving}>
          Save memory
        </Button>
      </div>
    </section>
  );
}
