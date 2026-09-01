import type { LeadStatus } from "@/lib/database.types";

/**
 * Lecture d'un export CSV de leads, côté navigateur.
 *
 * Le format d'entrée est celui de la table de prospection : en-têtes en
 * français, montants en euros (« €1 234,00 »), dates au format J/M/AAAA, et une
 * colonne « fullname » qui porte en réalité le libellé de campagne.
 */

const COLUMN_MAP: Record<string, string> = {
  name: "full_name",
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
  entreprise: "company_name",
  "site entreprise": "company_website",
  activité: "company_activity",
  activite: "company_activity",
  secteur: "sector",
  région: "region",
  region: "region",
  adresse: "address",
  "url linkedin": "linkedin_url",
  linkedin: "linkedin_url",
  "valeur ca": "revenue",
  ca: "revenue",
  statut: "status",
  owner: "owner_name",
  commentaire: "comment",
  relance: "follow_up_on",
  "date de création": "created_at",
  "date de creation": "created_at",
  fullname: "segment",
  campagne: "segment",
  segment: "segment",
};

const STATUS_MAP: Record<string, LeadStatus> = {
  "": "nouveau",
  nouveau: "nouveau",
  "a contacter": "a_contacter",
  nrp: "nrp",
  nrp2: "nrp2",
  "nrp 2": "nrp2",
  nrp3: "nrp3",
  "nrp 3": "nrp3",
  "raccroche avant pitch": "raccroche_avant_pitch",
  "a recontacter": "a_recontacter",
  "pas interesse": "pas_interesse",
  "non qualifie": "non_qualifie",
  "call pris": "call_pris",
};

export interface ParsedLeadsCsv {
  rows: Array<Record<string, string | number | null>>;
  skipped: number;
  unknownColumns: string[];
}

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
    } else if (char === ",") {
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

function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) && value !== 0 ? Math.round(value * 100) / 100 : null;
}

/** Les exports sont au format J/M/AAAA, éventuellement suivis d'une heure. */
function toIsoDate(raw: string): string | null {
  const token = raw.trim().split(" ")[0];
  const match = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const [, day, month, yearRaw] = match;
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function parseLeadsCsv(text: string): ParsedLeadsCsv {
  const table = splitCsv(text.replace(/^\ufeff/, "")).filter((row) =>
    row.some((cell) => cell.trim() !== ""),
  );
  if (table.length < 2) throw new Error("Le fichier ne contient aucune ligne de données.");

  const headers = table[0].map((header) => header.trim());
  const unknownColumns: string[] = [];
  const keys = headers.map((header) => {
    const normalized = stripAccents(header.toLowerCase()).replace(/\s+/g, " ").trim();
    const mapped =
      COLUMN_MAP[header.toLowerCase().trim()] ??
      COLUMN_MAP[normalized] ??
      Object.entries(COLUMN_MAP).find(([key]) => stripAccents(key) === normalized)?.[1];
    if (!mapped && header.trim()) unknownColumns.push(header.trim());
    return mapped ?? null;
  });

  const rows: Array<Record<string, string | number | null>> = [];
  let skipped = 0;

  for (const line of table.slice(1)) {
    const record: Record<string, string | number | null> = {};

    keys.forEach((key, index) => {
      if (!key) return;
      const raw = (line[index] ?? "").trim();
      if (!raw) return;

      switch (key) {
        case "revenue":
          record.revenue = toNumber(raw);
          break;
        case "follow_up_on":
        case "created_at": {
          const iso = toIsoDate(raw);
          if (iso) record[key] = key === "created_at" ? `${iso}T09:00:00Z` : iso;
          break;
        }
        case "status": {
          const normalized = stripAccents(raw.toLowerCase()).replace(/\s+/g, " ").trim();
          record.status = STATUS_MAP[normalized] ?? "nouveau";
          break;
        }
        default:
          record[key] = raw;
      }
    });

    const fullName =
      (record.full_name as string | undefined) ??
      [record.first_name, record.last_name].filter(Boolean).join(" ").trim();

    if (!fullName && !record.email) {
      skipped += 1;
      continue;
    }

    record.full_name = fullName || (record.email as string);
    record.status ??= "nouveau";
    rows.push(record);
  }

  return { rows, skipped, unknownColumns: [...new Set(unknownColumns)] };
}
