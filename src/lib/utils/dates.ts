/**
 * Date/time helpers.
 *
 * Storage is always UTC (`timestamptz`). Conversion to the user's timezone
 * happens here, at the edge, and never by string surgery elsewhere in the app.
 */

import {
  addDays,
  addMinutes,
  differenceInMinutes,
  endOfDay,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';

export const MINUTE = 60_000;

/** Parse a Postgres `date` (yyyy-MM-dd) into a local Date at midnight. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a `date` column for display in the user's timezone. */
export function formatDateOnly(value: string | null | undefined, tz: string, pattern = 'MMM d, yyyy'): string {
  const date = parseDateOnly(value);
  if (!date) return '';
  return formatInTimeZone(date, tz, pattern);
}

/** Parse a `timestamptz` value into a zoned Date for the user's timezone. */
export function toUserTime(value: string | Date, tz: string): Date {
  const date = typeof value === 'string' ? parseISO(value) : value;
  if (Number.isNaN(date.getTime())) return new Date(NaN);
  return toZonedTime(date, tz);
}

/** Format a `timestamptz` value in the user's timezone. */
export function formatDateTime(value: string | Date | null | undefined, tz: string, pattern = "MMM d, yyyy 'at' h:mm a"): string {
  if (!value) return '';
  const zoned = toUserTime(value, tz);
  if (Number.isNaN(zoned.getTime())) return '';
  return formatInTimeZone(zoned, tz, pattern);
}

export function formatTime(value: string | Date | null | undefined, tz: string): string {
  if (!value) return '';
  const zoned = toUserTime(value, tz);
  if (Number.isNaN(zoned.getTime())) return '';
  return formatInTimeZone(zoned, tz, 'h:mm a');
}

/** Build a UTC instant from a wall-clock date + time in a given timezone. */
export function zonedTimeToUtc(date: Date, time: string, tz: string): Date {
  const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10));
  const base = startOfDay(date);
  const local = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours || 0, minutes || 0, 0, 0);
  // `fromZonedTime` interprets the given wall-clock time in `tz` and returns UTC.
  return fromZonedTime(local, tz);
}

/** Today's calendar date (yyyy-MM-dd) in the user's timezone. */
export function todayInZone(tz: string, now: Date = new Date()): string {
  return formatInTimeZone(now, tz, 'yyyy-MM-dd');
}

/** Calendar date (yyyy-MM-dd) for an arbitrary instant, in the user's timezone. */
export function dateKeyInZone(value: string | Date, tz: string): string {
  const date = typeof value === 'string' ? parseISO(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return formatInTimeZone(date, tz, 'yyyy-MM-dd');
}

export function isToday(value: string | Date, tz: string, now: Date = new Date()): boolean {
  return dateKeyInZone(value, tz) === todayInZone(tz, now);
}

export function isOverdue(value: string | null | undefined, now: Date = new Date()): boolean {
  if (!value) return false;
  const date = typeof value === 'string' ? parseISO(value) : value;
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < now.getTime();
}

/** Whole days from `now` until `value` (negative when in the past). */
export function daysUntil(value: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;
  const date = typeof value === 'string' ? parseISO(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const a = startOfDay(now).getTime();
  const b = startOfDay(date).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function relativeDueLabel(value: string | null | undefined, tz: string, now: Date = new Date()): string {
  if (!value) return 'No due date';
  const date = typeof value === 'string' ? parseISO(value) : value;
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  const diff = daysUntil(date, now);
  if (diff === null) return 'No due date';
  if (diff === 0) return `Today ${formatTime(date, tz)}`.trim();
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${Math.abs(diff)} days overdue`;
  if (diff <= 7) return `In ${diff} days`;
  return formatDateOnly(value, tz, 'MMM d');
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Human-friendly "time ago" for notification/activity feeds. */
export function timeAgo(value: string | Date, now: Date = new Date()): string {
  const date = typeof value === 'string' ? parseISO(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatInTimeZone(date, 'UTC', 'MMM d');
}

export { addDays, addMinutes, differenceInMinutes, endOfDay, isSameDay, startOfDay, startOfWeek, format };

/** Monday-start week containing `date`. */
export function startOfUserWeek(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}
