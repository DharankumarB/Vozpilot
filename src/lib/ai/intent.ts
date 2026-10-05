/**
 * Deterministic intent parser used by the built-in reasoning engine.
 *
 * This is real natural-language understanding code: it classifies intent,
 * extracts slots (titles, dates, priorities, durations) and resolves references
 * against the user's *actual* records. When a reference is ambiguous it asks a
 * clarifying question instead of guessing.
 *
 * It is intentionally exported and unit-tested separately from the provider so
 * the parsing rules can evolve without touching the orchestration layer.
 */

import type { Clarification, EntityCandidate, ToolCallRequest } from './provider';
import { detectDate } from '../engine/inbox';
import { addDays, startOfDay } from '../utils/dates';

export interface ParsedIntent {
  /** Tool to call, or null for a conversational reply. */
  tool: string | null;
  args: Record<string, unknown>;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  reply?: string;
  clarification?: Clarification;
  /** Which sub-agent owns this intent. */
  agent: 'vozcore' | 'vozgoal' | 'vozproject' | 'vozday' | 'vozinbox';
}

export interface IntentContext {
  tasks: EntityCandidate[];
  projects: EntityCandidate[];
  goals: EntityCandidate[];
  timezone: string;
  now: Date;
}

// ---------------------------------------------------------------------------
// Entity resolution
// ---------------------------------------------------------------------------
export function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface EntityMatch {
  match: EntityCandidate | null;
  candidates: EntityCandidate[];
  ambiguous: boolean;
}

export function findEntity(query: string, candidates: EntityCandidate[]): EntityMatch {
  const needle = normalise(query);
  if (needle.length === 0) return { match: null, candidates: [], ambiguous: false };

  const scored = candidates
    .map((candidate) => {
      const title = normalise(candidate.title);
      let score = 0;
      if (title === needle) score = 100;
      else if (title.includes(needle)) score = 85;
      else if (needle.includes(title) && title.length >= 3) score = 75;
      else {
        const needleTokens = new Set(needle.split(' ').filter((token) => token.length > 2));
        const titleTokens = title.split(' ').filter((token) => token.length > 2);
        if (needleTokens.size > 0 && titleTokens.length > 0) {
          const hits = titleTokens.filter((token) => needleTokens.has(token)).length;
          score = (hits / Math.max(needleTokens.size, titleTokens.length)) * 65;
        }
      }
      return { candidate, score };
    })
    .filter((entry) => entry.score >= 40)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { match: null, candidates: [], ambiguous: false };

  const best = scored[0];
  const tied = scored.filter((entry) => entry.score >= best.score - 6);
  return {
    match: best.candidate,
    candidates: tied.map((entry) => entry.candidate),
    ambiguous: tied.length > 1,
  };
}

// ---------------------------------------------------------------------------
// Slot extraction
// ---------------------------------------------------------------------------
export function extractPriority(text: string): 'low' | 'medium' | 'high' | 'critical' | undefined {
  if (/\b(urgent|asap|immediately|critical|emergency|top priority)\b/i.test(text)) return 'critical';
  if (/\b(important|high priority|priority|soon)\b/i.test(text)) return 'high';
  if (/\b(low priority|no rush|whenever|sometime)\b/i.test(text)) return 'low';
  return undefined;
}

export function extractMinutes(text: string): number | undefined {
  const hours = /(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(text);
  if (hours) return Math.round(Number.parseFloat(hours[1].replace(',', '.')) * 60);
  const minutes = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/i.exec(text);
  if (minutes) return Number.parseInt(minutes[1], 10);
  return undefined;
}

const FILLER =
  /\b(please|can you|could you|kindly|i want to|i need to|i wanna|let'?s|hey|vozpilot|voz|now|today|for me|a|an|the)\b/gi;

export function cleanTitle(value: string): string {
  return value
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,:-]+|[\s,:-]+$/g, '')
    .trim();
}

/** Extract the thing being created from "create a task to <x>" style phrases. */
export function extractSubject(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const raw = match[1].trim();
      const cleaned = cleanTitle(raw);
      if (cleaned.length >= 2) return cleaned.slice(0, 200);
    }
  }
  return '';
}

