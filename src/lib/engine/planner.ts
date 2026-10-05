/**
 * VozDay planner.
 *
 * Deterministic, dependency-aware daily scheduler. Given a day's free windows,
 * ranked tasks and fixed commitments it produces a realistic timeline that never
 * overlaps and never exceeds the user's configured block budget.
 *
 * All arithmetic happens on UTC instants; the user's timezone is used only to
 * locate the workday window, which keeps daylight-saving transitions correct.
 */

import { addMinutes, differenceInMinutes } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { parseDateOnly, startOfDay } from '../utils/dates';
import type { Priority, TimeBlock, TimeBlockKind } from '../types';
import { rankTasks, type PriorityBreakdown } from './priority';

export interface PlannerTask {
  id: string;
  title: string;
  priority: Priority;
  status: string;
  estimated_minutes: number | null;
  due_date: string | null;
  project_id: string | null;
  goal_id: string | null;
}

export interface PlannerCommitment {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  kind: TimeBlockKind;
}

export interface PlannedBlock {
  task_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  kind: TimeBlockKind;
  minutes: number;
  position: number;
}

export interface PlanSkipped {
  task_id: string;
  title: string;
  reason: string;
}

export interface PlanResult {
  date: string;
  timezone: string;
  blocks: PlannedBlock[];
  skipped: PlanSkipped[];
  plannedMinutes: number;
  availableMinutes: number;
  utilisation: number;
  summary: string;
  overloaded: boolean;
}

interface Window {
  start: Date;
  end: Date;
}

const DEFAULT_TASK_MINUTES = 30;
const BREAK_KIND: TimeBlockKind = 'break';

/** Subtract a set of busy windows from the workday window. */
export function freeWindows(workday: Window, busy: Window[]): Window[] {
  const sorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const windows: Window[] = [];
  let cursor = workday.start;

  for (const block of sorted) {
    if (block.end <= cursor) continue;
    if (block.start >= workday.end) break;
    const start = block.start < cursor ? cursor : block.start;
    if (start > cursor) windows.push({ start: cursor, end: start });
    if (block.end > cursor) cursor = block.end;
    if (cursor >= workday.end) break;
  }
  if (cursor < workday.end) windows.push({ start: cursor, end: workday.end });
  return windows.filter((window) => differenceInMinutes(window.end, window.start) >= 15);
}

export interface BuildPlanOptions {
  date: string; // yyyy-MM-dd
  timezone: string;
  workdayStart: string; // HH:mm
  workdayEnd: string; // HH:mm
  breakMinutes: number;
  maxDailyBlocks: number;
  tasks: PlannerTask[];
  commitments?: PlannerCommitment[];
  blockedTaskIds?: Set<string>;
  now?: Date;
  /** Minutes of buffer left after each focus block before the next one. */
  bufferMinutes?: number;
}

