'use client';

/**
 * Onboarding — welcome, goals, availability, working style, notifications,
 * AI permissions. Everything is optional except a name; VozPilot never blocks
 * the user from reaching the dashboard.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Sparkles } from 'lucide-react';
import { Button, Field, Input, Switch, Textarea, useToast } from '@/components/ui';
import { apiRequest, useApi } from '@/components/hooks';

const STEPS = ['Welcome', 'Goals', 'Availability', 'Working style', 'Notifications', 'AI permissions'] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data } = useApi<{ profile: { full_name: string; timezone: string } | null; email: string }>('/api/profile');

  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState('');
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [goals, setGoals] = useState<string[]>(['']);
  const [workdayStart, setWorkdayStart] = useState('09:00');
  const [workdayEnd, setWorkdayEnd] = useState('21:00');
  const [maxBlocks, setMaxBlocks] = useState(6);
  const [workingStyle, setWorkingStyle] = useState('');
  const [briefing, setBriefing] = useState(true);
  const [deadlineAlerts, setDeadlineAlerts] = useState(true);
  const [projectAlerts, setProjectAlerts] = useState(true);
  const [goalAlerts, setGoalAlerts] = useState(true);
  const [inboxAlerts, setInboxAlerts] = useState(true);
  const [permissions, setPermissions] = useState({
    create_tasks: true,
    reschedule_tasks: true,
    create_reminders: true,
    update_project_status: true,
    create_goals: false,
    create_projects: false,
    delete_tasks: false,
    delete_projects: false,
    sensitive_actions: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.profile) {
      setFullName((current) => current || data.profile?.full_name || '');
      setTimezone(data.profile.timezone || timezone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const finish = async () => {
    setSaving(true);
    const result = await apiRequest('/api/onboarding', 'POST', {
      full_name: fullName.trim() || undefined,
      timezone,
      main_goals: goals.map((goal) => goal.trim()).filter((goal) => goal.length > 0),
      availability: { workday_start: workdayStart, workday_end: workdayEnd, max_daily_blocks: maxBlocks },
      working_style: workingStyle.trim() || undefined,
      notification_preferences: {
        briefing_enabled: briefing,
        deadline_alerts: deadlineAlerts,
        project_alerts: projectAlerts,
        goal_alerts: goalAlerts,
        inbox_alerts: inboxAlerts,
      },
      ai_permissions: permissions,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? 'Could not finish onboarding.');
      return;
    }

    toast('Welcome to VozPilot.');
    router.push('/dashboard');
    router.refresh();
  };

  const next = () => {
    if (step === 0 && fullName.trim().length === 0) {
      setError('Tell VozPilot what to call you.');
      return;
    }
    setError(null);
    if (step < STEPS.length - 1) setStep(step + 1);
    else void finish();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-accent to-violet-deep text-sm font-bold text-white"
            >
              V
            </span>
            <span>
              <span className="block text-sm font-semibold leading-tight text-text-primary">VozPilot</span>
              <span className="block text-[10px] leading-tight text-text-muted">by VozLook Studios</span>
            </span>
          </div>
          <span className="text-[11px] text-text-muted">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>

        <div className="mb-5 h-1 w-full overflow-hidden rounded-full bg-ink-800">
          <div className="h-full rounded-full bg-violet-accent transition-[width] duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>

        <section className="vp-card flex flex-col gap-5 p-5 sm:p-6">
          {step === 0 ? (
            <>
              <header>
                <h1 className="text-xl font-semibold tracking-tight text-text-primary">Welcome to VozPilot</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                  Your autonomous AI chief-of-staff. VozPilot observes your goals, projects and schedule, then plans and prioritises
                  the work for you.
                </p>
              </header>
              <Field label="What should VozPilot call you?" htmlFor="onboard-name" error={error} required>
                <Input id="onboard-name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your name" maxLength={120} />
              </Field>
              <Field label="Timezone" htmlFor="onboard-tz" hint="Used for scheduling and deadline maths.">
                <Input id="onboard-tz" value={timezone} onChange={(event) => setTimezone(event.target.value)} maxLength={64} />
              </Field>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <header>
                <h1 className="text-xl font-semibold tracking-tight text-text-primary">What matters most right now?</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                  Up to five goals. VozPilot will break them into milestones, projects and daily actions.
                </p>
              </header>
              {goals.map((goal, index) => (
                <Field key={index} label={`Goal ${index + 1}`} htmlFor={`onboard-goal-${index}`}>
                  <Input
                    id={`onboard-goal-${index}`}
                    value={goal}
                    onChange={(event) => {
                      const next = [...goals];
                      next[index] = event.target.value;
                      setGoals(next);
                    }}
                    placeholder={index === 0 ? 'Become job-ready as a full-stack developer' : 'Optional'}
                    maxLength={200}
                  />
                </Field>
              ))}
              {goals.length < 5 ? (
                <Button size="sm" variant="ghost" className="self-start" onClick={() => setGoals([...goals, ''])}>
                  + Add another goal
                </Button>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <header>
                <h1 className="text-xl font-semibold tracking-tight text-text-primary">When do you work?</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">VozDay only schedules inside this window.</p>
              </header>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Workday start" htmlFor="onboard-start">
                  <Input id="onboard-start" type="time" value={workdayStart} onChange={(event) => setWorkdayStart(event.target.value)} />
                </Field>
                <Field label="Workday end" htmlFor="onboard-end">
                  <Input id="onboard-end" type="time" value={workdayEnd} onChange={(event) => setWorkdayEnd(event.target.value)} />
                </Field>
              </div>
              <Field label="Maximum focus blocks per day" htmlFor="onboard-blocks" hint="Keeps plans realistic and prevents overload.">
                <Input
                  id="onboard-blocks"
                  type="number"
                  min={1}
                  max={16}
                  value={maxBlocks}
                  onChange={(event) => setMaxBlocks(Number.parseInt(event.target.value, 10) || 1)}
                />
              </Field>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <header>
                <h1 className="text-xl font-semibold tracking-tight text-text-primary">How do you work best?</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                  Stored as memory and used to shape plans. Free text, whatever helps.
                </p>
              </header>
              <Field label="Working style" htmlFor="onboard-style">
                <Textarea
                  id="onboard-style"
                  value={workingStyle}
                  onChange={(event) => setWorkingStyle(event.target.value)}
                  placeholder="I do deep work in the morning and prefer 45-minute focus blocks with short breaks."
                />
              </Field>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <header>
                <h1 className="text-xl font-semibold tracking-tight text-text-primary">What should VozPilot tell you?</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">Web notifications only. WhatsApp is paused for this version.</p>
              </header>
              <div className="divide-y divide-[var(--vp-border)]">
                <Switch label="Daily briefing" checked={briefing} onChange={setBriefing} />
                <Switch label="Deadline alerts" checked={deadlineAlerts} onChange={setDeadlineAlerts} />
                <Switch label="Project alerts" checked={projectAlerts} onChange={setProjectAlerts} />
                <Switch label="Goal alerts" checked={goalAlerts} onChange={setGoalAlerts} />
                <Switch label="Inbox alerts" checked={inboxAlerts} onChange={setInboxAlerts} />
              </div>
            </>
          ) : null}

          {step === 5 ? (
            <>
              <header>
                <h1 className="text-xl font-semibold tracking-tight text-text-primary">What may VozCore do for you?</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                  You can change any of this later. Read actions are always allowed.
                </p>
              </header>
              <div className="divide-y divide-[var(--vp-border)]">
                <Switch label="Create tasks" checked={permissions.create_tasks} onChange={(value) => setPermissions({ ...permissions, create_tasks: value })} />
                <Switch label="Reschedule tasks" checked={permissions.reschedule_tasks} onChange={(value) => setPermissions({ ...permissions, reschedule_tasks: value })} />
                <Switch label="Create reminders" checked={permissions.create_reminders} onChange={(value) => setPermissions({ ...permissions, create_reminders: value })} />
                <Switch label="Update project status" checked={permissions.update_project_status} onChange={(value) => setPermissions({ ...permissions, update_project_status: value })} />
                <Switch label="Create goals automatically" checked={permissions.create_goals} onChange={(value) => setPermissions({ ...permissions, create_goals: value })} />
                <Switch label="Create projects automatically" checked={permissions.create_projects} onChange={(value) => setPermissions({ ...permissions, create_projects: value })} />
                <Switch label="Delete tasks automatically" checked={permissions.delete_tasks} onChange={(value) => setPermissions({ ...permissions, delete_tasks: value })} />
                <Switch label="Delete projects automatically" checked={permissions.delete_projects} onChange={(value) => setPermissions({ ...permissions, delete_projects: value })} />
              </div>
            </>
          ) : null}

          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={() => (step === 0 ? router.push('/dashboard') : setStep(step - 1))} disabled={saving}>
              {step === 0 ? 'Skip for now' : 'Back'}
            </Button>
            <Button variant="primary" onClick={next} loading={saving} icon={step === STEPS.length - 1 ? <Sparkles aria-hidden className="size-3.5" /> : undefined}>
              {step === STEPS.length - 1 ? 'Enter VozPilot' : 'Continue'}
            </Button>
          </div>
        </section>

        <ol className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
          {STEPS.map((label, index) => (
            <li key={label} className={`flex items-center gap-1.5 text-[10px] ${index <= step ? 'text-violet-soft' : 'text-text-muted'}`}>
              {index < step ? <Check aria-hidden className="size-3" /> : <span aria-hidden className="size-1.5 rounded-full bg-current" />}
              {label}
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
