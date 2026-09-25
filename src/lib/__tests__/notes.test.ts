/** `npx tsx src/lib/__tests__/notes.test.ts` — notes de rendez-vous. */
import { htmlEnTexte, noteVide, resumeEnHtml, trameHtml } from "@/lib/notes-logique";

let pass = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`);
}

check(
  "titres, puces, cases, entités",
  htmlEnTexte(
    '<h3>Besoins</h3><ul><li><p>Automatiser les <strong>devis</strong> &amp; relances</p></li></ul><ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked></label><div><p>Envoyer la propale</p></div></li><li data-checked="false"><div><p>Rappeler</p></div></li></ul><p>Budget &lt; 10 k€</p>',
  ),
  "## Besoins\n- Automatiser les devis & relances\n- [x] Envoyer la propale\n- [ ] Rappeler\nBudget < 10 k€",
);
check("vide", htmlEnTexte(null), "");
check("trame vide = note vide", noteVide(trameHtml("r1")), true);
check("note remplie", noteVide("<h3>Contexte</h3><ul><li><p>PME 40 p.</p></li></ul>"), false);
check(
  "résumé Claap en HTML",
  resumeEnHtml("Call du 24/09", "## Points clés\n- Besoin <IA>\n- Budget 5k\nSuite : démo"),
  "<h3>Call du 24/09</h3><p><strong>Points clés</strong></p><ul><li><p>Besoin &lt;IA&gt;</p></li><li><p>Budget 5k</p></li></ul><p>Suite : démo</p>",
);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