export function buildDailyPlan(options: BuildPlanOptions): PlanResult {
  const now = options.now ?? new Date();
  const dayDate = parseDateOnly(options.date) ?? startOfDay(now);
  const workday: Window = {
    start: fromZonedTime(localStart(dayDate, options.workdayStart), options.timezone),
    end: fromZonedTime(localStart(dayDate, options.workdayEnd), options.timezone),
  };

  const busy: Window[] = (options.commitments ?? []).map((commitment) => ({
    start: new Date(commitment.start_at),
    end: new Date(commitment.end_at),
  }));
  const windows = freeWindows(workday, busy);
  const availableMinutes = windows.reduce((sum, window) => sum + differenceInMinutes(window.end, window.start), 0);

  const ranked = rankTasks(options.tasks as never, {
    now,
    blockedTaskIds: options.blockedTaskIds,
  });

  const blocks: PlannedBlock[] = [];
  const skipped: PlanSkipped[] = [];

  // Blocked tasks are filtered out by the ranking step; surface them anyway so
  // the user can see exactly why nothing was scheduled for them.
  for (const candidate of options.tasks) {
    if (options.blockedTaskIds?.has(candidate.id) && candidate.status !== 'completed' && candidate.status !== 'cancelled') {
      skipped.push({ task_id: candidate.id, title: candidate.title, reason: 'Waiting on unfinished dependencies' });
    }
  }
  let plannedMinutes = 0;
  let breakDebt = 0;
  const buffer = options.bufferMinutes ?? 0;

  let windowIndex = 0;
  let cursor = windows[0]?.start ?? workday.end;

  const pushBlock = (block: Omit<PlannedBlock, 'position'>) => {
    blocks.push({ ...block, position: blocks.length });
    plannedMinutes += block.minutes;
  };

  for (const entry of ranked) {
    const task = entry.task as unknown as PlannerTask;
    if (options.blockedTaskIds?.has(task.id)) {
      skipped.push({ task_id: task.id, title: task.title, reason: 'Waiting on unfinished dependencies' });
      continue;
    }
    if (blocks.filter((block) => block.kind === 'focus').length >= options.maxDailyBlocks) {
      skipped.push({ task_id: task.id, title: task.title, reason: 'Daily focus-block budget reached' });
      continue;
    }

    let minutes = task.estimated_minutes && task.estimated_minutes > 0 ? task.estimated_minutes : DEFAULT_TASK_MINUTES;
    let remaining = minutes;

    // Advance to a window that has room.
    while (windowIndex < windows.length && differenceInMinutes(windows[windowIndex].end, cursor) < 15) {
      windowIndex += 1;
      cursor = windows[windowIndex]?.start ?? workday.end;
    }
    if (windowIndex >= windows.length) {
      skipped.push({ task_id: task.id, title: task.title, reason: 'Not enough time left today' });
      continue;
    }

    // A task longer than 150 minutes is split into chunks so the plan stays realistic.
    const chunkSize = 120;
    let firstChunk = true;
    while (remaining > 0) {
      const roomInWindow = differenceInMinutes(windows[windowIndex].end, cursor);
      if (roomInWindow < 15) {
        windowIndex += 1;
        cursor = windows[windowIndex]?.start ?? workday.end;
        if (windowIndex >= windows.length) break;
        continue;
      }
      const chunk = Math.min(remaining, chunkSize, roomInWindow);
      const start = new Date(cursor);
      const end = addMinutes(start, chunk);

      pushBlock({
        task_id: task.id,
        title: firstChunk ? task.title : `${task.title} (continued)`,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        kind: 'focus',
        minutes: chunk,
      });
      firstChunk = false;
      remaining -= chunk;
      cursor = end;
      breakDebt += chunk;

      // Insert a break once the accumulated focus time passes 90 minutes.
      if (breakDebt >= 90 && options.breakMinutes > 0) {
        const room = differenceInMinutes(windows[windowIndex].end, cursor);
        const breakLength = Math.min(options.breakMinutes, room);
        if (breakLength >= 5) {
          const breakStart = new Date(cursor);
          const breakEnd = addMinutes(breakStart, breakLength);
          pushBlock({
            task_id: null,
            title: 'Break',
            start_at: breakStart.toISOString(),
            end_at: breakEnd.toISOString(),
            kind: BREAK_KIND,
            minutes: breakLength,
          });
          cursor = breakEnd;
        }
        breakDebt = 0;
      } else if (buffer > 0) {
        const room = differenceInMinutes(windows[windowIndex].end, cursor);
        const bufferLength = Math.min(buffer, room);
        if (bufferLength >= 5) {
          const bufferStart = new Date(cursor);
          cursor = addMinutes(bufferStart, bufferLength);
        }
      }
    }

    if (remaining > 0) {
      skipped.push({
        task_id: task.id,
        title: task.title,
        reason: `Only ${minutes - remaining} of ${minutes} minutes fit in today's schedule`,
      });
    }
  }

  const utilisation = availableMinutes === 0 ? 0 : Math.round((plannedMinutes / availableMinutes) * 100);
  const overloaded = utilisation > 110;

  const focusCount = blocks.filter((block) => block.kind === 'focus').length;
  const summary =
    focusCount === 0
      ? 'No tasks scheduled. Capture work or add tasks to your projects.'
      : `${focusCount} focus block${focusCount === 1 ? '' : 's'} across ${formatClock(blocks[0]?.start_at, options.timezone)}–${formatClock(blocks[blocks.length - 1]?.end_at, options.timezone)}${overloaded ? ' — heavily loaded, consider moving work to tomorrow.' : ''}`;

  return {
    date: options.date,
    timezone: options.timezone,
    blocks,
    skipped,
    plannedMinutes,
    availableMinutes,
    utilisation,
    summary,
    overloaded,
  };
}

/** Build a wall-clock Date for HH:mm on the given calendar day. */
function localStart(dayDate: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10));
  return new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hours || 0, minutes || 0, 0, 0);
}

function formatClock(iso: string | undefined, timezone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: timezone, hour12: false }).format(
    new Date(iso),
  );
}

/** Detect collisions between a candidate block and existing blocks. */
export function findConflicts<T extends { start_at: string; end_at: string }>(
  candidate: { start_at: string; end_at: string },
  existing: T[],
): T[] {
  const start = new Date(candidate.start_at);
  const end = new Date(candidate.end_at);
  return existing.filter((block) => {
    const bStart = new Date(block.start_at);
    const bEnd = new Date(block.end_at);
    return start < bEnd && bStart < end;
  });
}

/** Convert planned blocks into time_blocks rows. */
export function planToTimeBlocks(
  plan: PlanResult,
  dailyPlanId: string | null,
): Array<Omit<TimeBlock, 'id' | 'user_id' | 'created_at' | 'updated_at'>> {
  return plan.blocks.map((block) => ({
    daily_plan_id: dailyPlanId,
    task_id: block.task_id,
    title: block.title,
    start_at: block.start_at,
    end_at: block.end_at,
    kind: block.kind,
    status: 'planned' as const,
    position: block.position,
  }));
}

export type { PriorityBreakdown };
