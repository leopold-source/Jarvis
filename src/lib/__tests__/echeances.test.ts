/** `npx tsx src/lib/__tests__/echeances.test.ts` — échéances et jours ouvrés. */
import { classerEcheance, estOuvre, joursDeRetard, nomProchainOuvre, precedentOuvre, prochainOuvre } from "@/lib/echeances";

let pass = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`);
}

// 2026-09-25 est un vendredi.
check("vendredi ouvré", estOuvre("2026-09-25"), true);
check("samedi chômé", estOuvre("2026-09-26"), false);
check("après vendredi : lundi", prochainOuvre("2026-09-25"), "2026-09-28");
check("après mardi : mercredi", prochainOuvre("2026-09-22"), "2026-09-23");
check("avant lundi : vendredi", precedentOuvre("2026-09-28"), "2026-09-25");
check("nom : lundi", nomProchainOuvre("2026-09-25"), "Lundi");
check("nom : demain", nomProchainOuvre("2026-09-22"), "Demain");

const vendredi = "2026-09-25";
check("hier = retard", classerEcheance("2026-09-24", vendredi), "retard");
check("aujourd'hui", classerEcheance("2026-09-25", vendredi), "jour");
check("samedi = anticipé", classerEcheance("2026-09-26", vendredi), "prochain");
check("lundi = anticipé le vendredi", classerEcheance("2026-09-28", vendredi), "prochain");
check("mardi = pas encore", classerEcheance("2026-09-29", vendredi), null);
check("sans date", classerEcheance(null, vendredi), null);
check("instant ISO accepté", classerEcheance("2026-09-25T10:00:00Z", vendredi), "jour");
check("retard en jours", joursDeRetard("2026-09-20", vendredi), 5);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