function resolveDateQuery(text: string, now: Date): string | null {
  const detected = detectDate(text, now);
  if (detected) return detected.date.toISOString();
  if (/\btomorrow\b/i.test(text)) return addDays(startOfDay(now), 1).toISOString();
  if (/\btoday\b/i.test(text)) return startOfDay(now).toISOString();
  if (/\bnext week\b/i.test(text)) return addDays(startOfDay(now), 7).toISOString();
  return null;
}

const CAPABILITIES = [
  'Create, update, complete and reschedule tasks',
  'Create goals and break them into milestones, projects and tasks',
  'Create and update projects, milestones and dependencies',
  'Build and refresh your daily plan and time blocks',
  'Analyse inbox items and turn them into actions',
  'Recommend your next best action using real priority scoring',
  'Report project and goal health, risk and workload',
  'Remember preferences and recall them later',
];

// ---------------------------------------------------------------------------
// Intent table
// ---------------------------------------------------------------------------
interface Rule {
  id: string;
  test: RegExp;
  agent: ParsedIntent['agent'];
  tool: string;
  build: (text: string, context: IntentContext) => Omit<ParsedIntent, 'agent' | 'tool'>;
}

const RULES: Rule[] = [
  {
    id: 'next-best-action',
    test: /(what (should|do) i do|what'?s next|what do i do next|next best action|what now|where (do|should) i start)/i,
    agent: 'vozcore',
    tool: 'get_next_best_action',
    build: () => ({ args: {} }),
  },
  {
    id: 'plan-tomorrow',
    test: /(plan|schedule|prepare|organi[sz]e)\b[^.?!]*\b(tomorrow|next day)\b/i,
    agent: 'vozday',
    tool: 'create_daily_plan',
    build: (_text, context) => ({ args: { date: addDays(startOfDay(context.now), 1).toISOString().slice(0, 10) } }),
  },
  {
    id: 'plan-day',
    test: /\b(plan|schedule|prepare|organi[sz]e|build)\b[^.?!]*\b(my )?(day|schedule|today|time|agenda)\b/i,
    agent: 'vozday',
    tool: 'create_daily_plan',
    build: (_text, context) => ({ args: { date: context.now.toISOString().slice(0, 10) } }),
  },
  {
    id: 'overdue-tasks',
    test: /\b(overdue|past due|late|behind|missed)\b/i,
    agent: 'vozday',
    tool: 'list_tasks',
    build: () => ({ args: { overdue: true, include_completed: false } }),
  },
  {
    id: 'project-risk',
    test: /\b(at risk|risky|which project|project health|projects? (are|is) (in )?trouble|project status)/i,
    agent: 'vozproject',
    tool: 'get_project_health',
    build: () => ({ args: {} }),
  },
  {
    id: 'goal-health',
    test: /\b(goal (health|progress)|how am i doing on (my )?goals?|goals? at risk)/i,
    agent: 'vozgoal',
    tool: 'get_goal_health',
    build: () => ({ args: {} }),
  },
  {
    id: 'workload',
    test: /\b(workload|how busy|how much (work|time)|am i overloaded|capacity)/i,
    agent: 'vozday',
    tool: 'get_daily_workload',
    build: (_text, context) => ({ args: { date: context.now.toISOString().slice(0, 10) } }),
  },
  {
    id: 'summarise',
    test: /\b(summar(y|ize|ise)|brief(ing)?|priorities today|my priorities|today'?s plan|what'?s on (my )?(plate|today))/i,
    agent: 'vozday',
    tool: 'get_daily_plan',
    build: (_text, context) => ({ args: { date: context.now.toISOString().slice(0, 10) } }),
  },
  {
    id: 'list-tasks',
    test: /\b(show|list|get|what are|what'?s)\b[^.?!]*\b(tasks?|todos?|to-?dos?|my list)\b/i,
    agent: 'vozcore',
    tool: 'list_tasks',
    build: (text) => ({ args: { status: /\bin progress\b/i.test(text) ? 'in_progress' : undefined, include_completed: false } }),
  },
  {
    id: 'list-goals',
    test: /\b(show|list|get|what are)\b[^.?!]*\bgoals?\b/i,
    agent: 'vozgoal',
    tool: 'list_goals',
    build: () => ({ args: {} }),
  },
  {
    id: 'list-projects',
    test: /\b(show|list|get|what are)\b[^.?!]*\bprojects?\b/i,
    agent: 'vozproject',
    tool: 'list_projects',
    build: () => ({ args: {} }),
  },
  {
    id: 'list-notifications',
    test: /\b(show|list|any|check)\b[^.?!]*\b(notifications?|alerts?|updates?)\b/i,
    agent: 'vozcore',
    tool: 'list_notifications',
    build: () => ({ args: { limit: 8 } }),
  },
  {
    id: 'goal-breakdown',
    test: /\b(break|split|decompose)\b[^.?!]*\b(goal|down)\b|\bmilestones? for\b/i,
    agent: 'vozgoal',
    tool: 'plan_goal_breakdown',
    build: (text, context) => {
      const goalQuery = extractSubject(text, [/\bfor (?:my )?goal (?:called |named )?(.+)/i, /\bgoal (?:called |named )?(.+)/i]);
      if (goalQuery) {
        const resolved = findEntity(goalQuery, context.goals);
        if (resolved.match) return { args: { goal_id: resolved.match.id } };
        return { args: { goal_query: goalQuery } };
      }
      return { args: {} };
    },
  },
  {
    id: 'create-goal',
    test: /\b(create|add|new|set|start|make)\b[^.?!]*\bgoals?\b/i,
    agent: 'vozgoal',
    tool: 'create_goal',
    build: (text) => {
      const title = extractSubject(text, [
        /\b(?:create|add|new|set|start|make)\s+(?:a\s+)?goal\s+(?:to\s+|called\s+|named\s+|for\s+)?(.+)/i,
        /\bgoal\s+(?:to\s+|called\s+|named\s+)?(.+)/i,
      ]);
      return {
        args: {
          title: title || 'New goal',
          target_date: resolveDateQuery(text, new Date()),
          priority: extractPriority(text),
        },
      };
    },
  },
  {
    id: 'create-project',
    test: /\b(create|add|new|start|make|set up)\b[^.?!]*\bprojects?\b/i,
    agent: 'vozproject',
    tool: 'create_project',
    build: (text, context) => {
      const title = extractSubject(text, [
        /\b(?:create|add|new|start|make|set up)\s+(?:a\s+)?project\s+(?:called\s+|named\s+|for\s+|to\s+)?(.+)/i,
        /\bproject\s+(?:called\s+|named\s+)?(.+)/i,
      ]);
      const goalQuery = extractSubject(text, [/\bfor (?:my )?goal (?:called |named )?(.+)/i]);
      const resolved = goalQuery ? findEntity(goalQuery, context.goals) : { match: null };
      return {
        args: {
          title: title || 'New project',
          goal_id: resolved.match?.id,
          target_date: resolveDateQuery(text, context.now),
          priority: extractPriority(text),
        },
      };
    },
  },
  {
    id: 'create-milestone',
    test: /\b(create|add|new)\b[^.?!]*\bmilestones?\b/i,
    agent: 'vozgoal',
    tool: 'create_milestone',
    build: (text, context) => {
      const title = extractSubject(text, [
        /\b(?:create|add|new)\s+(?:a\s+)?milestone\s+(?:called\s+|named\s+)?(.+)/i,
        /\bmilestone\s+(?:called\s+|named\s+)?(.+)/i,
      ]);
      const projectQuery = extractSubject(text, [/\b(?:for|in|to) (?:the )?project (.+)/i]);
      const goalQuery = extractSubject(text, [/\b(?:for|to) (?:the )?goal (.+)/i]);
      const project = projectQuery ? findEntity(projectQuery, context.projects).match : null;
      const goal = goalQuery ? findEntity(goalQuery, context.goals).match : null;
      return {
        args: {
          title: title || 'New milestone',
          project_id: project?.id,
          goal_id: goal?.id,
          due_date: resolveDateQuery(text, context.now),
        },
      };
    },
  },
  {
    id: 'complete-task',
    test: /\b(mark|complete|completed|finish|finished|done with|i (?:just )?(?:did|finished|completed))\b/i,
    agent: 'vozproject',
    tool: 'complete_task',
    build: (text, context) => {
      const query = extractSubject(text, [
        /\b(?:mark|complete|completed|finish|finished|done with)\s+(.+)/i,
        /\bi (?:just )?(?:finished|completed|did)\s+(.+)/i,
      ]);
      const resolved = findEntity(query, context.tasks);
      if (!resolved.match) return { args: { task_query: query }, reply: `I could not find a task matching "${query}".` };
      if (resolved.ambiguous) {
        return {
          args: {},
          clarification: {
            question: `Which task do you mean by "${query}"?`,
            options: resolved.candidates.map((candidate) => ({ id: candidate.id, label: candidate.title })),
            tool: 'complete_task',
            partialArguments: {},
          },
        };
      }
      return { args: { task_id: resolved.match.id } };
    },
  },
  {
    id: 'move-task',
    test: /\b(move|reschedule|push|shift|postpone|defer)\b/i,
    agent: 'vozday',
    tool: 'update_task',
    build: (text, context) => {
      const match =
        /\b(?:move|reschedule|push|shift|postpone|defer)\s+(.+?)\s+to\s+(.+)/i.exec(text) ??
        /\b(?:move|reschedule|push|shift|postpone|defer)\s+(.+)/i.exec(text);
      const query = match?.[1] ? cleanTitle(match[1]) : '';
      const target = match?.[2] ? match[2] : 'tomorrow';
      const resolved = findEntity(query, context.tasks);
      if (!resolved.match) return { args: { task_query: query }, reply: `I could not find a task matching "${query}".` };
      if (resolved.ambiguous) {
        return {
          args: {},
          clarification: {
            question: `Which task do you mean by "${query}"?`,
            options: resolved.candidates.map((candidate) => ({ id: candidate.id, label: candidate.title })),
            tool: 'update_task',
            partialArguments: { due_date: resolveDateQuery(target, context.now) },
          },
        };
      }
      const dueDate = resolveDateQuery(target, context.now);
      return { args: { task_id: resolved.match.id, due_date: dueDate, scheduled_date: dueDate ? dueDate.slice(0, 10) : undefined } };
    },
  },
  {
    id: 'create-dependency',
    test: /\b(depends on|depends upon|blocked by|is blocked by|waiting on|after)\b/i,
    agent: 'vozproject',
    tool: 'create_task_dependency',
    build: (text, context) => {
      const match =
        /(.+?)\s+(?:depends on|depends upon|is blocked by|blocked by|waits for|waiting on|comes after)\s+(.+)/i.exec(text);
      if (!match) return { args: {}, reply: 'Tell me which task depends on which, for example "Deploy depends on Build".' };
      const first = findEntity(cleanTitle(match[1]), context.tasks);
      const second = findEntity(cleanTitle(match[2]), context.tasks);
      if (!first.match || !second.match) {
        return { args: {}, reply: 'I could not match both tasks. Try naming them exactly as they appear in your task list.' };
      }
      return { args: { task_id: first.match.id, depends_on_task_id: second.match.id } };
    },
  },
  {
    id: 'delete-task',
    test: /\b(delete|remove|get rid of|trash)\b/i,
    agent: 'vozproject',
    tool: 'delete_task',
    build: (text, context) => {
      const query = extractSubject(text, [
        /\b(?:delete|remove|get rid of|trash)\s+(?:the\s+)?(?:task\s+)?(.+)/i,
      ]);
      const resolved = findEntity(query, context.tasks);
      return { args: { task_id: resolved.match?.id, task_query: query } };
    },
  },
  {
    id: 'remember',
    test: /\b(remember|note that|keep in mind|don'?t forget that)\b/i,
    agent: 'vozcore',
    tool: 'create_memory',
    build: (text) => {
      const content = extractSubject(text, [
        /\b(?:remember|note that|keep in mind|don'?t forget that)\s+(.+)/i,
      ]);
      return { args: { content: content || text.trim(), category: 'important_context' } };
    },
  },
  {
    id: 'recall',
    test: /\b(what do you (know|remember)|recall|my preferences|my working style)\b/i,
    agent: 'vozcore',
    tool: 'retrieve_memory',
    build: (text) => ({ args: { query: text.trim() } }),
  },
  {
    id: 'analyse-inbox',
    test: /\b(analy[sz]e|process|triage|review)\b[^.?!]*\b(inbox|message|email)\b/i,
    agent: 'vozinbox',
    tool: 'analyze_inbox_item',
    build: () => ({ args: {} }),
  },
  {
    id: 'create-task',
    test: /\b(create|add|new|make|remind me to|remind me|i need to|todo)\b/i,
    agent: 'vozproject',
    tool: 'create_task',
    build: (text, context) => {
      const title = extractSubject(text, [
        /\b(?:create|add|new|make)\s+(?:a\s+)?(?:task|todo|to-?do)\s+(?:to\s+|for\s+|called\s+|named\s+)?(.+)/i,
        /\bremind me to\s+(.+)/i,
        /\bi need to\s+(.+)/i,
        /\btask\s+(?:to\s+|called\s+|named\s+)?(.+)/i,
      ]);
      const projectQuery = extractSubject(text, [
        /\b(?:for|in|on|to) (?:the )?project (?:called |named )?(.+)/i,
        /\bproject (?:called |named )?(.+)/i,
      ]);
      const goalQuery = extractSubject(text, [/\b(?:for|to) (?:the )?goal (?:called |named )?(.+)/i]);
      const project = projectQuery ? findEntity(projectQuery, context.projects).match : null;
      const goal = goalQuery ? findEntity(goalQuery, context.goals).match : null;
      const dueDate = resolveDateQuery(text, context.now);
      return {
        args: {
          title: title || cleanTitle(text) || 'New task',
          project_id: project?.id,
          goal_id: goal?.id,
          due_date: dueDate,
          priority: extractPriority(text),
          estimated_minutes: extractMinutes(text),
        },
      };
    },
  },
  {
    id: 'context',
    test: /\b(status|overview|context|where am i|catch me up|what'?s going on)\b/i,
    agent: 'vozcore',
    tool: 'get_user_context',
    build: () => ({ args: {} }),
  },
];

export function parseIntent(text: string, context: IntentContext): ParsedIntent {
  const trimmed = text.trim();

  if (/^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/i.test(trimmed) && trimmed.length < 40) {
    return {
      tool: null,
      agent: 'vozcore',
      args: {},
      reply: "Hello. I'm VozCore. Ask me what to do next, plan your day, or create work from a sentence.",
    };
  }

  if (/^(help|what can you do|\?|commands|capabilities)/i.test(trimmed)) {
    return {
      tool: null,
      agent: 'vozcore',
      args: {},
      reply: `Here is what I can do right now:\n${CAPABILITIES.map((item) => `- ${item}`).join('\n')}`,
    };
  }

  for (const rule of RULES) {
    if (!rule.test.test(trimmed)) continue;
    const built = rule.build(trimmed, context);
    const clarification = 'clarification' in built ? built.clarification : undefined;
    return {
      tool: rule.tool,
      agent: rule.agent,
      args: built.args,
      clarification,
      reply: 'reply' in built ? built.reply : undefined,
    };
  }

  // Fall back to a read-only context lookup rather than inventing an action.
  return {
    tool: 'get_user_context',
    agent: 'vozcore',
    args: {},
    reply: undefined,
  };
}

export function toToolCall(intent: ParsedIntent, id: string): ToolCallRequest {
  return { id, name: intent.tool ?? 'get_user_context', arguments: intent.args };
}

export { CAPABILITIES };
