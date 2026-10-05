/**
 * VozInbox analysis engine.
 *
 * Turns free-form inbox text into structured, actionable data: intent, deadline,
 * suggested actions, priority and the project/goal it most likely belongs to.
 *
 * SECURITY: inbox content is *untrusted data*. It is analysed, never executed.
 * The functions below only extract information; they never treat message text as
 * an instruction to the agent, and extracted values are always validated by the
 * tool layer before anything is written to the database.
 */

import type { Goal, InboxAnalysis, InboxActionSuggestion, Priority, Project } from '../types';
import { addDays, startOfDay } from '../utils/dates';

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7,
  september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

const INTENT_PATTERNS: Array<{ intent: string; patterns: RegExp[]; weight: number }> = [
  { intent: 'meeting', patterns: [/\bmeeting\b/i, /\bcall\b/i, /\bsync\b/i, /\bstandup\b/i, /\breview\b/i, /\binterview\b/i], weight: 3 },
  { intent: 'deadline', patterns: [/\bdeadline\b/i, /\bdue\b/i, /\bsubmit\b/i, /\bdeliver\b/i, /\bfinal\b/i, /\bexam\b/i, /\bassignment\b/i], weight: 3 },
  { intent: 'request', patterns: [/\bcan you\b/i, /\bcould you\b/i, /\bplease\b/i, /\bneed(s|ed)?\b/i, /\brequest\b/i, /\bask(ed|ing)?\b/i], weight: 2 },
  { intent: 'follow_up', patterns: [/\bfollow[\s-]?up\b/i, /\bremind\b/i, /\bcheck\b/i, /\bchase\b/i, /\bwaiting\b/i], weight: 2 },
  { intent: 'information', patterns: [/\bfyi\b/i, /\bfor your information\b/i, /\bupdate\b/i, /\bnews\b/i, /\bannounce\b/i], weight: 1 },
];

const ACTION_VERBS: Array<{ verb: string; patterns: RegExp[] }> = [
  { verb: 'Prepare', patterns: [/\bprepare\b/i, /\bget ready\b/i, /\bpractice\b/i] },
  { verb: 'Submit', patterns: [/\bsubmit\b/i, /\bupload\b/i, /\bsend\b/i, /\bshare\b/i, /\bdeliver\b/i] },
  { verb: 'Review', patterns: [/\breview\b/i, /\bcheck\b/i, /\bverify\b/i, /\baudit\b/i] },
  { verb: 'Fix', patterns: [/\bfix\b/i, /\bbug\b/i, /\bbroken\b/i, /\berror\b/i] },
  { verb: 'Build', patterns: [/\bbuild\b/i, /\bimplement\b/i, /\bcreate\b/i, /\bdevelop\b/i] },
  { verb: 'Study', patterns: [/\bstudy\b/i, /\blearn\b/i, /\brevise\b/i, /\bpractise\b/i] },
  { verb: 'Follow up', patterns: [/\bfollow[\s-]?up\b/i, /\bchase\b/i, /\bremind\b/i] },
];

const URGENCY_PATTERNS: Array<{ pattern: RegExp; priority: Priority }> = [
  { pattern: /\burgent\b|\basap\b|\bimmediately\b|\bcritical\b|\bemergency\b/i, priority: 'critical' },
  { pattern: /\bimportant\b|\bhigh priority\b|\bpriority\b|\bsoon\b/i, priority: 'high' },
  { pattern: /\bwhen you can\b|\bno rush\b|\blow priority\b/i, priority: 'low' },
];

export interface DetectedDate {
  date: Date;
  text: string;
  timeText: string | null;
}

