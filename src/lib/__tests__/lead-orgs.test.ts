/**
 * Vérification du rattachement par organisation.
 *
 * Sans dépendance de test : `npx tsx src/lib/__tests__/lead-orgs.test.ts`.
 * Les cas viennent de la base réelle — deux filiales d'un même groupe, un
 * dirigeant présent dans deux sociétés — parce que ce sont eux qui font
 * décrocher deux fois.
 */
import type { LeadListe } from "@/lib/database.types";
import { buildOrgIndex, collapseByOrg } from "@/lib/lead-orgs";

const NOW = Date.parse("2026-09-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

let pass = 0, fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`);
}

let seq = 0;
function lead(partial: Partial<LeadListe> & { id: string }): LeadListe {
  seq += 1;
  return {
    id: partial.id,
    full_name: partial.full_name ?? `Lead ${seq}`,
    org_key: partial.org_key ?? null,
    phone: partial.phone ?? null,
    phone_key: partial.phone_key ?? null,
    last_touched_at: partial.last_touched_at ?? null,
    status_changed_at: partial.status_changed_at ?? daysAgo(400),
  } as LeadListe;
}

/* --- Rattachement ------------------------------------------------------- */

console.log("--- rattachement ---");

// Deux filiales, deux raisons sociales, un seul domaine.
const auddice = [
  lead({ id: "a1", org_key: "auddice.com", last_touched_at: daysAgo(3) }),
  lead({ id: "a2", org_key: "auddice.com", last_touched_at: daysAgo(80) }),
  lead({ id: "seul", org_key: "ailleurs.fr", last_touched_at: daysAgo(1) }),
];
const index = buildOrgIndex(auddice, 30, NOW);
check("a1 est rattaché à a2", index.get("a1")?.siblings.map((l) => l.id), ["a2"]);
// a2 date de 80 jours : au-delà du refroidissement, donc pas d'alerte — mais
// le lien reste visible, et la date avec lui.
check("pas d'alerte au-delà du délai", index.get("a1")?.recent?.id ?? null, null);
check("le délai reste lisible", index.get("a1")?.daysSince, 80);
check("a2 voit a1 appelé il y a 3 j", index.get("a2")?.recent?.id, "a1");
check("un lead seul n'est pas indexé", index.has("seul"), false);

// Même personne, deux sociétés, une seule ligne : l'entreprise ne les relie pas.
const tarik = buildOrgIndex(
  [
    lead({ id: "t1", org_key: "groupe-6napse.com", phone_key: "699837935", last_touched_at: daysAgo(5) }),
    lead({ id: "t2", org_key: "analyses-surface.com", phone_key: "699837935", last_touched_at: daysAgo(5) }),
  ],
  30,
  NOW,
);
check("le téléphone relie deux entreprises", tarik.get("t1")?.siblings.map((l) => l.id), ["t2"]);
check("et alerte", tarik.get("t1")?.recent?.id, "t2");

// Un numéro porté par toute une liste est un standard, pas un lien.
const standard = buildOrgIndex(
  Array.from({ length: 6 }, (_, i) =>
    lead({ id: `s${i}`, org_key: `societe${i}.fr`, phone_key: "100000000" }),
  ),
  30,
  NOW,
);
check("un numéro trop partagé ne relie rien", standard.size, 0);

// Sans e-mail ni téléphone, aucun rattachement inventé.
const vides = buildOrgIndex([lead({ id: "v1" }), lead({ id: "v2" })], 30, NOW);
check("deux fiches vides restent séparées", vides.size, 0);

// `status_changed_at` prend le relais quand la fiche n'a jamais été touchée.
const jamais = buildOrgIndex(
  [
    lead({ id: "j1", org_key: "x.fr", status_changed_at: daysAgo(2) }),
    lead({ id: "j2", org_key: "x.fr", status_changed_at: daysAgo(300) }),
  ],
  30,
  NOW,
);
check("le dernier mouvement fait foi", jamais.get("j2")?.daysSince, 2);

/* --- File d'appel -------------------------------------------------------- */

console.log("\n--- une ligne par organisation ---");

const ids = (entrees: ReturnType<typeof collapseByOrg>) => entrees.map((e) => e.lead.id);

// Trois dirigeants chez Auddice, un ailleurs : trois lignes ne doivent plus
// en faire qu'une.
const file = [
  lead({ id: "a1", org_key: "auddice.com" }),
  lead({ id: "a2", org_key: "auddice.com" }),
  lead({ id: "b1", org_key: "autre.fr" }),
];
const collapse = collapseByOrg(file, buildOrgIndex(file, 30, NOW));
check("une seule ligne par organisation", ids(collapse), ["a1", "b1"]);
check("le groupe garde le rang de son premier membre", ids(collapse)[0], "a1");
check("les autres restent joignables", collapse[0].candidats.length, 2);
check("une fiche seule n'a pas d'alternative", collapse[1].candidats.length, 1);
check("une fiche seule n'a pas de groupe", collapse[1].groupId, null);

// Le portable décroche, le standard filtre : c'est lui qu'on propose d'abord,
// même s'il arrive plus loin dans la file.
const avecPortable = [
  lead({ id: "std", org_key: "z.fr" }),
  lead({ id: "mobile", org_key: "z.fr", phone: "+33 6 12 34 56 78" }),
];
check(
  "le portable passe devant",
  ids(collapseByOrg(avecPortable, buildOrgIndex(avecPortable, 30, NOW))),
  ["mobile"],
);

console.log("\n--- la rotation ---");

const trio = [
  lead({ id: "t1", org_key: "trio.fr" }),
  lead({ id: "t2", org_key: "trio.fr" }),
  lead({ id: "t3", org_key: "trio.fr" }),
];
const indexTrio = buildOrgIndex(trio, 30, NOW);
const groupe = collapseByOrg(trio, indexTrio)[0].groupId!;
const apres = (tours: number) => ids(collapseByOrg(trio, indexTrio, new Map([[groupe, tours]])))[0];

check("sans clic, le premier", apres(0), "t1");
check("un clic, le deuxième", apres(1), "t2");
check("deux clics, le troisième", apres(2), "t3");
check("trois clics, retour au départ", apres(3), "t1");
check("le cercle tient au-delà d'un tour", apres(7), "t2");

// La rotation d'un groupe ne doit pas déplacer les autres lignes.
const melange = [
  lead({ id: "m1", org_key: "y.fr" }),
  lead({ id: "m2", org_key: "y.fr" }),
  lead({ id: "libre" }),
  lead({ id: "m3", org_key: "y.fr" }),
];
const indexMelange = buildOrgIndex(melange, 30, NOW);
const groupeY = collapseByOrg(melange, indexMelange)[0].groupId!;
check(
  "tourner un groupe ne bouge pas le reste",
  ids(collapseByOrg(melange, indexMelange, new Map([[groupeY, 1]]))),
  ["m2", "libre"],
);

// Une rotation qui pointe un groupe absent de la file ne casse rien.
check(
  "une rotation orpheline est sans effet",
  ids(collapseByOrg(melange, indexMelange, new Map([["groupe-inconnu", 3]]))),
  ["m1", "libre"],
);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
