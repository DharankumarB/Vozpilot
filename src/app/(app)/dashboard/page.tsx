import Link from 'next/link';
import { ArrowRight, CalendarDays, FolderKanban, Inbox, Plus, Target, Zap } from 'lucide-react';
import { getPageContext } from '@/lib/server/pageContext';
import * as repo from '@/lib/db/repositories';
import { blockedByMap, blockedTaskIds } from '@/lib/db/repositories';
import { buildDailyBriefing } from '@/lib/engine/briefing';
import { rankTasks } from '@/lib/engine/priority';
import { computeGoalHealth, computeProjectHealth } from '@/lib/engine/health';
import { Button, EmptyState, LinkButton, Pill, SectionHeader } from '@/components/ui';
import { GoalCard, ProjectCard, TaskCard } from '@/components/cards';
import { Timeline } from '@/components/Timeline';
import { NextBestAction } from '@/components/NextBestAction';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const context = await getPageContext();
  const { db, userId, timezone, today } = context;

  const [goals, projects, tasks, dependencies, notifications, inboxItems, goalMilestones, projectMilestones, plan, blocks] =
    await Promise.all([
      repo.listGoals(db, userId),
      repo.listProjects(db, userId),
      repo.listTasks(db, userId, { limit: 300 }),
      repo.listDependencies(db, userId),
      repo.listNotifications(db, userId, { limit: 8 }),
      repo.listInboxItems(db, userId),
      repo.listGoalMilestones(db, userId),
      repo.listProjectMilestones(db, userId),
      repo.getDailyPlan(db, userId, today),
      repo.listTimeBlocks(db, userId, `${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`),
    ]);

  const now = new Date();
  const briefing = buildDailyBriefing({
    now,
    timezone,
    displayName: context.profile?.full_name ?? '',
    goals: goals.data ?? [],
    projects: projects.data ?? [],
    tasks: tasks.data ?? [],
    blocks: blocks.data ?? [],
    notifications: notifications.data ?? [],
    goalMilestones: goalMilestones.data ?? [],
    projectMilestones: projectMilestones.data ?? [],
    inboxPending: (inboxItems.data ?? []).filter((item) => item.status !== 'dismissed' && item.status !== 'archived').length,
  });

  const goalMap = new Map((goals.data ?? []).map((goal) => [goal.id, goal]));
  const projectMap = new Map((projects.data ?? []).map((project) => [project.id, project]));
  const blocksCount = blockedByMap(dependencies.data ?? []);
  const blocked = blockedTaskIds(tasks.data ?? [], dependencies.data ?? []);
  const openTasks = (tasks.data ?? []).filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
  const ranked = rankTasks(openTasks, { now, goals: goalMap, projects: projectMap, blocksCount, blockedTaskIds: blocked });

  const firstName = (context.profile?.full_name ?? '').split(' ')[0];
  const metrics = briefing.metrics;

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-col gap-5">
      {/* Greeting + metrics */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-text-muted">{briefing.dateLabel}</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">
              {briefing.greeting}
              {firstName ? `, ${firstName}` : ''} 👋
            </h1>
            <p className="mt-1 text-sm text-text-secondary">{briefing.headline}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/ai" variant="primary" size="sm" icon={<Zap aria-hidden className="size-3.5" />}>
              What should I do now?
            </LinkButton>
            <LinkButton href="/calendar" variant="secondary" size="sm" icon={<CalendarDays aria-hidden className="size-3.5" />}>
              Plan my day
            </LinkButton>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Active goals', value: metrics.activeGoals, tone: 'text-text-primary' },
            { label: 'Active projects', value: metrics.activeProjects, tone: 'text-text-primary' },
            { label: 'Due today', value: metrics.tasksDueToday, tone: 'text-violet-soft' },
            { label: 'Overdue', value: metrics.overdueTasks, tone: metrics.overdueTasks > 0 ? 'text-danger' : 'text-text-primary' },
            { label: 'Completed today', value: metrics.completedToday, tone: 'text-success' },
            { label: 'Focus blocks', value: metrics.focusBlocks, tone: 'text-text-primary' },
          ].map((metric) => (
            <div key={metric.label} className="vp-card px-3 py-2.5">
              <dt className="text-[10px] tracking-wide text-text-muted uppercase">{metric.label}</dt>
              <dd className={`mt-1 text-xl font-semibold tabular-nums ${metric.tone}`}>{metric.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      {/* Briefing sections */}
      {briefing.sections.length > 0 ? (
        <section className="vp-card p-4">
          <SectionHeader title="Today at a glance" subtitle="Generated from your live goals, projects and schedule" />
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {briefing.sections.map((section) => (
              <li key={section.id}>
                <Link
                  href={section.actionUrl ?? '#'}
                  className="flex h-full min-w-0 flex-col gap-1.5 rounded-[var(--radius-control)] border border-[var(--vp-border)] bg-ink-850/50 p-3 transition-colors hover:border-violet-accent/40"
                >
                  <span className="flex items-center gap-1.5">
                    <Pill
                      tone={
                        section.severity === 'critical' ? 'danger' : section.severity === 'high' ? 'warning' : section.severity === 'medium' ? 'violet' : 'neutral'
                      }
                    >
                      {section.label}
                    </Pill>
                  </span>
                  <span className="text-sm leading-snug font-medium break-words text-text-primary">{section.title}</span>
                  <span className="text-[11px] leading-relaxed break-words text-text-muted">{section.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-3">
        {/* Left column: next action + today */}
        <div className="flex flex-col gap-5 xl:col-span-2">
          <NextBestAction
            taskId={ranked[0]?.task.id ?? null}
            title={ranked[0]?.task.title ?? null}
            priority={ranked[0]?.task.priority ?? null}
            estimatedMinutes={ranked[0]?.task.estimated_minutes ?? null}
            dueDate={ranked[0]?.task.due_date ?? null}
            reason={ranked[0] ? explainReason(ranked[0].score) : null}
            projectId={ranked[0]?.task.project_id ?? null}
            timezone={timezone}
          />

          <section className="vp-card p-4">
            <SectionHeader
              title="Today's plan"
              subtitle={plan.data?.summary ?? 'No plan generated yet'}
              action={
                <Link
                  href="/calendar"
                  className="inline-flex items-center gap-1 text-[11px] text-violet-soft hover:underline"
                >
                  Open calendar <ArrowRight aria-hidden className="size-3" />
                </Link>
              }
            />
            <div className="mt-3">
              <Timeline blocks={blocks.data ?? []} timezone={timezone} emptyLabel="No time blocks yet. Generate a plan to fill your day." />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Priority queue"
              subtitle={`${openTasks.length} open task${openTasks.length === 1 ? '' : 's'}`}
              action={
                <Link href="/tasks" className="inline-flex items-center gap-1 text-[11px] text-violet-soft hover:underline">
                  All tasks <ArrowRight aria-hidden className="size-3" />
                </Link>
              }
            />
            {ranked.length === 0 ? (
              <EmptyState
                title="Nothing on your plate"
                description="Capture a goal or project and VozPilot will build the first plan for you."
                action={
                  <Link href="/goals">
                    <Button size="sm" variant="primary" icon={<Plus aria-hidden className="size-3.5" />}>
                      Create a goal
                    </Button>
                  </Link>
                }
              />
            ) : (
              <div className="grid gap-2.5 md:grid-cols-2">
                {ranked.slice(0, 4).map((entry) => (
                  <TaskCard
                    key={entry.task.id}
                    task={entry.task}
                    timezone={timezone}
                    projectTitle={entry.task.project_id ? projectMap.get(entry.task.project_id)?.title ?? null : null}
                    goalTitle={entry.task.goal_id ? goalMap.get(entry.task.goal_id)?.title ?? null : null}
                    isBlocked={blocked.has(entry.task.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Goals"
              action={
                <Link href="/goals" className="inline-flex items-center gap-1 text-[11px] text-violet-soft hover:underline">
                  All goals <ArrowRight aria-hidden className="size-3" />
                </Link>
              }
            />
            {(goals.data ?? []).length === 0 ? (
              <EmptyState
                title="No goals yet"
                description="Create your first goal and let VozPilot break it into milestones, projects and tasks."
                icon={<Target aria-hidden className="size-5" />}
                action={
                  <Link href="/goals">
                    <Button size="sm" variant="primary">
                      Create goal
                    </Button>
                  </Link>
                }
              />
            ) : (
              (goals.data ?? []).slice(0, 3).map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  projectCount={(projects.data ?? []).filter((project) => project.goal_id === goal.id).length}
                  milestoneCount={(goalMilestones.data ?? []).filter((milestone) => milestone.goal_id === goal.id).length}
                  health={computeGoalHealth({
                    goal,
                    projects: projects.data ?? [],
                    tasks: tasks.data ?? [],
                    milestones: goalMilestones.data ?? [],
                  })}
                />
              ))
            )}
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Projects"
              action={
                <Link href="/projects" className="inline-flex items-center gap-1 text-[11px] text-violet-soft hover:underline">
                  All projects <ArrowRight aria-hidden className="size-3" />
                </Link>
              }
            />
            {(projects.data ?? []).length === 0 ? (
              <EmptyState
                title="No projects yet"
                description="Projects turn goals into executable work with milestones and tracked health."
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
              (projects.data ?? []).slice(0, 3).map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  goalTitle={project.goal_id ? goalMap.get(project.goal_id)?.title ?? null : null}
                  health={computeProjectHealth({
                    project,
                    tasks: tasks.data ?? [],
                    milestones: (projectMilestones.data ?? []).filter((milestone) => milestone.project_id === project.id),
                  })}
                />
              ))
            )}
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Inbox"
              action={
                <Link href="/inbox" className="inline-flex items-center gap-1 text-[11px] text-violet-soft hover:underline">
                  Open inbox <ArrowRight aria-hidden className="size-3" />
                </Link>
              }
            />
            {(inboxItems.data ?? []).length === 0 ? (
              <EmptyState
                title="Inbox is clear"
                description="Forward important messages here and VozInbox will extract deadlines and actions."
                icon={<Inbox aria-hidden className="size-5" />}
                action={
                  <Link href="/inbox">
                    <Button size="sm" variant="primary">
                      Add an item
                    </Button>
                  </Link>
                }
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {(inboxItems.data ?? []).slice(0, 4).map((item) => (
                  <li key={item.id} className="vp-card flex min-w-0 flex-col gap-1 p-3">
                    <span className="truncate text-xs font-medium text-text-primary">{item.subject || 'Untitled message'}</span>
                    <span className="line-clamp-2 text-[11px] leading-relaxed break-words text-text-muted">{item.body}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <Pill tone={item.status === 'actioned' ? 'success' : 'neutral'}>{item.status}</Pill>
                      {item.analysis ? <Pill tone="violet">{item.analysis.intent}</Pill> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Notifications"
              action={
                <Link href="/notifications" className="inline-flex items-center gap-1 text-[11px] text-violet-soft hover:underline">
                  All <ArrowRight aria-hidden className="size-3" />
                </Link>
              }
            />
            {(notifications.data ?? []).length === 0 ? (
              <EmptyState title="No notifications" description="Deadline, risk and briefing alerts will appear here." />
            ) : (
              <ul className="flex flex-col gap-2">
                {(notifications.data ?? []).map((notification) => (
                  <li key={notification.id} className="vp-card flex min-w-0 flex-col gap-1 p-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">{notification.title}</span>
                      {!notification.read_at ? <span aria-label="Unread" className="size-1.5 shrink-0 rounded-full bg-violet-accent" /> : null}
                    </span>
                    {notification.body ? (
                      <span className="line-clamp-2 text-[11px] leading-relaxed break-words text-text-muted">{notification.body}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function explainReason(score: { deadlineUrgency: number; importance: number; projectRisk: number; dependencyImpact: number; overdue: number }): string {
  const parts: string[] = [];
  if (score.overdue > 0) parts.push('overdue');
  if (score.deadlineUrgency >= 15) parts.push('deadline is close');
  if (score.importance >= 14) parts.push('high importance');
  if (score.projectRisk >= 8) parts.push('project at risk');
  if (score.dependencyImpact > 0) parts.push('other tasks wait on it');
  return parts.length > 0 ? `Chosen because ${parts.join(', ')}.` : 'Highest scoring available work.';
}
