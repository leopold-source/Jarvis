import { LEAD_STATUS } from "@/lib/constants";
import type { LeadStatus } from "@/lib/database.types";
import { regionFromAddress } from "@/lib/french-regions";

/**
 * Lecture d'un export CSV de leads, côté navigateur.
 *
 * Deux formats coexistent et n'ont presque aucun en-tête en commun :
 *
 * - la table de prospection interne (« Entreprise », « Tél », « Relance ») ;
 * - un export d'outil de sourcing type Pharow, où l'entreprise s'appelle « Nom
 *   commercial », le téléphone « Tél portable », et où « Date de création »
 *   désigne la fondation de la société, pas la création de la fiche.
 *
 * Ce dernier point est la raison d'être des profils : le même intitulé n'y veut
 * pas dire la même chose. Un seul dictionnaire aurait daté toutes les fiches de
 * l'année de fondation de l'entreprise, silencieusement.
 */

/** Correspondances communes aux deux formats. */
const COLUMN_MAP: Record<string, string> = {
  name: "full_name",
  "nom complet": "full_name",
  prénom: "first_name",
  prenom: "first_name",
  nom: "last_name",
  "e-mail": "email",
  email: "email",
  mail: "email",
  tél: "phone",
  tel: "phone",
  téléphone: "phone",
  telephone: "phone",
  "tél portable": "phone",
  "tel portable": "phone",
  portable: "phone",
  mobile: "phone",
  "tél standard": "phone_standard",
  "tel standard": "phone_standard",
  standard: "phone_standard",
  entreprise: "company_name",
  société: "company_name",
  societe: "company_name",
  "nom commercial": "company_name",
  "nom légal": "company_legal_name",
  "raison sociale": "company_legal_name",
  "site entreprise": "company_website",
  "url du site internet": "company_website",
  "site internet": "company_website",
  "poste occupé": "job_title",
  poste: "job_title",
  fonction: "job_title",
  activité: "company_activity",
  activite: "company_activity",
  "activité source pharow": "company_activity",
  secteur: "sector",
  "secteur naf": "sector",
  région: "region",
  region: "region",
  adresse: "address",
  "adresse du siège complète": "address",
  "adresse du siège": "address",
  "url linkedin": "linkedin_url",
  "url linkedin du prospect": "linkedin_url",
  linkedin: "linkedin_url",
  "url de la page linkedin": "company_linkedin_url",
  "description issue du site internet": "company_description",
  siren: "siren",
  "siret du siège": "siret",
  siret: "siret",
  "effectif réel": "headcount",
  effectif: "headcount",
  "tranche d'effectif corrigée": "headcount_range",
  "tranche d'effectif": "headcount_range",
  "valeur ca": "revenue",
  ca: "revenue",
  "chiffre d'affaires en euros": "revenue",
  "chiffre d'affaires": "revenue",
  "année du chiffre d'affaires": "revenue_year",
  "année de création": "founded_year",
  "type d'email": "email_quality",
  statut: "status",
  owner: "owner_name",
  commentaire: "comment",
  relance: "follow_up_on",
  fullname: "segment",
  campagne: "segment",
  segment: "segment",
  "nom de la liste pharow": "segment",
};

/**
 * Ce qui change quand le fichier vient d'un outil de sourcing.
 *
 * « Date de création » y est la fondation de l'entreprise. Le laisser tomber
 * dans `created_at` daterait la fiche de 2007.
 */
const PHAROW_OVERRIDES: Record<string, string> = {
  "date de création": "founded_year",
  "date de creation": "founded_year",
};

const INTERNE_OVERRIDES: Record<string, string> = {
  "date de création": "created_at",
  "date de creation": "created_at",
};

/** En-têtes qui ne laissent aucun doute sur l'origine du fichier. */
const PHAROW_MARKERS = [
  "nom de la liste pharow",
  "activite source pharow",
  "tranche d'effectif corrigee",
  "siret du siege",
];

/**
 * Colonnes volontairement laissées de côté, avec la raison.
 *
 * Les distinguer des colonnes réellement inconnues évite de faire douter :
 * voir « ID personne Hubspot » dans la liste des champs non lus laisse penser
 * qu'on a raté quelque chose.
 */
