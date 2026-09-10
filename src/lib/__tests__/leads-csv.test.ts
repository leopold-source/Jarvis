/**
 * Lecture des exports CSV.
 *
 * `npx tsx src/lib/__tests__/leads-csv.test.ts`. Les en-têtes viennent d'un
 * export Pharow réel : c'est en les prenant pour ceux de la table interne que
 * l'entreprise, le téléphone et le LinkedIn s'étaient perdus, sans le moindre
 * message d'erreur — la pire façon de rater un import.
 */
import { normalizePhone, parseLeadsCsv } from "@/lib/leads-csv";
import { regionFromAddress } from "@/lib/french-regions";

let pass = 0, fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`);
}

const csv = (lines: string[]) => lines.join("\n");

/* --- Format de sourcing -------------------------------------------------- */

console.log("--- export de sourcing ---");

const pharow = parseLeadsCsv(
  csv([
    '"Nom de la liste Pharow","Nom","Prénom","Civilité","URL LinkedIn du prospect","Poste occupé","Email","Type d\'email","Tél portable","SIREN","SIRET du siège","Nom commercial","Nom légal","Tél standard","Secteur NAF","Activité source Pharow","Année de création","Date de création","Effectif réel","Tranche d\'effectif corrigée","URL du site internet","URL de la page LinkedIn","Adresse du siège complète","Chiffre d\'affaires en euros","Année du chiffre d\'affaires"',
    '"2026-09 - BE 6-9","Bessy","Jacques","Monsieur","https://www.linkedin.com/in/jacques-bessy","Président","j.bessy@hub-env.com","valid","+33 6 27 13 15 84","494384670","49438467000050","Hub-Environnement","Hub Environnement SAS","04 72 80 94 74","Ingénierie","Bureaux d\'études","2007","2007-03-01","5","6 - 9","http://hub-env.fr","https://fr.linkedin.com/company/hubenv","24 Avenue Joannes Masset 69009 Lyon","315033","2020"',
  ]),
);

check("profil reconnu", pharow.profile, "pharow");
check("aucun en-tête inconnu", pharow.unknownColumns, []);
const p = pharow.rows[0];
check("entreprise = nom commercial", p.company_name, "Hub-Environnement");
check("raison sociale conservée à part", p.company_legal_name, "Hub Environnement SAS");
check("poste", p.job_title, "Président");
check("portable normalisé", p.phone, "+33 6 27 13 15 84");
check("standard normalisé, champ distinct", p.phone_standard, "+33 4 72 80 94 74");
check("linkedin du prospect", p.linkedin_url, "https://www.linkedin.com/in/jacques-bessy");
check("linkedin de l'entreprise", p.company_linkedin_url, "https://fr.linkedin.com/company/hubenv");
check("siret", p.siret, "49438467000050");
check("effectif", p.headcount, 5);
check("tranche d'effectif", p.headcount_range, "6 - 9");
check("chiffre d'affaires", p.revenue, 315033);
check("année du CA", p.revenue_year, 2020);
check("campagne", p.segment, "2026-09 - BE 6-9");
check("nom complet composé", p.full_name, "Jacques Bessy");
// Le piège : dans ce format, « Date de création » est celle de l'entreprise.
check("l'année de fondation ne date pas la fiche", p.founded_year, 2007);
check("… et created_at reste vide", p.created_at ?? null, null);
check("région déduite du code postal", p.region, "Auvergne-Rhône-Alpes");
check("une région déduite comptée", pharow.regionsDerived, 1);
check("civilité écartée sciemment", pharow.ignoredColumns.some((c) => c.header === "Civilité"), true);

/* --- Format interne ------------------------------------------------------ */

console.log("\n--- export interne ---");

const interne = parseLeadsCsv(
  csv([
    '"Prénom","Nom","E-mail","Tél","Entreprise","Statut","Région","Relance","Date de création","Commentaire"',
    '"Ana","Roux","ana@boite.fr","0608370360","Boîte","NRP 2","IDF","06/03/2026","01/02/2026","À rappeler"',
  ]),
);

check("profil interne", interne.profile, "interne");
const i = interne.rows[0];
check("téléphone français normalisé", i.phone, "+33 6 08 37 03 60");
check("statut traduit", i.status, "nrp2");
check("relance en ISO", i.follow_up_on, "2026-03-06");
// Ici « Date de création » est bien celle de la fiche.
check("created_at renseigné", i.created_at, "2026-02-01T09:00:00Z");
check("région laissée au nettoyage IA", i.region, "IDF");

/* --- Téléphones ---------------------------------------------------------- */

console.log("\n--- téléphones ---");
check("national", normalizePhone("0608370360"), "+33 6 08 37 03 60");
check("espacé", normalizePhone("06 08 37 03 60"), "+33 6 08 37 03 60");
check("points", normalizePhone("06.08.37.03.60"), "+33 6 08 37 03 60");
check("déjà international", normalizePhone("+33608370360"), "+33 6 08 37 03 60");
check("00 33", normalizePhone("0033608370360"), "+33 6 08 37 03 60");
check("vide", normalizePhone("  "), null);
// Un numéro étranger n'est pas français : le reformater le casserait.
check("étranger rendu tel quel", normalizePhone("+44 20 7946 0958"), "+44 20 7946 0958");
check("inclassable rendu tel quel", normalizePhone("standard : demander Paul"), "standard : demander Paul");

/* --- Régions ------------------------------------------------------------- */

console.log("\n--- régions ---");
check("Lyon", regionFromAddress("24 Avenue Joannes Masset 69009 Lyon"), "Auvergne-Rhône-Alpes");
check("Paris", regionFromAddress("10 rue de Rivoli 75001 Paris"), "Île-de-France");
check("Corse", regionFromAddress("Route du Port 20000 Ajaccio"), "Corse");
check("Outre-mer", regionFromAddress("12 rue Schoelcher 97200 Fort-de-France"), "Outre-mer");
// Un SIRET dans l'adresse ne doit pas passer pour un code postal.
check("suite de chiffres trop longue ignorée", regionFromAddress("SIRET 49438467000050"), null);
check("sans code postal", regionFromAddress("[nd] [nd]  Avignon"), null);

/* --- Robustesse ---------------------------------------------------------- */

console.log("\n--- robustesse ---");
// Une ligne entièrement vide est un artefact de fichier : elle disparaît sans
// être comptée. Une ligne qui porte des données mais ni nom ni e-mail, elle,
// est un vrai rejet — et doit être signalée comme tel.
const vide = parseLeadsCsv(
  csv(['"Prénom","Nom","E-mail","Entreprise"', '"","","",""', '"","","","Boîte sans contact"', '"Zoe","Blanc","",""']),
);
check("ligne vide non comptée", vide.rows.length, 1);
check("ligne sans nom ni e-mail rejetée", vide.skipped, 1);

const pointVirgule = parseLeadsCsv(csv(['"Prénom";"Nom";"Entreprise"', '"Ana";"Roux";"Boîte"']));
check("séparateur point-virgule", pointVirgule.rows[0].company_name, "Boîte");

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
