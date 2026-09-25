/** `npx tsx src/lib/__tests__/plan.test.ts` — le plan du jour commercial. */
import { construirePlan, planDe, verrouProspection, type AffaireEntree } from "@/lib/plan-logique";

let pass = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`);
}

const auj = "2026-09-25"; // vendredi
const affaire = (id: string, extra: Partial<AffaireEntree> = {}): AffaireEntree => ({
  id,
  nom: `Affaire ${id}`,
  etape: "r2",
  etapeLibelle: "R2",
  montant: 5000,
  ownerId: "L",
  nextStep: null,
  nextStepOn: null,
  dormante: false,
  joursDansEtape: 3,
  ...extra,
});

const plan = construirePlan({
  aujourdhui: auj,
  affaires: [
    affaire("retard", { nextStep: "Relancer le DG", nextStepOn: "2026-09-22" }),
    affaire("cumul", { etape: "propale_envoyee", nextStep: "Appeler", nextStepOn: "2026-09-24", montant: 12000 }),
    affaire("jour", { nextStep: "Envoyer la plaquette", nextStepOn: auj }),
    affaire("lundi", { nextStep: "Point", nextStepOn: "2026-09-28" }),
    affaire("noshow", { etape: "no_show", nextStepOn: "2026-10-10" }),
    affaire("dort", { etape: "r1", dormante: true, joursDansEtape: 40 }),
    affaire("chaude", { etape: "propale_envoyee" }),
    affaire("gagnee", { etape: "gagne", nextStepOn: "2026-09-01" }),
    affaire("coche", { nextStepOn: "2026-09-20", ownerId: "R" }),
    affaire("recap", { ownerId: null }),
    affaire("tranquille", { etape: "demande_rdv_envoyee", nextStepOn: "2026-10-20" }),
  ],
  devis: [{ dealId: "cumul", numero: "D-2026-3", statut: "expire", echeanceLe: "2026-09-10" }],
  recapsPrets: ["recap"],
  leads: [
    { id: "l1", nom: "Paul", entreprise: "Acme", statutLibelle: "NRP", followUpOn: "2026-09-20", ownerId: "L", nrp: 2 },
    { id: "l2", nom: "Jeanne", entreprise: null, statutLibelle: "À recontacter", followUpOn: auj, ownerId: "L", nrp: 0 },
    { id: "l3", nom: "Futur", entreprise: null, statutLibelle: "NRP", followUpOn: "2026-10-01", ownerId: "L", nrp: 1 },
    { id: "l4", nom: "Romain's", entreprise: null, statutLibelle: "NRP", followUpOn: auj, ownerId: "R", nrp: 1 },
  ],
  coches: new Set(["deal:coche"]),
});

const ids = plan.affaires.map((a) => a.dealId);
check("ordre par importance", ids, ["recap", "cumul", "retard", "noshow", "jour", "chaude", "dort"]);
check("une seule ligne pour une affaire qui cumule", ids.filter((i) => i === "cumul").length, 1);
const cumul = plan.affaires.find((a) => a.dealId === "cumul")!;
check("raison principale = étape en retard", cumul.type, "etape_retard");
check("les autres raisons en bref", cumul.aussi, ["devis D-2026-3 expiré"]);
check("action = prochaine étape écrite", cumul.action, "Appeler");
check("no-show daté plus tard : groupe no-show", plan.affaires.find((a) => a.dealId === "noshow")!.groupe, "no_show");
check("étape du jour : à traiter", plan.affaires.find((a) => a.dealId === "jour")!.groupe, "traiter");
check("dormante : à réveiller", plan.affaires.find((a) => a.dealId === "dort")!.groupe, "reveiller");
check("dormante = faire avancer", plan.affaires.find((a) => a.dealId === "dort")!.type, "dormante");
check("chaude sans étape", plan.affaires.find((a) => a.dealId === "chaude")!.action, "Fixer la prochaine étape");
check("fermées et cochées absentes", ["gagnee", "coche", "tranquille", "lundi"].some((i) => ids.includes(i)), false);
check("lundi annoncé (à venir) le vendredi", plan.aVenir, 1);
check("cochée comptée comme faite", plan.faits, 1);
check("relances : dues seulement, les plus en retard d'abord", plan.relances.map((l) => l.leadId), ["l1", "l2", "l4"]);
check("retard du lead", plan.relances[0]!.retard, 5);

const leo = planDe(plan, "L");
check("plan de Léopold : ses affaires + sans responsable", leo.affaires.map((a) => a.dealId).includes("recap"), true);
check("plan de Léopold : ses leads seulement", leo.relances.map((l) => l.leadId), ["l1", "l2"]);
check("verrou fermé", verrouProspection(leo), { ouvert: false, affaires: 7, relances: 2 });
check(
  "verrou ouvert quand tout est fait",
  verrouProspection({ ...leo, affaires: [], relances: [] }).ouvert,
  true,
);

// --- Le lot de relances : vingt par personne, toujours les mêmes tant qu'elles ne sont pas traitées
const leads = Array.from({ length: 25 }, (_, i) => ({
  id: `x${i}`,
  nom: `Lead ${String(i).padStart(2, "0")}`,
  entreprise: null,
  statutLibelle: "NRP",
  followUpOn: `2026-09-${String(1 + i).padStart(2, "0")}`,
  ownerId: "L",
  nrp: 1,
}));
const lot = construirePlan({
  aujourdhui: auj,
  affaires: [],
  devis: [],
  recapsPrets: [],
  leads: [...leads, { id: "orphelin", nom: "Sans responsable", entreprise: null, statutLibelle: "NRP", followUpOn: "2026-01-01", ownerId: null, nrp: 1 }],
  coches: new Set(),
});
check("un lead sans responsable n'entre pas dans le plan", lot.relances.some((l) => l.leadId === "orphelin"), false);
check("lot de 20", lot.relances.length, 20);
check("les plus anciennes d'abord", lot.relances[0]!.leadId, "x0");
check("le reste attend", lot.relancesEnAttente, { L: 5 });
const coche = construirePlan({ aujourdhui: auj, affaires: [], devis: [], recapsPrets: [], leads, coches: new Set(["lead:x0", "lead:x1"]) });
check("cocher ne fait pas entrer d'autres leads", coche.relances.length, 18);
check("les cochées comptent comme faites", coche.faits, 2);
const lendemain = construirePlan({ aujourdhui: "2026-09-28", affaires: [], devis: [], recapsPrets: [], leads, coches: new Set() });
check("le lendemain, les mêmes restent en tête", lendemain.relances.map((l) => l.leadId).slice(0, 3), ["x0", "x1", "x2"]);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
