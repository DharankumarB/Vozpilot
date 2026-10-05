# VozPilot

**Your AI Chief of Staff — by VozLook Studios.**

VozPilot turns a messy list of goals, projects, tasks and messages into a plan you
can actually execute. VozCore, the orchestration brain, works alongside four
sub-agents and moves your work through the **Observe → Orient → Decide → Act →
Reflect → Adapt** lifecycle. It reads your real records, reasons over them, and
acts only through a permissioned set of tools.

> **The rules this build holds itself to**
> No fake data. No mock users. No dead buttons. No fabricated AI output.
> Every screen reads from the database or from a live model, and every claim the
> assistant makes comes from records it retrieved in the same run.

---

## Contents

- [Quick start](#quick-start)
- [Environment](#environment)
- [Database](#database)
- [Scripts](#scripts)
- [How the agent works](#how-the-agent-works)
- [The four sub-agents](#the-four-sub-agents)
- [Tool catalogue](#tool-catalogue)
- [Permissions: read / write / sensitive](#permissions-read--write--sensitive)
- [Loop protection and the audit log](#loop-protection-and-the-audit-log)
- [Deterministic priority scoring](#deterministic-priority-scoring)
- [Project and goal health](#project-and-goal-health)
- [The VozDay planner](#the-vozday-planner)
- [Confidence handling: ask, don't guess](#confidence-handling-ask-dont-guess)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Testing](#testing)
- [Design system](#design-system)
- [Scope notes](#scope-notes)

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure the environment (see below)
cp .env.example .env.local

# 3. Apply the database schema to your Supabase project
#    Supabase dashboard → SQL Editor → run supabase/migrations/0001_init.sql
#    then supabase/migrations/0002_rls.sql

# 4. Run the app
npm run dev          # http://localhost:3000
```

Open `http://localhost:3000`, create an account, and the onboarding wizard
walks you through goals, availability, working style, notifications and AI
permissions. Every step is skippable — only the display name is required.

### Without any LLM key

VozPilot still runs. With no `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` configured,
the built-in **deterministic reasoning engine** (`local-reasoning-v1`) takes over
command-style requests. It performs the same job a hosted model would — parse the
request, resolve it against your real records, emit a structured tool call — and
the UI always labels which engine answered, so the distinction is never hidden.
It is a fallback, not a mock: it never invents an answer.

---

## Environment

Copy `.env.example` to `.env.local`. Nothing else is needed for a local run
except the two Supabase values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Supabase project URL. Public by design. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | Supabase anon key. Public by design; every request is still constrained by Row Level Security. |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Server-only. Bypasses RLS. **Never** prefix this with `NEXT_PUBLIC_` and never import it into a client component. |
| `ANTHROPIC_API_KEY` | No | Server-only. Enables the Claude provider. |
| `ANTHROPIC_MODEL` | No | Server-only. Defaults to a current Claude model. |
| `OPENAI_API_KEY` | No | Server-only. Enables the OpenAI provider. |
| `OPENAI_MODEL` | No | Server-only. Defaults to a current GPT model. |
| `CRON_SECRET` | No | Shared secret required by `/api/cron/daily-briefing`. |

If the two Supabase values are missing, the app does not white-screen: public
pages render a clear setup screen and `/api/*` returns a structured
`503 { error: ... }` instead of HTML.

**Server-only rule.** `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` and
`OPENAI_API_KEY` are only ever read inside `src/app/api/**` route handlers and
server-side `src/lib` modules. No client component imports them.

---

## Database

Two migrations, in order:

1. **`supabase/migrations/0001_init.sql`** — 20 tables: `profiles`,
   `user_preferences`, `ai_permissions`, `goals`, `goal_milestones`, `projects`,
   `project_milestones`, `tasks`, `task_dependencies`, `daily_plans`,
   `time_blocks`, `inbox_items`, `inbox_actions`, `notifications`, `memories`,
   `agent_runs`, `agent_actions`, `ai_conversations`, `ai_messages`,
   `integrations`. Includes the `handle_new_user` trigger that provisions a
   profile, default preferences and default AI permissions on signup.
2. **`supabase/migrations/0002_rls.sql`** — enables Row Level Security on every
   table and adds `auth.uid() = user_id` policies for select, insert, update and
   delete.

RLS is the second line of defence. Repositories always scope by `user_id` too, so
a missed scope in application code still cannot read another user's row.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000. |
| `npm run build` | Production build (33 routes). |
| `npm start` | Serve the production build. |
| `npm run typecheck` | `tsc --noEmit` — must be clean. |
| `npm test` | Vitest suite (engine + repositories). |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run lint` | Next.js lint. |
| `npm run audit` | `typecheck` → `test` → `build`. Run this before shipping. |

---

## How the agent works

```
        ┌──────────────────────────────────────────────────────┐
        │                      VozCore                         │
        │   observe · orient · decide · act · reflect · adapt  │
        └───┬──────────┬──────────┬──────────┬─────────────────┘
            │          │          │          │
        VozGoal   VozProject  VozDay    VozInbox
```

The loop is one request cycle:

1. **Observe** — `get_user_context` pulls the live picture: open goals, active
   projects, tasks, the current plan, recent agent activity and relevant memories.
2. **Orient** — health and priority engines score everything so the agent reasons
   over the same numbers the dashboard shows.
3. **Decide** — the model emits **structured tool calls only**. It can never write
   directly to the database; it can only request a named tool with arguments.
4. **Act** — every call is validated with Zod, checked against the user's
   permissions, executed, and written to the audit log.
5. **Reflect** — the tool result goes back to the model for the next iteration.
6. **Adapt** — memories and the agent activity feed let the next run start smarter.

Because the model only ever produces tool calls, a hallucinated field or a
half-remembered record cannot reach the database. The Zod schema in
`src/lib/validation/schemas.ts` rejects it first.

---

## The four sub-agents

| Agent | Owns | Representative tools |
| --- | --- | --- |
| **VozCore** | Orchestration, routing, audit, context assembly | `get_user_context`, `get_next_best_action`, `list_agent_activity` |
| **VozGoal** | Goals, goal milestones, goal health | `list_goals`, `create_goal`, `update_goal`, `create_milestone`, `get_goal_health`, `plan_goal_breakdown` |
| **VozProject** | Projects, project milestones, project health | `list_projects`, `create_project`, `update_project`, `get_project_health`, `create_task_dependency` |
| **VozDay** | Daily plans, time blocks, workload, conflicts | `get_daily_plan`, `create_daily_plan`, `update_daily_plan`, `create_time_block`, `get_daily_workload` |
| **VozInbox** | Inbox capture, triage, action extraction | `analyze_inbox_item`, `create_action_from_inbox`, `create_task` |

---

## Tool catalogue

35 named tools across the four sub-agents and VozCore:

**Goals** — `list_goals`, `get_goal`, `create_goal`, `update_goal`,
`create_milestone`, `update_milestone`, `get_goal_health`, `plan_goal_breakdown`

**Projects** — `list_projects`, `get_project`, `create_project`,
`update_project`, `get_project_health`

**Tasks** — `list_tasks`, `get_task`, `create_task`, `update_task`,
`complete_task`, `delete_task`, `create_task_dependency`, `remove_task_dependency`

**Planning** — `get_daily_plan`, `create_daily_plan`, `update_daily_plan`,
`create_time_block`, `update_time_block`, `get_daily_workload`

**Inbox** — `analyze_inbox_item`, `create_action_from_inbox`

**Orchestration** — `get_user_context`, `get_next_best_action`,
`retrieve_memory`, `create_memory`, `list_notifications`,
`mark_notification_read`, `create_notification`, `list_agent_activity`

---

## Permissions: read / write / sensitive

Every tool is classified **before** it runs, in
`src/lib/agent/permissions.ts`:

- **READ** — the tool only reads the caller's own data. Always allowed.
- **WRITE** — the tool creates or changes a record. Gated by the matching
  `ai_permissions` column (for example `create_task` is gated by `create_tasks`).
- **SENSITIVE** — the tool creates or destroys many records at once
  (`delete_task`, `plan_goal_breakdown`, bulk operations). These require explicit
  confirmation *unless* the user has turned `require_confirmation` off, and are
  refused outright if `sensitive_actions` is disabled.

The model can ask. The backend decides. A tool call the user has switched off
comes back as a denial the model must report, not something it can route around.

Every permission is editable at **Settings → AI permissions**, and the page shows
the full matrix with a plain-language summary of what each toggle controls.

---

## Loop protection and the audit log

Each agent run executes inside a budget (`DEFAULT_BUDGET` in
`src/lib/agent/loopGuard.ts`):

| Limit | Value |
| --- | --- |
| Tool calls per run | 10 |
| Reasoning iterations per run | 6 |
| Wall-clock duration | 45 seconds |
| Retries per step | 2 |

When a budget is exhausted the run stops safely and the user is told exactly
which limit was hit — the agent never silently continues or retries forever.

Every tool call — allowed, denied, or awaiting confirmation — is written to
`agent_actions`, and every run is recorded in `agent_runs`. The **Agent activity**
page is the audit log: who ran what, with which arguments, what came back, and how
long it took.

---

## Deterministic priority scoring

`src/lib/engine/priority.ts` scores every open task on the same inputs every
time, so the ordering you see on the dashboard, in the plan and in the assistant's
answers is always identical and always explainable:

- **Deadline urgency** — decays smoothly from overdue to far-future.
- **Blocking weight** — how many other tasks are waiting on this one.
- **Project risk** — inherited from the parent project's health and risk.
- **Goal relevance** — how central the task is to its goal.
- **Effort fit** — short tasks that clear the way score higher than long ones.

Completed, cancelled, blocked and dependency-blocked tasks are excluded. The same
module produces the natural-language explanation shown under each score, so the
ranking is never a black box.

---

## Project and goal health

`src/lib/engine/health.ts` computes a 0–100 score plus a written reason list:

- **Progress** against the target date.
- **Overdue tasks**, **due-soon tasks** (within three days) and **blocked tasks**,
  each penalised.
- A **concentration factor**: when most of the open work is troubled, the project
  is unhealthy even if each individual penalty looks survivable.
- **Milestone completion**, tracked independently of tasks.
- **Passed target dates** are flagged explicitly rather than quietly scored down.

Goal health blends the health of its linked projects with goal-milestone
completion, and warns when no projects are linked at all.

---

## The VozDay planner

`src/lib/engine/planner.ts` turns a ranked task list into a real day:

- Splits the working day around **fixed commitments** so blocks never overlap.
- Respects a **maximum focus-block budget** and reports, with reasons, what did
  not fit.
- Excludes tasks whose **dependencies are unfinished**.
- Inserts **breaks** after sustained focus.
- Returns a **human-readable summary** of the resulting day.
- Reports every skipped task with the reason, so nothing disappears silently.

`findConflicts` detects overlapping blocks before they are persisted, and the
daily workload engine flags overload from real time estimates rather than a task
count.

---

## Confidence handling: ask, don't guess

When the assistant cannot resolve a request with confidence, it asks a
clarifying question instead of guessing. This is a first-class outcome
(`finishReason: 'clarify'`) rendered as a question in the chat, not a failure
state. For example, "reschedule the report" with two candidate tasks returns both
and asks which one — it never picks one and hopes.

---

## Architecture

```
src/
├── app/
│   ├── (auth)/            login · signup · forgot-password · reset-password
│   ├── (app)/             dashboard · goals · projects · tasks · calendar ·
│   │                      inbox · agent-activity · notifications · ai · settings
│   ├── onboarding/        6-step wizard
│   ├── api/               33 route handlers
│   └── page.tsx           marketing/landing
├── lib/
│   ├── agent/             vozcore · tools · permissions · prompts · loopGuard · context
│   ├── ai/                provider interface + anthropic · openai · local
│   ├── engine/            priority · health · planner · briefing · inbox · memory
│   ├── db/                client (narrow DbClient) · repositories
│   ├── supabase/          browser · server clients
│   ├── validation/        Zod schemas
│   ├── notifications/     web notification service
│   └── types.ts           single source of truth for every row shape
├── proxy.ts               session refresh + route protection (Next 16 convention)
└── __tests__/             engine + repository suites
```

**The database boundary is deliberately narrow.** Repositories depend only on the
`DbClient` interface in `src/lib/db/client.ts`. That single seam is what lets the
test suite run the real production data-access code against an in-memory double
with no live Postgres — and it is why swapping a database client is a one-file
change.

---

## Security model

| Concern | How it is handled |
| --- | --- |
| Row Level Security | Enabled on all 20 tables; `auth.uid() = user_id` policies for select/insert/update/delete. |
| User identity | Always derived server-side from the session. `user_id` is never read from a request body. |
| Service-role key | Server-only, never bundled to the client. |
| LLM keys | Server-only, read only inside route handlers. |
| Input validation | Every tool argument and every API body is validated with Zod before any write. |
| Tool authorisation | READ / WRITE / SENSITIVE classification checked against the user's own `ai_permissions` row before execution. |
| Loop protection | Per-run budget on tool calls, iterations, duration and retries. |
| Audit | Every run and every tool call recorded and visible in Agent activity. |
| Error hygiene | `describeDbError` maps Postgres codes onto actionable sentences; raw SQL and internal messages never reach the client. |
| Route protection | `src/proxy.ts` refreshes the session and redirects unauthenticated page requests to `/login`. `/api/*` is excluded so API routes return structured JSON errors rather than an HTML redirect a `fetch()` cannot parse. |

---

## Testing

```bash
npm test
```

**`src/__tests__/engine.test.ts`** — the deterministic core, with no database and
no network:

- Priority scoring: overdue beats distant, blocking weight, project risk, goal
  relevance, effort fit, exclusion of completed/cancelled/blocked/dependency-
  blocked tasks, stable ordering, natural-language explanations, urgency decay.
- Project health: clean projects, penalties, passed target dates, milestone
  completion computed independently of tasks.
- Goal health: the project/milestone blend and the no-projects warning.
- Daily workload: overload detected from real time estimates.
- Planner: window splitting, no overlapping blocks, block budget with skipped
  reasons, dependency exclusion, break insertion, summary text.
- Conflict detection: overlapping blocks are found.

**`src/__tests__/repositories.test.ts`** — real production data-access code
against the in-memory Supabase double:

- User scoping on every query, insert, update and delete. The suite repeatedly
  asserts that a call made for one user cannot see or mutate another user's rows.
- `user_id` is stamped server-side even when a caller tries to inject a different
  owner through the values object.
- Ordering, filtering, limiting, `single()` vs `maybeSingle()`.
- Upsert semantics for one-row-per-user tables (`user_preferences`,
  `ai_permissions`, `daily_plans`, `integrations`).
- Unique-constraint violations surfaced as friendly, code-tagged messages.
- Search wildcard sanitisation, including the case where a term consists only of
  LIKE metacharacters.

The double (`src/__tests__/helpers/fakeSupabase.ts`) models PostgREST semantics
closely enough to be worth testing against: insert/update/delete without
`.select()` resolve to empty data, `.single()` errors with `PGRST116` when
nothing matches, and errors are returned rather than thrown — exactly like the
real client.

---

## Design system

- **Palette** — dark violet base with gold accents.
- **Responsive** — every screen is audited from **320px to 1920px**. Layouts
  reflow, tables become cards, and no horizontal scroll appears at any width.
- **Accessibility** — semantic landmarks, labelled form controls, visible focus
  rings, and `aria-live` regions for toast and notification updates.

---

## Scope notes

- **Notifications are web-only in this version.** WhatsApp delivery is paused and
  is not wired up anywhere; the notification settings screen says so plainly
  rather than showing a toggle that does nothing.
- **Integrations** are stored and listed so the data model and settings surface
  are complete, but no third-party OAuth flow is claimed as live.
- **Cron** — `/api/cron/daily-briefing` requires `CRON_SECRET` and is designed to
  be called by an external scheduler.

---

Built by **VozLook Studios**.
