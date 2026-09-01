"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

import { cn, daysUntil } from "@/lib/utils";

/**
 * Sélecteur de date maison.
 *
 * Le calendrier natif du navigateur ne suit ni le thème ni la langue et se
 * présente différemment sur chaque plateforme. Celui-ci est un simple popover :
 * semaine commençant le lundi, jour courant marqué, raccourcis de relance, et
 * une pastille de retard quand la date est passée.
 */

const DAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function toIso(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function parseIso(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

/** Lundi = 0, dimanche = 6. */
function mondayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

export function DateField({
  value,
  onChange,
  placeholder = "Aucune date",
  className,
  align = "left",
  disabled,
  dense,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
  align?: "left" | "right";
  disabled?: boolean;
  /** Déclencheur ramassé, pour les tableaux à forte densité. */
  dense?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => parseIso(value), [value]);
  const [cursor, setCursor] = useState(() => selected ?? new Date());

  useEffect(() => {
    if (open) setCursor(selected ?? new Date());
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const today = new Date();
  const todayIso = toIso(today);
  const remaining = daysUntil(value);
  const late = remaining != null && remaining < 0;
  const isToday = value === todayIso;

  // Grille du mois : on complète la première semaine avec les jours du mois
  // précédent pour que les colonnes restent alignées.
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - mondayIndex(first));
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [cursor]);

  function pick(date: Date) {
    onChange(toIso(date));
    setOpen(false);
  }

  function shift(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    onChange(toIso(date));
    setOpen(false);
  }

  const label = selected
    ? selected.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" })
    : placeholder;

  return (
    <div className={cn("relative inline-block", className)} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "group inline-flex w-full items-center gap-1.5 rounded-lg transition-all",
          dense ? "h-6 px-1.5 text-[12px]" : "h-8 px-2 text-[12.5px]",
          "ring-1 ring-transparent hover:bg-[var(--surface-hover)]",
          open && "bg-[var(--surface-input)] ring-brand-500/70",
          !value && "text-[var(--text-muted)]",
          late && "text-rose-500",
          isToday && "text-brand-500 dark:text-brand-300",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <CalendarDays
          className={cn(
            "size-3.5 shrink-0",
            value ? "opacity-70" : "opacity-40 group-hover:opacity-70",
          )}
        />
        <span className="truncate tabular-nums">{label}</span>
        {late ? (
          <span className="ml-auto shrink-0 rounded-full bg-rose-500/15 px-1.5 text-[10px] font-medium text-rose-500">
            J{remaining}
          </span>
        ) : null}
        {value && !late ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Retirer la date"
            onClick={(event) => {
              event.stopPropagation();
              onChange(null);
            }}
            className="ml-auto shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-60"
          >
            <X className="size-3" />
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          className={cn(
            "absolute z-50 mt-1.5 w-64 animate-pop rounded-xl p-2.5",
            "border border-[var(--border-strong)] bg-[var(--surface-overlay)] shadow-[var(--shadow-pop)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              aria-label="Mois précédent"
              className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-[12.5px] font-medium">
              {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              aria-label="Mois suivant"
              className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {DAY_LABELS.map((day, index) => (
              <span key={index} className="py-1 text-[10px] font-medium text-[var(--text-muted)]">
                {day}
              </span>
            ))}

            {cells.map((date) => {
              const iso = toIso(date);
              const outside = date.getMonth() !== cursor.getMonth();
              const isSelected = iso === value;
              const isNow = iso === todayIso;

              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => pick(date)}
                  className={cn(
                    "relative aspect-square rounded-md text-[12px] tabular-nums transition-colors",
                    outside && "text-[var(--text-muted)]/50",
                    !isSelected && "hover:bg-[var(--surface-hover)]",
                    isSelected &&
                      "bg-linear-to-br from-brand-500 to-brand-600 font-semibold text-white shadow-[0_0_14px_-4px_var(--glow-brand)]",
                    isNow && !isSelected && "font-semibold text-brand-500 dark:text-brand-300",
                  )}
                >
                  {date.getDate()}
                  {isNow && !isSelected ? (
                    <span className="absolute inset-x-0 bottom-0.5 mx-auto size-1 rounded-full bg-brand-500" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex flex-wrap gap-1 border-t border-[var(--border-subtle)] pt-2">
            {[
              { label: "Aujourd'hui", days: 0 },
              { label: "+3 j", days: 3 },
              { label: "+1 sem.", days: 7 },
              { label: "+1 mois", days: 30 },
            ].map((shortcut) => (
              <button
                key={shortcut.label}
                type="button"
                onClick={() => shift(shortcut.days)}
                className="rounded-md bg-[var(--surface-hover)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-brand-500/15 hover:text-brand-500 dark:hover:text-brand-300"
              >
                {shortcut.label}
              </button>
            ))}
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="ml-auto rounded-md px-2 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-rose-500"
              >
                Effacer
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
