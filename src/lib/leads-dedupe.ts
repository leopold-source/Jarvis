import { normalize } from "@/lib/utils";

/**
 * Détection de doublons à l'import de leads.
 *
 * Trois verdicts, dans l'ordre de gravité :
 *
 * - `doublon` — la personne est déjà en base (même e-mail, ou même nom dans la
 *   même entreprise). La ligne n'est pas importée.
 * - `entreprise_connue` — l'entreprise est déjà en relation (elle a un lead, une
 *   fiche entreprise ou une affaire) mais cette personne-là est inconnue. La
 *   ligne est importée et signalée en vert : c'est un second interlocuteur chez
 *   un compte qu'on travaille déjà.
 * - `nouveau` — rien de connu.
 *
 * La comparaison est volontairement tolérante : accents, casse, ponctuation et
 * formes juridiques (SAS, SARL…) sont neutralisés, et l'ordre prénom/nom
 * n'importe pas.
 */

export type DedupeVerdict = "doublon" | "entreprise_connue" | "nouveau";

/** Formes juridiques et mots vides retirés du nom d'entreprise. */
const LEGAL_FORMS = new Set([
  "sa", "sas", "sasu", "sarl", "eurl", "sci", "scop", "snc", "scp", "selarl",
  "gie", "eirl", "ei", "association", "groupe", "cabinet", "societe", "ste",
  "et", "de", "du", "des", "la", "le", "les", "l", "d",
]);

/** Clé d'entreprise : « Ecotechnics SARL » et « ECOTECHNICS » se rejoignent. */
export function companyKey(name: string | null | undefined): string {
  if (!name?.trim()) return "";
  const tokens = normalize(name)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token && !LEGAL_FORMS.has(token));
  return tokens.join(" ");
}

/** Clé de personne, insensible à l'ordre : « Jean Dupont » = « Dupont Jean ». */
export function personKey(
  first: string | null | undefined,
  last: string | null | undefined,
  full: string | null | undefined,
): string {
  const source = [first, last].filter(Boolean).join(" ") || full || "";
  const tokens = normalize(source)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .sort();
  return tokens.join(" ");
}

export function emailKey(email: string | null | undefined): string {
  return email?.trim() ? normalize(email) : "";
}

/** Index de l'existant, construit côté serveur et envoyé au navigateur. */
export interface ImportIndex {
  /** E-mails déjà connus, toutes tables confondues. */
  emails: string[];
  /** Couples « personne @ entreprise » déjà connus. */
  people: string[];
  /** Entreprises ayant au moins un lead. */
  companiesFromLeads: string[];
  /** Entreprises ayant une fiche ou une affaire — donc déjà travaillées. */
  companiesInPipeline: string[];
}

export interface DedupeResult {
  verdict: DedupeVerdict;
  /** Explication courte, affichée dans l'aperçu d'import. */
  reason: string;
}

/** Prépare des ensembles à partir de l'index sérialisé. */
export function buildLookup(index: ImportIndex) {
  return {
    emails: new Set(index.emails),
    people: new Set(index.people),
    companiesFromLeads: new Set(index.companiesFromLeads),
    companiesInPipeline: new Set(index.companiesInPipeline),
  };
}

export type Lookup = ReturnType<typeof buildLookup>;

/**
 * Classe une ligne de CSV. `seen` accumule les clés des lignes déjà traitées du
 * même fichier, ce qui attrape aussi les doublons internes à l'import.
 */
export function classifyRow(
  row: { first_name?: unknown; last_name?: unknown; full_name?: unknown; email?: unknown; company_name?: unknown },
  lookup: Lookup,
  seen: { emails: Set<string>; people: Set<string> },
): DedupeResult {
  const asText = (value: unknown) => (typeof value === "string" ? value : null);

  const email = emailKey(asText(row.email));
  const person = personKey(asText(row.first_name), asText(row.last_name), asText(row.full_name));
  const company = companyKey(asText(row.company_name));
  const pair = `${person}@${company}`;

  if (email && seen.emails.has(email)) {
    return { verdict: "doublon", reason: "En double dans ce fichier" };
  }
  if (person && seen.people.has(pair)) {
    return { verdict: "doublon", reason: "En double dans ce fichier" };
  }

  if (email) seen.emails.add(email);
  if (person) seen.people.add(pair);

  if (email && lookup.emails.has(email)) {
    return { verdict: "doublon", reason: "E-mail déjà en base" };
  }
  if (person && company && lookup.people.has(pair)) {
    return { verdict: "doublon", reason: "Déjà en base chez cette entreprise" };
  }

  if (company && lookup.companiesInPipeline.has(company)) {
    return { verdict: "entreprise_connue", reason: "Entreprise déjà en affaire — nouveau contact" };
  }
  if (company && lookup.companiesFromLeads.has(company)) {
    return { verdict: "entreprise_connue", reason: "Entreprise déjà en lead — nouveau contact" };
  }

  return { verdict: "nouveau", reason: "Nouveau" };
}

export const VERDICT_STYLE: Record<
  DedupeVerdict,
  { label: string; tone: "emerald" | "rose" | "stone"; row: string }
> = {
  nouveau: { label: "Nouveau", tone: "stone", row: "" },
  entreprise_connue: {
    label: "Entreprise connue",
    tone: "emerald",
    row: "bg-emerald-500/10",
  },
  doublon: { label: "Doublon", tone: "rose", row: "bg-rose-500/10 opacity-60" },
};
