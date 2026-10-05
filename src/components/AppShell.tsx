'use client';

/**
 * AppShell — sidebar (desktop) / top nav + drawer (mobile) + topbar + command bar.
 *
 * Layout is CSS Grid + Flexbox throughout: no absolute positioning, no fixed
 * offsets that can overlap content, and no horizontal overflow at any width.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  CalendarDays,
  Command,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Search,
  Settings,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Button, IconButton, Pill, Skeleton } from './ui';
import { apiRequest, useApi, useDebounced } from './hooks';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  match?: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/goals', label: 'Goals', icon: Target },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/tasks', label: 'Tasks', icon: ListChecks },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/ai', label: 'VozCore AI', icon: Sparkles },
  { href: '/agent-activity', label: 'Agent activity', icon: Command },
];

const SECONDARY_ITEMS: NavItem[] = [{ href: '/settings', label: 'Settings', icon: Settings }];

interface SearchHit {
  id: string;
  title: string;
  kind: 'goal' | 'project' | 'task' | 'inbox';
  href: string;
  subtitle?: string;
}

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { email: string; fullName: string; avatarUrl: string | null };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close transient UI on navigation.
  useEffect(() => {
    setDrawerOpen(false);
    setCommandOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  // Ctrl/Cmd + K opens global search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const initials = useMemo(() => {
    const source = user.fullName.trim() || user.email;
    return source
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }, [user.fullName, user.email]);

  const isActive = (item: NavItem) =>
    item.match ? item.match(pathname) : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const navList = (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm transition-colors duration-150',
              active ? 'bg-violet-accent/14 text-text-primary' : 'text-text-secondary hover:bg-ink-800 hover:text-text-primary',
            )}
          >
            <Icon aria-hidden className={cn('size-4 shrink-0', active && 'text-violet-soft')} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const secondaryList = (
    <nav aria-label="Secondary" className="flex flex-col gap-0.5">
      {SECONDARY_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm transition-colors duration-150',
              active ? 'bg-violet-accent/14 text-text-primary' : 'text-text-secondary hover:bg-ink-800 hover:text-text-primary',
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-1 py-1">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-accent to-violet-deep text-[13px] font-bold text-white"
      >
        V
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight tracking-tight text-text-primary">VozPilot</span>
        <span className="block text-[10px] leading-tight text-text-muted">by VozLook Studios</span>
      </span>
    </Link>
  );

  return (
    <div className="flex min-h-dvh w-full flex-col lg:flex-row">
      {/* ---------------- Desktop sidebar ---------------- */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--vp-border)] bg-ink-900/60 p-4 lg:flex xl:w-72">
        <div className="px-1 pb-5">{brand}</div>
        <div className="flex-1 overflow-y-auto">
          {navList}
          <div className="my-3 h-px bg-[var(--vp-border)]" />
          {secondaryList}
        </div>
        <div className="mt-4 border-t border-[var(--vp-border)] pt-4">
          <p className="px-1 text-[10px] leading-relaxed text-text-muted">
            Your Autonomous AI Chief-of-Staff.
            <br />
            Plan less. Execute more.
          </p>
        </div>
      </aside>

      {/* ---------------- Main column ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--vp-border)] bg-ink-950/92 px-3 py-2.5 backdrop-blur lg:hidden">
          <IconButton label="Open navigation" onClick={() => setDrawerOpen(true)}>
            <Menu aria-hidden className="size-5" />
          </IconButton>
          <div className="min-w-0 flex-1">{brand}</div>
          <IconButton label="Search" onClick={() => setCommandOpen(true)}>
            <Search aria-hidden className="size-5" />
          </IconButton>
          <NotificationBell />
        </header>

        {/* Desktop top bar */}
        <header className="sticky top-0 z-30 hidden items-center gap-3 border-b border-[var(--vp-border)] bg-ink-950/85 px-5 py-3 backdrop-blur lg:flex">
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-control)] border border-[var(--vp-border-strong)] bg-ink-900 px-3 text-left text-sm text-text-muted transition-colors hover:border-violet-accent/40 hover:text-text-secondary"
          >
            <Search aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Search goals, projects, tasks, inbox…</span>
            <kbd className="hidden shrink-0 items-center gap-0.5 rounded border border-[var(--vp-border-strong)] bg-ink-800 px-1.5 py-0.5 text-[10px] font-medium text-text-muted sm:flex">
              <Command aria-hidden className="size-2.5" />K
            </kbd>
          </button>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="primary"
              size="sm"
              onClick={() => router.push('/ai')}
              icon={<Sparkles aria-hidden className="size-3.5" />}
              className="hidden sm:inline-flex"
            >
              Ask VozPilot
            </Button>
            <NotificationBell />
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--vp-border-strong)] bg-ink-800 px-2 py-1.5 text-left transition-colors hover:border-violet-accent/40"
              >
                <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-violet-accent/20 text-[11px] font-semibold text-violet-soft">
                  {initials || 'U'}
                </span>
                <span className="hidden max-w-32 truncate text-xs text-text-secondary xl:block">{user.fullName || user.email}</span>
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-[var(--radius-control)] border border-[var(--vp-border-strong)] bg-ink-850 shadow-[var(--shadow-elevated)]"
                >
                  <div className="border-b border-[var(--vp-border)] px-3 py-2.5">
                    <p className="truncate text-xs font-medium text-text-primary">{user.fullName || 'VozPilot user'}</p>
                    <p className="truncate text-[11px] text-text-muted">{user.email}</p>
                  </div>
                  <Link href="/settings/profile" className="flex items-center gap-2 px-3 py-2.5 text-xs text-text-secondary hover:bg-ink-800 hover:text-text-primary">
                    <Settings aria-hidden className="size-3.5" /> Profile & settings
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      await apiRequest('/api/auth/logout', 'POST');
                      router.push('/login');
                      router.refresh();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-text-secondary hover:bg-ink-800 hover:text-text-primary"
                  >
                    <LogOut aria-hidden className="size-3.5" /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main id="vp-main" className="min-w-0 flex-1 px-3 pb-24 pt-4 sm:px-5 sm:pb-10 lg:px-6 lg:pb-8">
          {children}
        </main>
      </div>

      {/* ---------------- Mobile drawer ---------------- */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70 vp-animate-fade" onClick={() => setDrawerOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="relative z-10 flex h-full w-[min(19rem,88vw)] flex-col border-r border-[var(--vp-border)] bg-ink-900 p-4 vp-animate-in"
          >
            <div className="flex items-center justify-between pb-4">
              {brand}
              <IconButton label="Close navigation" onClick={() => setDrawerOpen(false)}>
                <X aria-hidden className="size-5" />
              </IconButton>
            </div>
            <div className="vp-scroll-area flex-1">
              {navList}
              <div className="my-3 h-px bg-[var(--vp-border)]" />
              {secondaryList}
            </div>
            <div className="border-t border-[var(--vp-border)] pt-3">
              <button
                type="button"
                onClick={async () => {
                  await apiRequest('/api/auth/logout', 'POST');
                  router.push('/login');
                }}
                className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm text-text-secondary hover:bg-ink-800 hover:text-text-primary"
              >
                <LogOut aria-hidden className="size-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------- Mobile bottom nav ---------------- */}
      <nav
        aria-label="Quick navigation"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 gap-1 border-t border-[var(--vp-border)] bg-ink-950/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
      >
        {[
          NAV_ITEMS[0],
          NAV_ITEMS[2],
          NAV_ITEMS[5],
          NAV_ITEMS[6],
          SECONDARY_ITEMS[0],
        ].map((item) => {
          const Icon = item.icon;
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] px-1 py-1.5 text-[10px] transition-colors',
                active ? 'bg-violet-accent/14 text-text-primary' : 'text-text-muted',
              )}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="w-full truncate text-center">{item.label.split(' ')[0]}</span>
            </Link>
          );
        })}
      </nav>

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
    </div>
  );
}

