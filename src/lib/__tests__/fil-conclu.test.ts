/**
 * Un fil auquel on a déjà répondu.
 *
 * `npx tsx src/lib/__tests__/fil-conclu.test.ts`. Le défaut d'origine tenait à
 * ce que le tri ne regardait jamais le fil : Gmail laisse un message dans la
 * boîte de réception une fois qu'on y a répondu, et l'IA préparait chaque matin
 * une réponse à une conversation close la veille.
 */
import { filConclu } from "@/lib/google";
import type { GmailMessage } from "@/lib/google";

let pass = 0, fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`);
}

const MOI = "leopold@antichaos.fr";
const T = (jour: number) => String(Date.parse(`2026-09-${String(jour).padStart(2, "0")}T10:00:00Z`));

const msg = (de: string, jour: number): GmailMessage =>
  ({
    id: `m${jour}`,
    internalDate: T(jour),
    payload: { headers: [{ name: "From", value: de }] },
  }) as unknown as GmailMessage;

const RECU = Number(T(10));

console.log("--- fil conclu ---");

check(
  "j'ai répondu après le message",
  filConclu([msg("client@bm2s.fr", 10), msg(`Léopold <${MOI}>`, 11)], MOI, RECU),
  true,
);

check(
  "personne n'a répondu",
  filConclu([msg("client@bm2s.fr", 10)], MOI, RECU),
  false,
);

// Le piège : dans un fil où l'on a écrit en premier, la réponse du client est
// le dernier mot. Se contenter de chercher une trace de soi dirait le contraire.
check(
  "j'ai écrit avant, le client a répondu ensuite",
  filConclu([msg(`Léopold <${MOI}>`, 9), msg("client@bm2s.fr", 10)], MOI, RECU),
  false,
);

check(
  "un collègue a répondu, pas moi",
  filConclu([msg("client@bm2s.fr", 10), msg("romain@antichaos.fr", 11)], MOI, RECU),
  false,
);

check(
  "la casse de l'adresse n'a pas d'importance",
  filConclu([msg("client@bm2s.fr", 10), msg("LEOPOLD@Antichaos.FR", 11)], MOI, RECU),
  true,
);

check(
  "un message sans date ne conclut rien",
  filConclu([{ id: "x", payload: { headers: [{ name: "From", value: MOI }] } } as unknown as GmailMessage], MOI, RECU),
  false,
);

check("un fil vide ne conclut rien", filConclu([], MOI, RECU), false);
check("sans boîte connue, on ne conclut rien", filConclu([msg(MOI, 11)], "", RECU), false);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
