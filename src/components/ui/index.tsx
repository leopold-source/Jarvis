"use client";

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";

import { TONE_CLASSES, type Tone } from "@/lib/constants";
import { avatarGradient, cn, initials } from "@/lib/utils";

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // Le dégradé est doublé d'un halo au survol : discret mais vivant.
  primary:
    "text-white bg-linear-to-r from-brand-600 to-brand-500 shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset] " +
    "hover:from-brand-500 hover:to-accent-500 hover:shadow-[0_0_24px_-6px_var(--glow-brand)]",
  secondary:
    "bg-[var(--surface-raised)] text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)] " +
    "hover:bg-[var(--surface-hover)] hover:ring-[var(--border-strong)]",
  ghost: "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
  subtle: "bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
  danger: "bg-rose-500/90 text-white hover:bg-rose-500",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9.5 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-[15px] gap-2",
  icon: "size-9 justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center rounded-[10px] font-medium whitespace-nowrap select-none",
        "transition-all duration-200 active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------- Badge */

export function Badge({
  tone = "stone",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium",
        "whitespace-nowrap ring-1 ring-inset",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({
  className,
  children,
  interactive,
  glow,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean; glow?: boolean }) {
  return (
    <div
      className={cn("card", interactive && "card-interactive", glow && "edge-glow", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ Inputs */

const FIELD_BASE =
  "w-full rounded-[10px] bg-[var(--surface-input)] px-3 text-sm text-[var(--text-primary)] " +
  "ring-1 ring-[var(--border-subtle)] transition-all duration-150 outline-none " +
  "placeholder:text-[var(--text-muted)] " +
  "focus:ring-2 focus:ring-brand-500/70 focus:shadow-[0_0_0_4px_var(--glow-brand)] " +
  "disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(FIELD_BASE, "h-9.5", className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(FIELD_BASE, "py-2 leading-relaxed", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(FIELD_BASE, "h-9.5 appearance-none pr-9", className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
          aria-hidden
        />
      </div>
    );
  },
);

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  // Le champ est imbriqué dans le <label> : l'association est implicite, pas
  // besoin de propager un id à chaque appelant.
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[12.5px] font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[11.5px] text-[var(--text-muted)]">{hint}</span> : null}
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Rechercher…",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-9"
        aria-label={placeholder}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Effacer la recherche"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Avatar */

export function Avatar({
  name,
  email,
  size = 32,
  className,
}: {
  name?: string | null;
  email?: string | null;
  size?: number;
  className?: string;
}) {
  const seed = email ?? name ?? "?";
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        "bg-linear-to-br ring-1 ring-white/10",
        avatarGradient(seed),
        className,
      )}
      title={name ?? email ?? undefined}
    >
      {initials(name ?? email)}
    </span>
  );
}

/* ------------------------------------------------------------------- Modal */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div
        className="fixed inset-0 bg-black/55 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 my-8 w-full animate-pop rounded-2xl",
          "border border-[var(--border-strong)] bg-[var(--surface-overlay)] shadow-[var(--shadow-pop)]",
          widths[size],
        )}
      >
        <div className="edge-glow flex items-start justify-between gap-4 rounded-t-2xl border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{description}</p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <X className="size-4" />
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ Drawer */

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        style={{ animation: "fade-up 0.28s cubic-bezier(0.22,1,0.36,1) both" }}
        className={cn(
          "relative z-10 flex h-full w-full max-w-xl flex-col",
          "border-l border-[var(--border-strong)] bg-[var(--surface-overlay)] shadow-[var(--shadow-pop)]",
        )}
      >
        <header className="edge-glow flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 truncate text-[13px] text-[var(--text-muted)]">{subtitle}</p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <X className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3.5">
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ Toasts */

type Toast = { id: number; message: string; tone: "success" | "error" | "info" };

const ToastContext = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto animate-fade-up rounded-xl px-4 py-3 text-sm shadow-[var(--shadow-pop)]",
              "border border-[var(--border-strong)] bg-[var(--surface-overlay)] backdrop-blur",
              "flex items-start gap-2.5",
            )}
          >
            <span
              className={cn(
                "mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full",
                toast.tone === "success" && "bg-emerald-500/20 text-emerald-400",
                toast.tone === "error" && "bg-rose-500/20 text-rose-400",
                toast.tone === "info" && "bg-brand-500/20 text-brand-300",
              )}
            >
              {toast.tone === "error" ? <X className="size-3" /> : <Check className="size-3" />}
            </span>
            <span className="text-[var(--text-primary)]">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------- États et squelettes */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon ? (
        <div className="grid size-12 place-items-center rounded-2xl bg-linear-to-br from-brand-500/15 to-accent-500/10 text-brand-400 ring-1 ring-[var(--border-subtle)]">
          {icon}
        </div>
      ) : null}
      <p className="text-[15px] font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-[13px] text-[var(--text-muted)]">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-11 w-full" />
      ))}
    </div>
  );
}

/** Barre de progression avec dégradé — utilisée pour l'avancement projet. */
export function ProgressBar({
  value,
  className,
  tone = "brand",
}: {
  value: number;
  className?: string;
  tone?: "brand" | "emerald" | "amber";
}) {
  const gradients = {
    brand: "from-brand-500 to-accent-400",
    emerald: "from-emerald-500 to-teal-400",
    amber: "from-amber-500 to-orange-400",
  };
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]", className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full bg-linear-to-r transition-[width] duration-700 ease-out", gradients[tone])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
