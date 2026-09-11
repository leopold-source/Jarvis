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

/*
  La forme abrégée est calculée ici, pas déléguée à `Intl`.

  `notation: "compact"` ne donne pas le même résultat partout : la version
  d'ICU embarquée dans Node rendait « 4 M € » là où Chromium écrivait
  « 4,0 M € ». Sur une table de leads, chaque montant devenait alors une
  différence entre le HTML envoyé et celui que le navigateur recalculait —
  l'hydratation échouait, et React reconstruisait toute la page côté client.

  La règle tient en trois lignes et ne dépend d'aucune bibliothèque de
  données : une décimale tant qu'elle apprend quelque chose, aucune au-delà de
  dix, et la virgule française.
*/
const PALIERS = [
  { seuil: 1e9, suffixe: " Md" },
  { seuil: 1e6, suffixe: " M" },
  { seuil: 1e3, suffixe: " k" },
] as const;

export function formatMoney(value: number | null | undefined, compact = false) {
  if (value == null) return "—";
  if (!compact) return EUR.format(value);

  const absolu = Math.abs(value);
  const palier = PALIERS.find((entree) => absolu >= entree.seuil);
  if (!palier) return EUR.format(value);

  // Une décimale sous dix — « 4,3 M » dit quelque chose que « 4 M » tait ;
  // au-delà, « 128,4 k » n'ajoute qu'un chiffre de bruit.
  const abrege = (seuil: number) => {
    const reduit = value / seuil;
    return Math.abs(reduit) < 10 ? Math.round(reduit * 10) / 10 : Math.round(reduit);
  };

  /*
    L'arrondi peut franchir le palier qui vient de le choisir : 999 999 est
    bien en dessous du million, mais s'écrit « 1000 k » une fois arrondi. On
    remonte alors d'un cran, et « 1 M € » redevient ce qu'on attendait.
  */
  let retenu = palier;
  let arrondi = abrege(palier.seuil);
  const superieur = PALIERS[PALIERS.indexOf(palier) - 1];
  if (Math.abs(arrondi) >= 1000 && superieur) {
    retenu = superieur;
    arrondi = abrege(superieur.seuil);
  }

  return `${String(arrondi).replace(".", ",")}${retenu.suffixe} €`;
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

/*
  Le jour courant, à Paris, et nulle part ailleurs.

  `new Date().setHours(0,0,0,0)` prend le fuseau de la machine qui exécute —
  UTC sur le serveur, Europe/Paris sur le téléphone. Deux heures par jour, les
  deux ne tombaient pas sur la même date, et React rendait alors un « J-1 » que
  le serveur n'avait pas écrit : l'hydratation échouait et l'arbre entier était
  reconstruit côté client, à chaque chargement, en fin de journée.

  Ancrer le calcul sur Paris règle les deux problèmes d'un coup. Le rendu
  redevient identique des deux côtés, et la date est celle que Léopold a sous
  les yeux — une relance « pour aujourd'hui » à vingt-trois heures reste pour
  aujourd'hui, quelle que soit la région où tourne le serveur.
*/
const JOUR_PARIS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** La date du jour à Paris, au format `AAAA-MM-JJ`. */
export function todayIso(): string {
  return JOUR_PARIS.format(new Date());
}

/** La date parisienne d'un instant, au format `AAAA-MM-JJ`. */
function jourDe(value: string): string | null {
  // Une date nue est déjà un jour : la repasser par le fuseau la décalerait.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return JOUR_PARIS.format(instant);
}

/** Nombre de jours (positif = à venir) entre aujourd'hui et une date ISO. */
export function daysUntil(value: string | null | undefined) {
  if (!value) return null;
  const jour = jourDe(value);
  if (!jour) return null;
  // Les deux bornes sont lues à midi UTC : aucun passage à l'heure d'été ne
  // peut alors rogner ou ajouter un jour au quotient.
  const cible = Date.parse(`${jour}T12:00:00Z`);
  const aujourdhui = Date.parse(`${todayIso()}T12:00:00Z`);
  return Math.round((cible - aujourdhui) / 86_400_000);
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