const IGNORED_COLUMNS: Record<string, string> = {
  "id personne hubspot": "identifiant d'un autre CRM",
  "id personne pipedrive": "identifiant d'un autre CRM",
  "id entreprise hubspot": "identifiant d'un autre CRM",
  "id entreprise pipedrive": "identifiant d'un autre CRM",
  "email générique": "adresse de contact générique, pas celle du prospect",
  "tél standard origine": "provenance du numéro",
  "fiabilité de l'email": "repris par le champ « type d'email »",
  "nom de la page linkedin": "doublon de l'URL LinkedIn entreprise",
  "en croissance": "indicateur non exploité",
  civilité: "non conservée : elle ne change rien à la façon d'appeler",
};

/*
  Le vocabulaire réel, ramené aux neuf statuts de l'application.

  Il y a vingt-deux libellés dans les exports, et neuf statuts ici. Ce n'est
  pas un accident à corriger : neuf tiennent dans une tête et dans un filtre,
  vingt-deux non. Mais la traduction se paie — « Numéro pas bon » et « Déjà
  accompagné » finissent tous deux « Non qualifié » — alors le libellé
  d'origine est reporté dans le commentaire de la fiche. Rien de ce qui a été
  observé au téléphone ne disparaît ; seul le tri s'en trouve simplifié.

  Ce qui manque à cette table est plus grave que ce qui s'y trouve mal : un
  libellé inconnu retombait sur « À contacter », sans un mot. Cinq cent
  soixante-dix-huit fiches déjà travaillées sont ainsi revenues à appeler.
  L'import les compte et les nomme désormais.
*/
const STATUS_MAP: Record<string, LeadStatus> = {
  "": "a_contacter",
  nouveau: "a_contacter",
  "a contacter": "a_contacter",

  // Une ancienne approche LinkedIn : le téléphone, lui, n'a jamais sonné.
  contacte: "a_contacter",
  linkedin: "a_contacter",
  // Un secteur noté dans la colonne statut. Pas tout à fait la cible, mais
  // rien n'a été tenté : la fiche reste à appeler.
  conception: "a_contacter",

  nrp: "nrp",
  "repondeur direct": "nrp",
  nrp2: "nrp2",
  "nrp 2": "nrp2",
  nrp3: "nrp3",
  "nrp 3": "nrp3",

  "raccroche avant pitch": "raccroche_avant_pitch",

  "a recontacter": "a_recontacter",
  nurturing: "a_recontacter",
  "a relancer mais non pour l'instant": "a_recontacter",
  "mail envoye": "a_recontacter",
  "arret maladie": "a_recontacter",
  "call rate": "a_recontacter",
  // Le numéro ne répond pas, mais l'entreprise reste une cible : c'est le
  // canal qu'il faut changer, pas la fiche qu'il faut écarter.
  "numero sans reponse - changer canal": "a_recontacter",

  "pas interesse": "pas_interesse",

  "non qualifie": "non_qualifie",
  "hors cible": "non_qualifie",
  "a changer de metier": "non_qualifie",
  "deja accompagne": "non_qualifie",
  // Un numéro faux rend la fiche inutilisable telle quelle. Elle reste en
  // base, hors de la file d'appel, en attendant qu'on retrouve la ligne.
  "numero pas bon": "non_qualifie",

  "call pris": "call_pris",
};

/*
  Ce qu'on n'importe pas, sauf à le demander.

  Une entreprise hors cible ou dont le dirigeant change de métier n'a pas
  vocation à entrer dans le CRM : l'y faire entrer pour la marquer « non
  qualifiée » revient à la compter dans un total qu'elle fausse. Les autres
  libellés qui aboutissent à « Non qualifié » sont, eux, importés — « Déjà
  accompagné » dit quelque chose du marché, et « Numéro pas bon » se rattrape.
*/
const STATUTS_ECARTES = new Set(["hors cible", "a changer de metier"]);

export interface ParsedLeadsCsv {
  rows: Array<Record<string, string | number | null>>;
  skipped: number;
  /** En-têtes lus, avec le champ auquel ils aboutissent. */
  mappedColumns: Array<{ header: string; field: string }>;
  /** En-têtes écartés sciemment, avec la raison. */
  ignoredColumns: Array<{ header: string; reason: string }>;
  /** En-têtes qu'on ne sait pas lire : c'est là qu'il faut regarder. */
  unknownColumns: string[];
  /** Le format reconnu, pour l'afficher plutôt que de le laisser deviner. */
  profile: "pharow" | "interne";
  /** Régions déduites du code postal, faute d'une colonne région. */
  regionsDerived: number;
  /**
   * Les libellés de statut qu'on n'a pas su traduire, et combien de fois.
   *
   * Le silence sur ce point a coûté cher : un libellé inconnu retombait sur
   * « À contacter » sans rien dire, et cinq cent soixante-dix-huit fiches déjà
   * travaillées sont revenues à appeler. Une liste vide est désormais une
   * information ; une liste pleine, un avertissement.
   */
  unknownStatuses: Array<{ label: string; count: number }>;
  /** Ce qui a été laissé de côté, et pourquoi. */
  excluded: {
    /** Hors cible, ou dirigeant en reconversion. */
    horsCible: number;
    /** Ni téléphone ni e-mail : rien pour les joindre. */
    sansContact: number;
  };
}

