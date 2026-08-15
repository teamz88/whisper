import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { bridge } from '../lib/bridge.js';
import { cn } from '../lib/cn.js';

/**
 * The shared primitives. Everything visual in the dashboard is built from
 * these, so a spacing or radius decision is made once here rather than
 * re-litigated in every page.
 */

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong active:bg-accent-strong disabled:bg-accent/50',
  secondary: 'bg-raised text-ink border border-line hover:border-ink-faint hover:bg-card',
  ghost: 'bg-transparent text-ink-soft hover:bg-line-soft hover:text-ink',
  danger: 'bg-danger-soft text-danger border border-danger/25 hover:bg-danger hover:text-white',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-lg',
  md: 'h-10 px-4 text-sm rounded-xl',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      className={cn(
        'no-drag inline-flex items-center justify-center gap-2 font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }): ReactNode {
  return (
    <span
      className={cn(
        'animate-spin-arc inline-block rounded-full border-2 border-current border-t-transparent',
        className ?? 'size-4',
      )}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// Card + section scaffolding
// ---------------------------------------------------------------------------

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className={cn('rounded-2xl border border-line bg-card', className)}>{children}</div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }): ReactNode {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
      {children}
    </h2>
  );
}

/** One labelled row inside a settings card. */
export function SettingRow({
  label,
  hint,
  control,
  className,
}: {
  label: string;
  hint?: ReactNode;
  control: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-6 border-b border-line-soft px-5 py-4 last:border-b-0',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        {hint === undefined ? null : (
          <div className="mt-0.5 text-[13px] leading-snug text-ink-faint">{hint}</div>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Toggle({ checked, onChange, disabled = false, label }: ToggleProps): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'no-drag relative h-6 w-11 shrink-0 rounded-full transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        checked ? 'bg-accent' : 'bg-line',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
}

export function TextField({ label, error, className, id, ...rest }: TextFieldProps): ReactNode {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className="w-full">
      {label === undefined ? null : (
        <label htmlFor={fieldId} className="mb-1.5 block text-[13px] font-medium text-ink-soft">
          {label}
        </label>
      )}
      <input
        id={fieldId}
        className={cn(
          'no-drag h-10 w-full rounded-xl border bg-raised px-3.5 text-sm text-ink',
          'placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/40',
          error === null || error === undefined ? 'border-line focus:border-accent' : 'border-danger',
          'disabled:cursor-not-allowed disabled:bg-card disabled:text-ink-faint',
          className,
        )}
        {...rest}
      />
      {error === null || error === undefined || error === '' ? null : (
        <p className="mt-1.5 text-[13px] text-danger">{error}</p>
      )}
    </div>
  );
}

export function TextArea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  return (
    <textarea
      className={cn(
        'no-drag w-full rounded-xl border border-line bg-raised px-3.5 py-2.5 text-sm text-ink',
        'placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40',
        className,
      )}
      {...rest}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}

export function Select({ options, onChange, className, ...rest }: SelectProps): ReactNode {
  return (
    <select
      className={cn(
        'no-drag h-9 min-w-44 rounded-lg border border-line bg-raised px-3 text-sm text-ink',
        'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40',
        className,
      )}
      onChange={(event) => onChange(event.target.value)}
      {...rest}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.hint === undefined ? option.label : `${option.label} — ${option.hint}`}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Pills and chips
// ---------------------------------------------------------------------------

export function Pill({
  active = false,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }): ReactNode {
  return (
    <button
      type="button"
      className={cn(
        'no-drag h-7 rounded-full px-3 text-[13px] font-medium transition-colors',
        active
          ? 'bg-accent text-white'
          : 'bg-transparent text-ink-soft hover:bg-line-soft hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Read-only metadata chip: word count, style, duration. */
export function Chip({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full bg-line-soft px-2 text-[11px] font-medium text-ink-faint',
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export interface ModalProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: ModalProps): ReactNode {
  const panelRef = useRef<HTMLDivElement>(null);

  // Callers pass inline arrows for onClose, whose identity changes on every
  // parent render. If this effect depended on it, EVERY keystroke inside the
  // modal (parent state update → new onClose → effect re-run) would call
  // focus() again and yank the caret out of the input — the "type one letter,
  // click the box again" bug. The ref keeps the effect keyed on `open` alone.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current();
    };

    window.addEventListener('keydown', onKeyDown);
    // Land focus where the user will type: the first field if there is one,
    // the panel (for Escape handling) otherwise. Runs once per open.
    const firstField = panelRef.current?.querySelector<HTMLElement>('input, textarea, select');
    (firstField ?? panelRef.current)?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-fade-in w-full max-w-md rounded-2xl border border-line bg-raised p-6 shadow-xl focus:outline-none"
      >
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description === undefined ? null : (
          <div className="mt-2 text-sm leading-relaxed text-ink-soft">{description}</div>
        )}
        {children === undefined ? null : <div className="mt-4">{children}</div>}
        {footer === undefined ? null : <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-ink-faint">{body}</p>
    </div>
  );
}

/**
 * "Copy" buttons that acknowledge themselves for a moment. Writing through the
 * main process rather than navigator.clipboard: renderer clipboard access is
 * deprecated in current Electron, and main already owns the clipboard for
 * paste-and-restore.
 */
export function useCopyFeedback(ms = 1400): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = (text: string): void => {
    void bridge.invoke('clipboard:write', { text }).then(() => {
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), ms);
    });
  };

  return [copied, copy];
}
