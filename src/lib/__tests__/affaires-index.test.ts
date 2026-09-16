/**
 * De quel interlocuteur vers quelle affaire.
 *
 * Sans dépendance de test : `npx tsx src/lib/__tests__/affaires-index.test.ts`.
 * C'est cet index qui décide si un e-mail est conservé : un message dont
 * l'expéditeur ne mène à aucune affaire est écarté sans trace. Une erreur ici
 * ne produit pas de message d'erreur — elle produit un fil incomplet, ce qui
 * est bien pire.
 */
import { indexerAffaires } from "@/lib/gmail-sync";

let pass = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`,
  );
}

const deal = (id: string, contact_id: string | null, company_id: string | null) => ({
  id,
  contact_id,
  company_id,
});

// --- Le cas d'avant : un seul contact --------------------------------------

{
  const { dealByContact } = indexerAffaires([deal("a1", "c1", "e1")], [{ deal_id: "a1", contact_id: "c1" }]);
  check("le principal mène à son affaire", dealByContact.get("c1"), "a1");
}

// --- Le cas que l'on répare ------------------------------------------------

{
  const { dealByContact } = indexerAffaires(
    [deal("a1", "c1", "e1")],
    [
      { deal_id: "a1", contact_id: "c1" },
      { deal_id: "a1", contact_id: "c2" },
      { deal_id: "a1", contact_id: "c3" },
    ],
  );
  check("le responsable technique aussi", dealByContact.get("c2"), "a1");
  check("l'assistante aussi", dealByContact.get("c3"), "a1");
}

// --- Une affaire d'avant le déclencheur, sans ligne de liaison --------------

{
  const { dealByContact } = indexerAffaires([deal("a1", "c1", "e1")], []);
  check("le principal reste rattaché sans liaison", dealByContact.get("c1"), "a1");
}

// --- Deux affaires pour le même contact ------------------------------------

{
  // L'ordre d'entrée est celui de la base : la plus récemment modifiée d'abord.
  const { dealByContact } = indexerAffaires(
    [deal("recente", "c1", "e1"), deal("ancienne", "c1", "e1")],
    [
      { deal_id: "ancienne", contact_id: "c1" },
      { deal_id: "recente", contact_id: "c1" },
    ],
  );
  check("la plus vivante gagne", dealByContact.get("c1"), "recente");
}

{
  // Le contact n'est secondaire que sur la récente : elle l'emporte quand même.
  const { dealByContact } = indexerAffaires(
    [deal("recente", "c9", "e1"), deal("ancienne", "c1", "e1")],
    [
      { deal_id: "recente", contact_id: "c9" },
      { deal_id: "recente", contact_id: "c1" },
      { deal_id: "ancienne", contact_id: "c1" },
    ],
  );
  check("secondaire sur la récente l'emporte", dealByContact.get("c1"), "recente");
}

// --- Le repli par entreprise ------------------------------------------------

{
  const { dealByCompany } = indexerAffaires(
    [deal("recente", "c1", "e1"), deal("ancienne", "c2", "e1")],
    [],
  );
  check("l'entreprise mène à son affaire la plus vivante", dealByCompany.get("e1"), "recente");
}

// --- Les cas vides ----------------------------------------------------------

{
  const { dealByContact, dealByCompany } = indexerAffaires([], []);
  check("rien n'entre, rien ne sort", [dealByContact.size, dealByCompany.size], [0, 0]);
}

{
  const { dealByContact, dealByCompany } = indexerAffaires([deal("a1", null, null)], []);
  check("une affaire sans contact ni entreprise", [dealByContact.size, dealByCompany.size], [0, 0]);
}

{
  // Une liaison qui désigne une affaire disparue ne doit rien inventer.
  const { dealByContact } = indexerAffaires([], [{ deal_id: "fantome", contact_id: "c1" }]);
  check("une liaison orpheline est sans effet", dealByContact.size, 0);
}

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
