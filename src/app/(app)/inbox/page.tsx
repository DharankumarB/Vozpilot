'use client';

/**
 * Inbox — capture messages, run VozInbox analysis, accept suggested actions.
 */

import { useState } from 'react';
import { Inbox as InboxIcon, Plus, Sparkles } from 'lucide-react';
import { Button, EmptyState, ErrorState, Field, Input, Modal, Pill, SectionHeader, SkeletonList, Textarea, useToast } from '@/components/ui';
import { InboxCard } from '@/components/cards';
import { apiRequest, useApi } from '@/components/hooks';
import type { InboxItem } from '@/lib/types';

interface InboxPayload {
  items: InboxItem[];
  actions: Array<{
    id: string;
    inbox_item_id: string;
    kind: string;
    title: string;
    due_date: string | null;
    priority: string;
    status: string;
    confidence: number;
  }>;
  projects: Array<{ id: string; title: string }>;
  goals: Array<{ id: string; title: string }>;
}

export default function InboxPage() {
  const { toast } = useToast();
  const { data, error, loading, reload } = useApi<InboxPayload>('/api/inbox');
  const [composerOpen, setComposerOpen] = useState(false);
  const [analysing, setAnalysing] = useState<string | null>(null);

  const analyse = async (item: InboxItem) => {
    setAnalysing(item.id);
    const result = await apiRequest(`/api/inbox/${item.id}/analyze`, 'POST', {});
    setAnalysing(null);
    if (result.ok) {
      toast('VozInbox analysed the message.');
      reload();
    } else {
      toast(result.error ?? 'Could not analyse the message.', 'error');
    }
  };

  const dismiss = async (item: InboxItem) => {
    const result = await apiRequest(`/api/inbox/${item.id}`, 'PATCH', { status: 'dismissed' });
    if (result.ok) {
      toast('Item dismissed.');
      reload();
    } else {
      toast(result.error ?? 'Could not dismiss the item.', 'error');
    }
  };

  const acceptAction = async (inboxItemId: string, title: string) => {
    const result = await apiRequest(`/api/inbox/${inboxItemId}/actions`, 'POST', { title, kind: 'task' });
    if (result.ok) {
      toast(`Created task "${title}".`);
      reload();
    } else {
      toast(result.error ?? 'Could not create the task.', 'error');
    }
  };

  const items = data?.items ?? [];
  const suggested = (data?.actions ?? []).filter((action) => action.status === 'suggested');

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">Inbox</h1>
          <p className="mt-1 text-sm text-text-secondary">
            VozInbox turns important information into actions: deadlines, follow-ups and matched projects.
          </p>
        </div>
        <Button variant="primary" icon={<Plus aria-hidden className="size-4" />} onClick={() => setComposerOpen(true)}>
          Add item
        </Button>
      </header>

      {suggested.length > 0 ? (
        <section className="vp-card p-4">
          <SectionHeader title="Suggested actions" subtitle="VozInbox proposals waiting for your confirmation" />
          <ul className="mt-3 flex flex-col gap-2">
            {suggested.map((action) => (
              <li key={action.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--vp-border)] bg-ink-850/50 p-3">
                <Pill tone="violet">{action.kind.replace('_', ' ')}</Pill>
                <span className="min-w-0 flex-1 text-xs break-words text-text-primary">{action.title}</span>
                <Pill tone={action.confidence >= 0.6 ? 'success' : 'warning'}>{Math.round(action.confidence * 100)}%</Pill>
                <Button size="sm" variant="primary" onClick={() => acceptAction(action.inbox_item_id, action.title)}>
                  Create task
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loading ? <SkeletonList rows={3} /> : null}
      {error ? <ErrorState description={error} onRetry={reload} /> : null}

      {!loading && !error && items.length === 0 ? (
        <EmptyState
          title="Inbox is clear"
          description="Add a message — for example “Project review meeting is Friday at 3 PM” — and VozInbox will extract the deadline and the preparation task."
          icon={<InboxIcon aria-hidden className="size-5" />}
          action={
            <Button size="sm" variant="primary" onClick={() => setComposerOpen(true)}>
              Add the first item
            </Button>
          }
        />
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {items.map((item) => (
          <InboxCard key={item.id} item={item} onAnalyse={analyse} onDismiss={dismiss} analysing={analysing === item.id} />
        ))}
      </div>

      <InboxComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={() => {
          setComposerOpen(false);
          toast('Message captured and analysed.');
          reload();
        }}
      />
    </div>
  );
}

function InboxComposer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [sender, setSender] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (body.trim().length < 10) {
      setError('Add the message content (at least 10 characters).');
      return;
    }
    setSaving(true);
    const result = await apiRequest('/api/inbox', 'POST', {
      sender: sender.trim() || undefined,
      subject: subject.trim() || undefined,
      body: body.trim(),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not save the message.');
      return;
    }
    setSender('');
    setSubject('');
    setBody('');
    onCreated();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Capture an inbox item"
      description="Message content is treated as untrusted data: it is analysed for facts, never executed as instructions."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={saving} icon={<Sparkles aria-hidden className="size-3.5" />}>
            Analyse
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Sender" htmlFor="inbox-sender">
          <Input id="inbox-sender" value={sender} onChange={(event) => setSender(event.target.value)} placeholder="professor@university.edu" maxLength={320} />
        </Field>
        <Field label="Subject" htmlFor="inbox-subject">
          <Input id="inbox-subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Project review meeting" maxLength={500} />
        </Field>
        <Field label="Message" htmlFor="inbox-body" error={error} required>
          <Textarea
            id="inbox-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Project review meeting is Friday at 3 PM. Please prepare your deployment plan."
            className="min-h-32"
          />
        </Field>
      </div>
    </Modal>
  );
}
