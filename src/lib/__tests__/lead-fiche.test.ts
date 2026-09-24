/**
 * Le différentiel d'une fiche de lead.
 *
 * Sans dépendance de test : `npx tsx src/lib/__tests__/lead-fiche.test.ts`.
 * C'est la pièce où une erreur ne se verrait pas : un champ vidé qui
 * partirait en chaîne vide, un effectif collé d'un export qui partirait en
 * `NaN`, ou une colonne tenue par un déclencheur qui partirait tout court.
 */
import { CHAMPS, nomAffiche, patchFiche, SECTIONS, texteDe } from "@/lib/lead-fiche";
import type { Lead } from "@/lib/database.types";

let pass = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`,
  );
}

function fiche(partial: Partial<Lead> = {}): Lead {
  return {
    id: "l1",
    first_name: "Jean",
    last_name: "Martin",
    full_name: "Jean Martin",
    email: "jean@acme.fr",
    phone: null,
    company_name: "Acme",
    company_website: null,
    company_activity: null,
    company_legal_name: null,
    company_linkedin_url: null,
    company_description: null,
    job_title: null,
    phone_standard: null,
    siren: null,
    siret: null,
    headcount: null,
    headcount_range: null,
    founded_year: null,
    revenue_year: null,
    email_quality: null,
    sector: null,
    region: null,
    address: null,
    linkedin_url: null,
    revenue: null,
    status: "a_contacter",
    nrp_count: 0,
    org_key: "acme.fr",
    phone_key: null,
    status_changed_at: "2026-09-01T10:00:00Z",
    last_touched_at: null,
    touch_count: 0,
    last_action: null,
    last_action_detail: null,
    last_action_at: null,
    last_action_by: null,
    owner_name: null,
    owner_id: null,
    comment: null,
    follow_up_on: null,
    source: null,
    segment: null,
    converted_at: null,
    converted_deal_id: null,
    converted_contact_id: null,
    converted_company_id: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...partial,
  };
}

/** Le brouillon tel que le tiroir le remplit à l'ouverture. */
function brouillonDe(source: Lead, modifs: Record<string, string> = {}) {
  const valeurs: Record<string, string> = {};
  for (const champ of CHAMPS) valeurs[champ.cle] = texteDe(source, champ.cle);
  return { ...valeurs, ...modifs };
}

function patch(source: Lead, modifs: Record<string, string> = {}) {
  const resultat = patchFiche(source, brouillonDe(source, modifs));
  return "erreur" in resultat ? resultat : resultat.patch;
}

// --- Le différentiel ------------------------------------------------------

check("une fiche intacte ne produit rien", patch(fiche()), {});
check("un champ modifié, et lui seul", patch(fiche(), { siret: "12345678900011" }), {
  siret: "12345678900011",
});
check("un champ vidé redevient null", patch(fiche(), { email: "" }), { email: null });
check("un champ vide qui le reste ne bouge pas", patch(fiche(), { region: "" }), {});
check("les espaces autour sont retirés", patch(fiche(), { company_name: "  Acme  " }), {});

// --- Les nombres ----------------------------------------------------------

check("un effectif", patch(fiche(), { headcount: "120" }), { headcount: 120 });
check("un effectif collé d'un export", patch(fiche(), { revenue: "1 250 000" }), {
  revenue: 1250000,
});
check("une virgule française", patch(fiche(), { revenue: "1250,5" }), { revenue: 1250.5 });
check("un effectif inchangé", patch(fiche({ headcount: 120 }), { headcount: "120" }), {});
check("un nombre illisible est refusé", patch(fiche(), { headcount: "beaucoup" }), {
  erreur: "« Effectif » n'est pas un nombre.",
});

// --- Ce qui ne doit jamais partir ------------------------------------------

const declarees = new Set(CHAMPS.map((champ) => champ.cle));
const interdites = [
  "id",
  "org_key",
  "phone_key",
  "status_changed_at",
  "last_touched_at",
  "touch_count",
  "nrp_count",
  "owner_name",
  "converted_at",
  "converted_deal_id",
  "created_at",
  "updated_at",
];
check(
  "aucune colonne tenue par la base n'est déclarée",
  interdites.filter((colonne) => declarees.has(colonne as never)),
  [],
);
check("aucun champ n'est déclaré deux fois", CHAMPS.length, declarees.size);
check(
  "chaque champ porte un intitulé",
  CHAMPS.filter((champ) => !champ.label.trim()).length,
  0,
);
check("les sections couvrent tous les champs", SECTIONS.flatMap((s) => s.champs).length, CHAMPS.length);

// --- Le nom affiché --------------------------------------------------------

check(
  "il suit quand il est la somme des deux",
  nomAffiche(
    { first_name: "Jean", last_name: "Martin", full_name: "Jean Martin" },
    { first_name: "Jean", last_name: "Martineau" },
  ),
  "Jean Martineau",
);
check(
  "il ne suit pas quand on lui a donné autre chose",
  nomAffiche(
    { first_name: "Jean", last_name: "Martin", full_name: "Dr Jean Martin" },
    { first_name: "Jean", last_name: "Martineau" },
  ),
  null,
);
check(
  "une fiche importée, sans prénom ni nom, garde son nom complet",
  nomAffiche({ full_name: "SARL Dupont & Fils" }, { first_name: "Paul" }),
  null,
);
check(
  "un prénom ajouté sur une fiche vide",
  nomAffiche({ full_name: "" }, { first_name: "Paul", last_name: "Durand" }),
  "Paul Durand",
);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