/** Extract the earliest plausible deadline from free text. */
export function detectDate(text: string, now: Date = new Date()): DetectedDate | null {
  const candidates: DetectedDate[] = [];

  // 1. Explicit ISO date
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    const date = new Date(`${iso[0]}T09:00:00Z`);
    if (!Number.isNaN(date.getTime())) candidates.push({ date, text: iso[0], timeText: null });
  }

  // 2. "Friday 3 PM", "on Monday at 10:30", "next Tuesday 9am"
  const weekdayTime =
    /\b(?:(next|this|coming)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)\b(?:\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i;
  const weekdayMatch = weekdayTime.exec(text);
  if (weekdayMatch) {
    const target = WEEKDAYS[weekdayMatch[2].toLowerCase()];
    if (target !== undefined) {
      const base = startOfDay(now);
      let delta = (target - base.getDay() + 7) % 7;
      if (delta === 0) delta = 7; // "today" style references always mean the coming occurrence
      if (weekdayMatch[1]?.toLowerCase() === 'next') delta += 7;
      const date = addDays(base, delta);
      const timeText = weekdayMatch[3] ? `${weekdayMatch[3]}${weekdayMatch[4] ? ` ${weekdayMatch[4].toUpperCase()}` : ''}` : null;
      if (timeText && weekdayMatch[3]) {
        let hours = Number.parseInt(weekdayMatch[3], 10);
        const minutes = weekdayMatch[5] ? Number.parseInt(weekdayMatch[5], 10) : 0;
        const meridiem = weekdayMatch[6]?.toLowerCase();
        if (meridiem === 'pm' && hours < 12) hours += 12;
        if (meridiem === 'am' && hours === 12) hours = 0;
        date.setHours(hours, minutes, 0, 0);
      }
      candidates.push({ date, text: weekdayMatch[0].trim(), timeText });
    }
  }

  // 3. "12 March", "March 12", "12th of March 2027"
  const dayMonth = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?(?:\s+(\d{4}))?\b/i;
  const dayMonthMatch = dayMonth.exec(text);
  if (dayMonthMatch) {
    const month = MONTHS[dayMonthMatch[2].toLowerCase()];
    if (month !== undefined) {
      const year = dayMonthMatch[3] ? Number.parseInt(dayMonthMatch[3], 10) : now.getFullYear();
      const date = new Date(year, month, Number.parseInt(dayMonthMatch[1], 10), 9, 0, 0, 0);
      if (!Number.isNaN(date.getTime()) && date.getTime() >= startOfDay(now).getTime() - 86_400_000) {
        candidates.push({ date, text: dayMonthMatch[0].trim(), timeText: null });
      }
    }
  }
  const monthDay = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i;
  const monthDayMatch = monthDay.exec(text);
  if (monthDayMatch) {
    const month = MONTHS[monthDayMatch[1].toLowerCase()];
    if (month !== undefined) {
      const year = monthDayMatch[3] ? Number.parseInt(monthDayMatch[3], 10) : now.getFullYear();
      const date = new Date(year, month, Number.parseInt(monthDayMatch[2], 10), 9, 0, 0, 0);
      if (!Number.isNaN(date.getTime()) && date.getTime() >= startOfDay(now).getTime() - 86_400_000) {
        candidates.push({ date, text: monthDayMatch[0].trim(), timeText: null });
      }
    }
  }

  // 4. Relative: "tomorrow", "in 3 days", "next week", "end of week"
  const tomorrow = /\btomorrow\b/i.exec(text);
  if (tomorrow) candidates.push({ date: addDays(startOfDay(now), 1), text: 'tomorrow', timeText: null });

  const inDays = /\bin\s+(\d{1,3})\s+days?\b/i.exec(text);
  if (inDays) candidates.push({ date: addDays(startOfDay(now), Number.parseInt(inDays[1], 10)), text: inDays[0], timeText: null });

  const nextWeek = /\bnext week\b/i.exec(text);
  if (nextWeek) candidates.push({ date: addDays(startOfDay(now), 7), text: 'next week', timeText: null });

  const eow = /\bend of (?:the )?week\b/i.exec(text);
  if (eow) {
    const base = startOfDay(now);
    candidates.push({ date: addDays(base, (5 - base.getDay() + 7) % 7 || 7), text: 'end of week', timeText: null });
  }

  const today = /\btoday\b|\btonight\b|\bthis evening\b/i.exec(text);
  if (today) candidates.push({ date: startOfDay(now), text: today[0], timeText: null });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.date.getTime() - b.date.getTime());
  return candidates[0];
}

export function detectIntent(text: string): { intent: string; confidence: number } {
  let best = { intent: 'information', score: 0 };
  for (const candidate of INTENT_PATTERNS) {
    let score = 0;
    for (const pattern of candidate.patterns) if (pattern.test(text)) score += candidate.weight;
    if (score > best.score) best = { intent: candidate.intent, score };
  }
  if (best.score === 0) return { intent: 'information', confidence: 0.35 };
  const confidence = Math.min(0.95, 0.45 + best.score * 0.12);
  return { intent: best.intent, confidence: Math.round(confidence * 100) / 100 };
}

export function detectPriority(text: string, detectedDate: DetectedDate | null, now: Date): Priority {
  for (const entry of URGENCY_PATTERNS) if (entry.pattern.test(text)) return entry.priority;
  if (detectedDate) {
    const days = Math.round((startOfDay(detectedDate.date).getTime() - startOfDay(now).getTime()) / 86_400_000);
    if (days <= 1) return 'high';
    if (days <= 3) return 'medium';
  }
  return 'medium';
}

