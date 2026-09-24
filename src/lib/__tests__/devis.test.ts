/** `npx tsx src/lib/__tests__/devis.test.ts` — lecture des devis Pennylane et effet sur l'affaire. */
import { aRelancer, devisDeLaPage, etapeApresDevis, lireDevis, nomReduit, pageSuivante, statutDevis } from "@/lib/devis-logique";

let pass = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`);
}

// --- Statuts, sous toutes leurs graphies
check("pending", statutDevis("pending"), "en_attente");
check("accepted", statutDevis("accepted"), "accepte");
check("denied", statutDevis("denied"), "refuse");
check("invoiced", statutDevis("invoiced"), "facture");
check("expired", statutDevis("expired"), "expire");
check("draft", statutDevis("draft"), "brouillon");
check("en français", statutDevis("Accepté"), "accepte");
check("inconnu", statutDevis("quelque_chose"), "inconnu");

// --- Un devis tel que l'écran Pennylane le montre (D-2026-1, Archimed)
const devis = lireDevis({
  id: 1234,
  quote_number: "D-2026-1",
  status: "expired",
  currency_amount_before_tax: "3500.0",
  date: "2026-06-16",
  deadline: "2026-07-16",
  customer: { id: 99, url: "https://…" },
  public_file_url: "https://app.pennylane.com/public/quote/abc.pdf",
});
check("lu", devis, {
  pennylaneId: "1234",
  numero: "D-2026-1",
  statut: "expire",
  statutBrut: "expired",
  montantHt: 3500,
  emisLe: "2026-06-16",
  echeanceLe: "2026-07-16",
  clientId: "99",
  clientNom: null,
  url: "https://app.pennylane.com/public/quote/abc.pdf",
});
check("sans identifiant, rien", lireDevis({ status: "pending" }), null);

// --- Pages
check("liste sous items", devisDeLaPage({ items: [1, 2] }), [1, 2]);
check("liste nue", devisDeLaPage([1]), [1]);
check("page suivante", pageSuivante({ has_more: true, next_cursor: "abc" }), "abc");
check("dernière page", pageSuivante({ has_more: false, next_cursor: "abc" }), null);

// --- L'affaire suit le devis
check("envoyé depuis R2 → propale", etapeApresDevis("en_attente", "r2"), "propale_envoyee");
check("envoyé, déjà en propale → rien", etapeApresDevis("en_attente", "propale_envoyee"), null);
check("signé → gagné", etapeApresDevis("accepte", "propale_envoyee"), "gagne");
check("facturé → gagné", etapeApresDevis("facture", "r2"), "gagne");
check("déjà gagné → rien", etapeApresDevis("accepte", "gagne"), null);
check("refusé ne ferme rien", etapeApresDevis("refuse", "propale_envoyee"), null);
check("expiré ne ferme rien", etapeApresDevis("expire", "propale_envoyee"), null);

// --- Relance
check("expiré → à relancer", aRelancer({ statut: "expire", echeance_le: null }, "2026-09-24"), true);
check("en attente, échu → à relancer", aRelancer({ statut: "en_attente", echeance_le: "2026-09-20" }, "2026-09-24"), true);
check("en attente, dans les temps", aRelancer({ statut: "en_attente", echeance_le: "2026-10-20" }, "2026-09-24"), false);
check("signé → non", aRelancer({ statut: "accepte", echeance_le: "2026-01-01" }, "2026-09-24"), false);

// --- Rapprochement des noms
check("majuscules et forme juridique", nomReduit("ARCHIMED ENVIRONNEMENT"), nomReduit("Archimed Environnement SAS"));
check("accents et tirets", nomReduit("Bm2s-Bretagne"), nomReduit("BM2S Bretagne"));
check("deux entreprises distinctes restent distinctes", nomReduit("Acme") === nomReduit("Acme Ingénierie"), false);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
