/**
 * Vérification du dédoublonnage à l'import.
 *
 * Sans dépendance de test : `npx tsx src/lib/__tests__/leads-dedupe.test.ts`.
 * Le garde-fou qui laisse passer un doublon coûte cher et ne se voit pas —
 * ces cas existent pour que la régression, elle, se voie.
 */
import { buildLookup, classifyRow, companyKey, personKey } from "@/lib/leads-dedupe";

const index = {
  emails: ["paul@carbonapp.fr"],
  people: ["bonan paul@carbonapp", "sergent sebastien@ecotechnics"],
  companiesFromLeads: ["valutec"],
  companiesInPipeline: ["carbonapp", "ecotechnics"],
  domains: ["auddice.com"],
};

let pass = 0, fail = 0;
function check(label: string, got: string, want: string) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${got}${ok ? "" : ` (attendu ${want})`}`);
}

const fresh = () => ({ emails: new Set<string>(), people: new Set<string>(), domains: new Set<string>() });
const run = (row: Record<string, unknown>, seen = fresh()) =>
  classifyRow(row, buildLookup(index), seen).verdict;

console.log("--- clés ---");
check("companyKey SARL", companyKey("Ecotechnics SARL"), "ecotechnics");
check("companyKey casse+accents", companyKey("ÉCOTECHNICS"), "ecotechnics");
check("companyKey Groupe X", companyKey("Groupe Valutec"), "valutec");
check("personKey ordre inverse", personKey(null, null, "Dupont Jean"), personKey("Jean", "Dupont", null));
check("personKey accents", personKey("Sébastien", "Sergent", null), "sebastien sergent");

console.log("\n--- verdicts ---");
check("email déjà en base", run({ email: "PAUL@carbonapp.fr", company_name: "Carbonapp" }), "doublon");
check("même personne même entreprise", run({ first_name: "Paul", last_name: "Bonan", company_name: "CARBONAPP SAS" }), "doublon");
check("autre personne, entreprise en affaire", run({ first_name: "Marie", last_name: "Durand", company_name: "Carbonapp" }), "entreprise_connue");
check("autre personne, entreprise en lead", run({ first_name: "Luc", last_name: "Petit", company_name: "Valutec SA" }), "entreprise_connue");
check("inconnu total", run({ first_name: "Zoe", last_name: "Blanc", company_name: "Nouvelle Boite" }), "nouveau");

console.log("\n--- doublons internes au fichier ---");
const seen = fresh();
check("1re occurrence", run({ first_name: "Zoe", last_name: "Blanc", company_name: "Nouvelle Boite" }, seen), "nouveau");
check("2e occurrence même fichier", run({ first_name: "Blanc", last_name: "Zoe", company_name: "NOUVELLE BOITE" }, seen), "doublon");

console.log("\n--- cas limites ---");
const s4 = fresh();
check("homonyme MÊME entreprise (1)", run({ full_name: "Jean Martin", company_name: "Acme" }, s4), "nouveau");
check("homonyme MÊME entreprise (2) — doit être doublon", run({ full_name: "Martin Jean", company_name: "ACME SAS" }, s4), "doublon");
const s2 = fresh();
check("homonyme sans entreprise (1)", run({ full_name: "Jean Martin" }, s2), "nouveau");
check("homonyme sans entreprise (2) — personne DIFFÉRENTE, doit passer", run({ full_name: "Jean Martin" }, s2), "nouveau");
check("ligne vide", run({}), "nouveau");
const s3 = fresh();
check("2 lignes vides", run({}, s3) + "/" + run({}, s3), "nouveau/nouveau");

console.log("\n--- rattachement par domaine ---");
// La raison sociale diffère, le domaine non : nouveau contact chez un compte
// déjà travaillé, pas un doublon. C'est exactement le cas des filiales.
check(
  "filiale d'un lead existant",
  run({ full_name: "Arnaud Froger", email: "a.froger@auddice.com", company_name: "Auddice Environnement" }),
  "entreprise_connue",
);
check(
  "domaine inconnu",
  run({ full_name: "Zoe Blanc", email: "zoe@inconnue.fr", company_name: "Inconnue" }),
  "nouveau",
);
// Une adresse personnelle ne dit rien de l'employeur : ne rien en conclure.
const perso = fresh();
check(
  "gmail (1)",
  run({ full_name: "Ana Roux", email: "ana@gmail.com", company_name: "Boite A" }, perso),
  "nouveau",
);
check(
  "gmail (2) — ne relie pas deux entreprises",
  run({ full_name: "Bob Roux", email: "bob@gmail.com", company_name: "Boite B" }, perso),
  "nouveau",
);
// Trois dirigeants d'une même boîte dans un seul fichier : tous importés, mais
// le second et le troisième sont signalés.
const trio = fresh();
check(
  "1er DG du fichier",
  run({ full_name: "Un Dg", email: "un@verdi-ingenierie.fr", company_name: "Verdi Normandie" }, trio),
  "nouveau",
);
check(
  "2e DG, même domaine",
  run({ full_name: "Deux Dg", email: "deux@verdi-ingenierie.fr", company_name: "Verdi Nord" }, trio),
  "entreprise_connue",
);
check(
  "3e DG, même domaine",
  run({ full_name: "Trois Dg", email: "trois@verdi-ingenierie.fr", company_name: "Verdi Est" }, trio),
  "entreprise_connue",
);

console.log(`\n${pass} OK, ${fail} FAIL`);
if (fail > 0) process.exit(1);
