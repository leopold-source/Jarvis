import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const EUR_COMPACT = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatMoney(value: number | null | undefined, compact = false) {
  if (value == null) return "—";
  return compact ? EUR_COMPACT.format(value) : EUR.format(value);
}

export function formatDate(value: string | null | undefined, style: "short" | "long" = "short") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(
    "fr-FR",
    style === "long"
      ? { day: "numeric", month: "long", year: "numeric" }
      : { day: "2-digit", month: "2-digit", year: "numeric" },
  );
}

/** « il y a 3 jours », « dans 2 semaines »… en s'appuyant sur Intl. */
export function formatRelative(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = date.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

  if (Math.abs(diffDays) < 1) {
    const diffHours = Math.round(diffMs / 3_600_000);
    if (Math.abs(diffHours) < 1) return rtf.format(Math.round(diffMs / 60_000), "minute");
    return rtf.format(diffHours, "hour");
  }
  if (Math.abs(diffDays) < 31) return rtf.format(diffDays, "day");
  if (Math.abs(diffDays) < 365) return rtf.format(Math.round(diffDays / 30), "month");
  return rtf.format(Math.round(diffDays / 365), "year");
}

/** Nombre de jours (positif = à venir) entre aujourd'hui et une date ISO. */
export function daysUntil(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

export function initials(name: string | null | undefined, fallback = "?") {
  if (!name?.trim()) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]!.toUpperCase()).join("");
}

/** Couleur d'avatar stable, dérivée d'une chaîne (id ou email). */
export function avatarGradient(seed: string) {
  const palettes = [
    "from-indigo-500 to-violet-500",
    "from-cyan-500 to-blue-500",
    "from-fuchsia-500 to-pink-500",
    "from-emerald-500 to-teal-500",
    "from-amber-500 to-orange-500",
    "from-sky-500 to-indigo-500",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palettes[hash % palettes.length];
}

/**
 * Position fractionnaire entre deux cartes, pour réordonner par glisser-déposer
 * sans réécrire toute la colonne.
 */
export function positionBetween(before: number | null, after: number | null) {
  if (before == null && after == null) return 1000;
  if (before == null) return after! - 100;
  if (after == null) return before + 100;
  return (before + after) / 2;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count > 1 ? plural : singular}`;
}

/** Retire les accents et la casse, pour une recherche « souple » côté client. */
export function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
