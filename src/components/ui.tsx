'use client';

/**
 * VozPilot UI primitives.
 *
 * One place for buttons, inputs, cards, feedback states and overlays so the whole
 * product stays visually consistent and nothing is duplicated per page.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AlertTriangle, Check, Info, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-violet-accent text-white hover:bg-violet-deep active:bg-violet-deep shadow-[0_6px_20px_-10px_rgba(124,92,255,0.9)]',
  secondary: 'bg-ink-700 text-text-primary hover:bg-ink-600 border border-[var(--vp-border-strong)]',
  ghost: 'text-text-secondary hover:text-text-primary hover:bg-ink-800',
  danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25',
  subtle: 'bg-ink-800/70 text-text-secondary hover:text-text-primary border border-[var(--vp-border)]',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-control)] font-medium transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
}

/** Link styled as a button - keeps semantics valid (an <a>, never an <a> in a <button>). */
export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-control)] font-medium transition-colors duration-150',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

export function IconButton({ label, variant = 'ghost', className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------
export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, error, required, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium tracking-wide text-text-secondary uppercase">
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = ({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn('vp-input', className)} {...rest} />
);

export const Textarea = ({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cn('vp-input min-h-24 resize-y leading-relaxed', className)} {...rest} />
);

export const Select = ({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn('vp-input appearance-none pr-8', className)} {...rest}>
    {children}
  </select>
);

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex cursor-pointer items-start justify-between gap-4 py-2.5', disabled && 'cursor-not-allowed opacity-60')}>
      <span className="min-w-0">
        <span className="block text-sm text-text-primary">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-text-muted">{description}</span> : null}
      </span>
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span
          aria-hidden
          className={cn(
            'block h-5 w-9 rounded-full transition-colors duration-150',
            checked ? 'bg-violet-accent' : 'bg-ink-600',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-violet-soft peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ink-950',
          )}
        />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform duration-150',
            checked && 'translate-x-4',
          )}
        />
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------
export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('vp-card p-4 sm:p-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-wide text-text-primary">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status / priority pills
// ---------------------------------------------------------------------------
const TONE_STYLES: Record<string, string> = {
  neutral: 'bg-ink-700 text-text-secondary border-[var(--vp-border-strong)]',
  violet: 'bg-violet-accent/15 text-violet-soft border-violet-accent/30',
  gold: 'bg-gold-accent/15 text-gold-soft border-gold-accent/30',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
  info: 'bg-info/15 text-info border-info/30',
};

export function Pill({
  tone = 'neutral',
  children,
  className,
  icon,
}: {
  tone?: keyof typeof TONE_STYLES;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        TONE_STYLES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export const PRIORITY_TONE: Record<string, keyof typeof TONE_STYLES> = {
  critical: 'danger',
  high: 'warning',
  medium: 'violet',
  low: 'neutral',
};

export const STATUS_TONE: Record<string, keyof typeof TONE_STYLES> = {
  inbox: 'neutral',
  todo: 'info',
  in_progress: 'violet',
  blocked: 'danger',
  completed: 'success',
  cancelled: 'neutral',
  planning: 'info',
  active: 'violet',
  at_risk: 'warning',
  archived: 'neutral',
  paused: 'neutral',
  pending: 'neutral',
  missed: 'danger',
  draft: 'neutral',
};

export const STATUS_LABEL: Record<string, string> = {
  inbox: 'Inbox',
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  completed: 'Completed',
  cancelled: 'Cancelled',
  planning: 'Planning',
  active: 'Active',
  at_risk: 'At risk',
  archived: 'Archived',
  paused: 'Paused',
  pending: 'Pending',
  missed: 'Missed',
  draft: 'Draft',
};

export function ProgressBar({
  value,
  tone = 'violet',
  label,
  className,
  showValue = true,
}: {
  value: number;
  tone?: 'violet' | 'success' | 'warning' | 'danger' | 'gold';
  label?: string;
  className?: string;
  showValue?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const barTone = {
    violet: 'bg-violet-accent',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    gold: 'bg-gold-accent',
  }[tone];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
        className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700"
      >
        <div className={cn('h-full rounded-full transition-[width] duration-500', barTone)} style={{ width: `${clamped}%` }} />
      </div>
      {showValue ? <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-text-secondary">{clamped}%</span> : null}
    </div>
  );
}

export function HealthMeter({ score, className }: { score: number; className?: string }) {
  const tone = score >= 85 ? 'success' : score >= 70 ? 'violet' : score >= 50 ? 'warning' : 'danger';
  return <ProgressBar value={score} tone={tone} label="Health score" className={className} />;
}

// ---------------------------------------------------------------------------
// Feedback states
// ---------------------------------------------------------------------------
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('vp-skeleton', className)} />;
}

export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="vp-card p-4">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="mt-3 h-3 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('vp-card flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {icon ? <div className="mb-3 text-text-muted">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-text-muted">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong.',
  description = 'Please try again. Your data is safe.',
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('vp-card flex flex-col items-center justify-center px-6 py-8 text-center', className)} role="alert">
      <AlertTriangle aria-hidden className="mb-3 size-5 text-warning" />
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-text-muted">{description}</p>
      {onRetry ? (
        <Button className="mt-4" size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const mounted = useMounted();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 vp-animate-fade" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'vp-card relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-b-none sm:rounded-[var(--radius-card)] vp-animate-in',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--vp-border)] p-4 sm:p-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-text-primary">
              {title}
            </h2>
            {description ? <p className="mt-1 text-xs text-text-muted">{description}</p> : null}
          </div>
          <IconButton label="Close dialog" onClick={onClose} className="-mr-1 -mt-1">
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
        <div className="vp-scroll-area flex-1 p-4 sm:p-5">{children}</div>
        {footer ? <div className="border-t border-[var(--vp-border)] p-4 sm:px-5">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const mounted = useMounted();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/70 vp-animate-fade" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-[var(--vp-border)] bg-ink-900 vp-animate-in"
      >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--vp-border)] p-4">
          <h2 id={titleId} className="truncate text-sm font-semibold text-text-primary">
            {title}
          </h2>
          <IconButton label="Close panel" onClick={onClose}>
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
        <div className="vp-scroll-area flex-1 p-4">{children}</div>
        {footer ? <div className="border-t border-[var(--vp-border)] p-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
interface Toast {
  id: string;
  message: string;
  tone: 'success' | 'error' | 'info';
}

interface ToastContextValue {
  toast: (message: string, tone?: Toast['tone']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mounted = useMounted();
  const counter = useRef(0);

  const toast = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    counter.current += 1;
    const id = `toast-${counter.current}`;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), 4200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted
        ? createPortal(
            <div
              aria-live="polite"
              aria-atomic="false"
              className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
            >
              {toasts.map((entry) => (
                <div
                  key={entry.id}
                  role="status"
                  className={cn(
                    'pointer-events-auto flex max-w-md items-center gap-2 rounded-[var(--radius-control)] border px-3.5 py-2.5 text-sm shadow-[var(--shadow-elevated)] vp-animate-in',
                    entry.tone === 'success' && 'border-success/30 bg-success/12 text-success',
                    entry.tone === 'error' && 'border-danger/30 bg-danger/12 text-danger',
                    entry.tone === 'info' && 'border-violet-accent/30 bg-violet-accent/12 text-violet-soft',
                  )}
                >
                  {entry.tone === 'success' ? (
                    <Check aria-hidden className="size-4 shrink-0" />
                  ) : entry.tone === 'error' ? (
                    <AlertTriangle aria-hidden className="size-4 shrink-0" />
                  ) : (
                    <Info aria-hidden className="size-4 shrink-0" />
                  )}
                  <span className="min-w-0 break-words">{entry.message}</span>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