export type ParseOptions = {
  /** Importer quand même les fiches hors cible. Faux par défaut. */
  inclureHorsCible?: boolean;
  /** Importer quand même les fiches sans aucun moyen de contact. Faux par défaut. */
  inclureSansContact?: boolean;
};

/** Découpe une ligne CSV en respectant les guillemets et les doublages `""`. */
function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === "," || char === ";") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function headerKey(header: string) {
  return stripAccents(header.toLowerCase()).replace(/\s+/g, " ").trim();
}

/** Dictionnaire indexé sur la forme normalisée, pour tolérer accents et casse. */
function normalizedMap(source: Record<string, string>) {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(source)) out.set(headerKey(key), value);
  return out;
}

const BASE_LOOKUP = normalizedMap(COLUMN_MAP);
const PHAROW_LOOKUP = normalizedMap(PHAROW_OVERRIDES);
const INTERNE_LOOKUP = normalizedMap(INTERNE_OVERRIDES);
const IGNORED_LOOKUP = normalizedMap(IGNORED_COLUMNS);

function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) && value !== 0 ? Math.round(value * 100) / 100 : null;
}

function toYear(raw: string): number | null {
  const match = raw.match(/(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1800 && year <= 2100 ? year : null;
}

/** Les exports internes sont au format J/M/AAAA ; les autres en ISO. */
function toIsoDate(raw: string): string | null {
  const token = raw.trim().split(" ")[0];
  const iso = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return token;
  const match = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const [, day, month, yearRaw] = match;
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * Met un numéro français au format « +33 6 12 34 56 78 ».
 *
 * Un format unique n'est pas de la cosmétique : c'est ce qui permet à deux
 * fiches de se reconnaître comme portant la même ligne, et au clic-pour-appeler
 * de fonctionner. Ce qui n'est pas reconnu est rendu tel quel, jamais deviné.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const digits = raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");

  let national: string | null = null;
  if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^(?:\+33|0033)\d{9}$/.test(digits)) national = digits.slice(-9);
  else if (/^33\d{9}$/.test(digits)) national = digits.slice(2);
  else if (/^\d{9}$/.test(digits) && !digits.startsWith("0")) national = digits;

  if (!national) return raw.trim();

  const pairs = national.slice(1).match(/.{1,2}/g) ?? [];
  return `+33 ${national[0]} ${pairs.join(" ")}`;
}

export function parseLeadsCsv(text: string, options: ParseOptions = {}): ParsedLeadsCsv {
  const table = splitCsv(text.replace(/^\ufeff/, "")).filter((row) =>
    row.some((cell) => cell.trim() !== ""),
  );
  if (table.length < 2) throw new Error("Le fichier ne contient aucune ligne de données.");

  const headers = table[0].map((header) => header.trim());
  const normalizedHeaders = headers.map(headerKey);
  const profile = PHAROW_MARKERS.some((marker) => normalizedHeaders.includes(marker))
    ? ("pharow" as const)
    : ("interne" as const);
  const overrides = profile === "pharow" ? PHAROW_LOOKUP : INTERNE_LOOKUP;

  const mappedColumns: Array<{ header: string; field: string }> = [];
  const ignoredColumns: Array<{ header: string; reason: string }> = [];
  const unknownColumns: string[] = [];

  const keys = headers.map((header, index) => {
    const normalized = normalizedHeaders[index];
    if (!header) return null;

    const field = overrides.get(normalized) ?? BASE_LOOKUP.get(normalized) ?? null;
    if (field) {
      mappedColumns.push({ header, field });
      return field;
    }

    const reason = IGNORED_LOOKUP.get(normalized);
    if (reason) ignoredColumns.push({ header, reason });
    else unknownColumns.push(header);
    return null;
  });

  const rows: Array<Record<string, string | number | null>> = [];
  let skipped = 0;
  let regionsDerived = 0;
  const statutsInconnus = new Map<string, number>();
  const excluded = { horsCible: 0, sansContact: 0 };

  for (const line of table.slice(1)) {
    const record: Record<string, string | number | null> = {};
    // Le libellé tel qu'il était écrit. Il sert à trois choses : écarter les
    // hors-cible, signaler ce qu'on n'a pas su lire, et garder trace de la
    // nuance que la traduction efface.
    let statutBrut = "";

    keys.forEach((key, index) => {
      const raw = (line[index] ?? "").trim();
      if (!key || !raw) return;

      switch (key) {
        case "revenue":
          record.revenue = toNumber(raw);
          break;
        case "headcount": {
          const value = toNumber(raw);
          if (value !== null) record.headcount = Math.round(value);
          break;
        }
        case "founded_year":
        case "revenue_year": {
          const year = toYear(raw);
          if (year !== null) record[key] = year;
          break;
        }
        case "phone":
        case "phone_standard":
          record[key] = normalizePhone(raw);
          break;
        case "follow_up_on":
        case "created_at": {
          const iso = toIsoDate(raw);
          if (iso) record[key] = key === "created_at" ? `${iso}T09:00:00Z` : iso;
          break;
        }
        case "status": {
          statutBrut = raw;
          const connu = STATUS_MAP[headerKey(raw)];
          if (connu === undefined) {
            statutsInconnus.set(raw, (statutsInconnus.get(raw) ?? 0) + 1);
          }
          record.status = connu ?? "a_contacter";
          break;
        }
        default:
          // Le premier en-tête qui alimente un champ gagne : « Nom commercial »
          // arrive avant « Nom légal », et c'est le nom d'usage qu'on veut voir.
          if (record[key] == null) record[key] = raw;
      }
    });

    /*
      Ce qui n'entre pas dans la base.

      Écarté avant l'insertion et non marqué après : une fiche hors cible
      importée puis rangée en « Non qualifié » reste comptée dans les totaux,
      apparaît dans les recherches et gonfle le nombre de leads d'un tiers.
      Elle n'aide personne à vendre.
    */
    if (!options.inclureHorsCible && STATUTS_ECARTES.has(headerKey(statutBrut))) {
      excluded.horsCible += 1;
      continue;
    }

    // Ni portable, ni standard, ni e-mail : il n'y a aucun geste à poser sur
    // cette fiche. La plupart viennent d'une approche LinkedIn abandonnée.
    if (
      !options.inclureSansContact &&
      !record.phone &&
      !record.phone_standard &&
      !record.email
    ) {
      excluded.sansContact += 1;
      continue;
    }

    const fullName =
      (record.full_name as string | undefined) ??
      [record.first_name, record.last_name].filter(Boolean).join(" ").trim();

    if (!fullName && !record.email) {
      skipped += 1;
      continue;
    }

    record.full_name = fullName || (record.email as string);

    // À défaut d'une colonne région, l'adresse la donne — c'est un calcul, pas
    // une supposition, donc inutile d'y consacrer un appel au modèle.
    if (!record.region && typeof record.address === "string") {
      const region = regionFromAddress(record.address);
      if (region) {
        record.region = region;
        regionsDerived += 1;
      }
    }

    // Faute de nom commercial, la raison sociale fait l'affaire.
    if (!record.company_name && record.company_legal_name) {
      record.company_name = record.company_legal_name;
    }

    record.status ??= "a_contacter";

    /*
      La nuance que la traduction efface, gardée en clair.

      « Numéro pas bon » et « Déjà accompagné » deviennent tous deux « Non
      qualifié » : le statut sert à trier, le commentaire à comprendre. Sans
      cette ligne, la raison de la non-qualification serait perdue à l'import,
      et c'est précisément ce qu'on aurait voulu relire six mois plus tard.
    */
    const traduit = LEAD_STATUS[record.status as LeadStatus].label;
    if (statutBrut && headerKey(statutBrut) !== headerKey(traduit)) {
      const existant = typeof record.comment === "string" ? record.comment : "";
      record.comment = existant ? `${statutBrut} — ${existant}` : statutBrut;
    }

    rows.push(record);
  }

  return {
    rows,
    skipped,
    mappedColumns,
    ignoredColumns,
    unknownColumns: [...new Set(unknownColumns)],
    profile,
    regionsDerived,
    unknownStatuses: [...statutsInconnus.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    excluded,
  };
}
