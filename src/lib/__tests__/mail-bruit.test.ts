/** `npx tsx src/lib/__tests__/mail-bruit.test.ts` — objets réels relevés dans le fil des affaires. */
import { estNotificationAgenda } from "@/lib/mail-bruit";

let pass = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${got}${ok ? "" : ` (attendu ${want})`}`);
}
const n = (subject: string, from = "x@client.fr") => estNotificationAgenda({ subject, from });

check("invitation", n("Invitation: NCA x Antichaos - ven. 25 sept. 2026 2:15pm"), true);
check("acceptation, espace avant les deux-points", n("Accepté : NCA x Antichaos"), true);
check("acceptation sans espace", n("Accepté: Intervention IA - visio - mar. 29 sept."), true);
check("refus", n("Refusé : Rodolphe / Léopold - IA "), true);
check("nouvel horaire", n("Nouvel horaire proposé: Nicolas / Léopold Antichaos"), true);
check("en anglais", n("Updated invitation: Kickoff"), true);
check("annulation", n("Événement annulé : Point projet"), true);
check("notification de l'agenda", estNotificationAgenda({ subject: "Rappel", from: "calendar-notification@google.com" }), true);
check("la réponse écrite à une invitation reste", n("Re: Refusé : Rodolphe / Léopold - IA"), false);
check("un vrai échange reste", n("Re: Suite à la formation"), false);
check("une facture reste", n("Facture deuxième partie formation"), false);
check("le mot en milieu d'objet ne compte pas", n("Suite à votre invitation: merci"), false);
check("sans objet", n(""), false);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