function NotificationBell() {
  const router = useRouter();
  const { data } = useApi<{ notifications: Array<{ id: string; read_at: string | null }> }>('/api/notifications?limit=50');
  const unread = (data?.notifications ?? []).filter((notification) => !notification.read_at).length;

  return (
    <IconButton label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`} onClick={() => router.push('/notifications')} className="relative">
      <Bell aria-hidden className="size-5" />
      {unread > 0 ? (
        <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold leading-4 text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </IconButton>
  );
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 220);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTerm('');
      const timer = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const url = open && debounced.trim().length > 0 ? `/api/search?q=${encodeURIComponent(debounced.trim())}` : null;
  const { data, loading } = useApi<{
    goals: Array<{ id: string; title: string; progress: number }>;
    projects: Array<{ id: string; title: string; status: string }>;
    tasks: Array<{ id: string; title: string; status: string }>;
    inboxItems: Array<{ id: string; subject: string }>;
  }>(url, { enabled: open });

  const hits = useMemo<SearchHit[]>(() => {
    if (!data) return [];
    return [
      ...(data.goals ?? []).map((goal) => ({ id: goal.id, title: goal.title, kind: 'goal' as const, href: `/goals/${goal.id}`, subtitle: `${goal.progress}% complete` })),
      ...(data.projects ?? []).map((project) => ({ id: project.id, title: project.title, kind: 'project' as const, href: `/projects/${project.id}`, subtitle: project.status })),
      ...(data.tasks ?? []).map((task) => ({ id: task.id, title: task.title, kind: 'task' as const, href: '/tasks', subtitle: task.status })),
      ...(data.inboxItems ?? []).map((item) => ({ id: item.id, title: item.subject || 'Inbox item', kind: 'inbox' as const, href: '/inbox' })),
    ];
  }, [data]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-3 pt-[8vh] sm:p-4 sm:pt-[12vh]">
      <div className="absolute inset-0 bg-black/75 vp-animate-fade" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search VozPilot"
        className="relative z-10 flex max-h-[78dvh] w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--vp-border-strong)] bg-ink-900 shadow-[var(--shadow-elevated)] vp-animate-in"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--vp-border)] px-3.5 py-3">
          <Search aria-hidden className="size-4 shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'Enter' && hits[0]) router.push(hits[0].href);
            }}
            placeholder="Search goals, projects, tasks, inbox…"
            aria-label="Search query"
            className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          <kbd className="hidden shrink-0 rounded border border-[var(--vp-border-strong)] bg-ink-800 px-1.5 py-0.5 text-[10px] text-text-muted sm:block">
            ESC
          </kbd>
        </div>

        <div className="vp-scroll-area flex-1 p-2">
          {debounced.trim().length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-text-muted">
              Start typing to search your goals, projects, tasks and inbox.
            </div>
          ) : loading ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-5/6" />
              <Skeleton className="h-9 w-2/3" />
            </div>
          ) : hits.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-text-muted">No matches for “{debounced}”.</div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {hits.map((hit) => (
                <li key={`${hit.kind}-${hit.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      router.push(hit.href);
                      onClose();
                    }}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2.5 text-left transition-colors hover:bg-ink-800"
                  >
                    <Pill tone="neutral" className="shrink-0 capitalize">
                      {hit.kind}
                    </Pill>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text-primary">{hit.title}</span>
                      {hit.subtitle ? <span className="block truncate text-[11px] text-text-muted">{hit.subtitle}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