/** Suggest concrete actions implied by the message. */
export function extractActions(text: string, detectedDate: DetectedDate | null, priority: Priority): InboxActionSuggestion[] {
  const sentences = text
    .split(/(?<=[.!?\n])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 3);

  const actions: InboxActionSuggestion[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences) {
    let verb: string | null = null;
    for (const candidate of ACTION_VERBS) {
      if (candidate.patterns.some((pattern) => pattern.test(sentence))) {
        verb = candidate.verb;
        break;
      }
    }
    if (!verb) continue;

    // Use the sentence itself (trimmed) as the action title so it stays concrete.
    const title = sentence.replace(/\s+/g, ' ').slice(0, 160).replace(/[.!?]+$/, '');
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push({
      kind: verb === 'Follow up' ? 'follow_up' : 'task',
      title,
      due_date: detectedDate ? detectedDate.date.toISOString() : null,
      priority,
      confidence: 0.7,
    });
    if (actions.length >= 4) break;
  }

  if (actions.length === 0 && detectedDate) {
    actions.push({
      kind: 'event',
      title: text.replace(/\s+/g, ' ').slice(0, 160),
      due_date: detectedDate.date.toISOString(),
      priority,
      confidence: 0.55,
    });
  }

  return actions;
}

/** Keyword overlap matching against the user's own projects and goals. */
export function matchEntities(
  text: string,
  projects: Project[],
  goals: Goal[],
): { project: Project | null; goal: Goal | null; score: number } {
  const terms = new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3),
  );
  if (terms.size === 0) return { project: null, goal: null, score: 0 };

  let bestProject: Project | null = null;
  let bestProjectScore = 0;
  for (const project of projects) {
    if (project.status === 'archived') continue;
    const words = project.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
    const hits = words.filter((word) => terms.has(word)).length;
    const score = words.length === 0 ? 0 : hits / words.length;
    if (score > bestProjectScore) {
      bestProjectScore = score;
      bestProject = project;
    }
  }

  let bestGoal: Goal | null = null;
  let bestGoalScore = 0;
  for (const goal of goals) {
    if (goal.status !== 'active') continue;
    const words = goal.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
    const hits = words.filter((word) => terms.has(word)).length;
    const score = words.length === 0 ? 0 : hits / words.length;
    if (score > bestGoalScore) {
      bestGoalScore = score;
      bestGoal = goal;
    }
  }

  const score = Math.round(Math.max(bestProjectScore, bestGoalScore) * 100) / 100;
  return {
    project: bestProjectScore >= 0.5 ? bestProject : null,
    goal: bestGoalScore >= 0.5 ? bestGoal : bestProject?.goal_id ? goals.find((goal) => goal.id === bestProject?.goal_id) ?? null : null,
    score,
  };
}

export interface AnalyzeInboxInput {
  subject: string;
  body: string;
  sender: string;
  projects: Project[];
  goals: Goal[];
  now?: Date;
}

/**
 * Full analysis of one inbox item. Pure and synchronous — no network, no LLM.
 * When an LLM provider is configured, VozInbox may additionally refine the
 * summary, but the structured fields always come from here so they are always
 * validated.
 */
export function analyzeInboxItem(input: AnalyzeInboxInput): InboxAnalysis {
  const now = input.now ?? new Date();
  const text = `${input.subject}\n${input.body}`.trim();
  const detected = detectDate(text, now);
  const { intent, confidence: intentConfidence } = detectIntent(text);
  const priority = detectPriority(text, detected, now);
  const actions = extractActions(text, detected, priority);
  const matched = matchEntities(text, input.projects, input.goals);

  let confidence = intentConfidence;
  if (detected) confidence = Math.min(0.95, confidence + 0.2);
  if (actions.length > 0) confidence = Math.min(0.95, confidence + 0.1);
  if (matched.project || matched.goal) confidence = Math.min(0.95, confidence + 0.1);
  if (text.length < 25) confidence = Math.min(confidence, 0.45);

  const reasoningParts: string[] = [`Detected intent: ${intent}.`];
  if (detected) reasoningParts.push(`Date reference "${detected.text}" → ${detected.date.toISOString().slice(0, 10)}.`);
  else reasoningParts.push('No date reference found.');
  if (matched.project) reasoningParts.push(`Matches project "${matched.project.title}".`);
  if (matched.goal) reasoningParts.push(`Matches goal "${matched.goal.title}".`);
  if (confidence < 0.5) reasoningParts.push('Low confidence — ask the user to confirm before creating anything.');

  return {
    intent,
    summary: summarise(input.subject, text),
    deadline: detected ? detected.date.toISOString() : null,
    detected_date_text: detected?.text ?? null,
    detected_time_text: detected?.timeText ?? null,
    actions,
    priority,
    confidence: Math.round(confidence * 100) / 100,
    matched_project_id: matched.project?.id ?? null,
    matched_project_title: matched.project?.title ?? null,
    matched_goal_id: matched.goal?.id ?? null,
    matched_goal_title: matched.goal?.title ?? null,
    reasoning: reasoningParts.join(' '),
  };
}

function summarise(subject: string, text: string): string {
  if (subject.trim().length > 0) return subject.trim().slice(0, 200);
  return text.replace(/\s+/g, ' ').slice(0, 200);
}
