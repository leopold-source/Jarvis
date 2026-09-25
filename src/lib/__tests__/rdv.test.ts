/** `npx tsx src/lib/__tests__/rdv.test.ts` — retrouver le rendez-vous et l'écrire dans le mail. */
import type { CalendarEvent } from "@/lib/google";
import { dateEnClair, mailConfirmation, phraseProchainRdv, plusTot, rdvAvec } from "@/lib/rdv-logique";
import { depuisSaisieParis, versSaisieParis } from "@/lib/utils";

let pass = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`);
}

const maintenant = Date.parse("2026-09-25T08:00:00Z");
const ev = (id: string, debut: string, invites: string[], extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  summary: `RDV ${id}`,
  start: { dateTime: debut },
  end: { dateTime: debut },
  attendees: invites.map((email) => ({ email })),
  ...extra,
});

const events = [
  ev("passe", "2026-09-24T10:00:00+02:00", ["paul@acme.fr"]),
  ev("autre", "2026-09-26T10:00:00+02:00", ["jean@autre.fr"]),
  ev("bon", "2026-10-02T14:00:00+02:00", ["Paul@Acme.fr", "leo@antichaos.fr"], { hangoutLink: "https://meet.google.com/abc" }),
  ev("plus-tard", "2026-10-09T14:00:00+02:00", ["paul@acme.fr"]),
  ev("refuse", "2026-09-30T09:00:00+02:00", [], { attendees: [{ email: "paul@acme.fr", responseStatus: "declined" }] }),
  { id: "journee", start: { date: "2026-09-29" }, attendees: [{ email: "paul@acme.fr" }] },
];

const trouve = rdvAvec(events, ["paul@acme.fr"], maintenant, "leo@antichaos.fr");
check("le premier à venir, casse ignorée", trouve?.titre, "RDV bon");
check("lien Meet repris", trouve?.visio, "https://meet.google.com/abc");
check("agenda noté", trouve?.agenda, "leo@antichaos.fr");
check("aucune correspondance → rien", rdvAvec(events, ["inconnu@x.fr"], maintenant), null);
check("sans adresse → rien", rdvAvec(events, [""], maintenant), null);
check(
  "organisateur compte aussi",
  rdvAvec([{ id: "o", start: { dateTime: "2026-10-01T09:00:00+02:00" }, organizer: { email: "paul@acme.fr" } }], ["paul@acme.fr"], maintenant)?.debut,
  "2026-10-01T09:00:00+02:00",
);
check(
  "plusTot entre agendas",
  plusTot([null, { ...trouve!, debut: "2026-10-05T10:00:00Z" }, trouve])?.titre,
  "RDV bon",
);

check("date en clair, heure de Paris", dateEnClair("2026-10-02T12:00:00Z"), "vendredi 2 octobre à 14h00");
check("date en clair, heure d'hiver", dateEnClair("2026-12-03T09:30:00Z"), "jeudi 3 décembre à 10h30");

const avec = mailConfirmation({ prenom: "Paul", rdv: { debut: "2026-10-02T12:00:00Z", visio: "https://meet.google.com/abc" } });
check("objet daté", avec.subject, "Confirmation de notre rendez-vous du vendredi 2 octobre à 14h00");
check("salutation", avec.body.split("\n")[0], "Bonjour Paul,");
check("date et lien dans le corps", avec.body.includes("rendez-vous le vendredi 2 octobre à 14h00.\nLe lien de la visio : https://meet.google.com/abc"), true);
const sans = mailConfirmation({ prenom: null, rdv: null });
check("sans date : pas de date inventée", /\d/.test(sans.body), false);
check("sans prénom", sans.body.startsWith("Bonjour,"), true);

check("phrase R2", phraseProchainRdv({ debut: "2026-10-02T12:00:00Z", visio: null }, false), "Je vous confirme notre prochain rendez-vous le vendredi 2 octobre à 14h00.");
check("phrase R2 tutoiement + visio", phraseProchainRdv({ debut: "2026-10-02T12:00:00Z", visio: "https://m" }, true), "Je te confirme notre prochain rendez-vous le vendredi 2 octobre à 14h00 (visio : https://m).");
check("phrase R2 sans rdv", phraseProchainRdv(null, false), null);

check("saisie Paris, été", versSaisieParis("2026-10-02T12:00:00Z"), "2026-10-02T14:00");
check("saisie Paris, hiver", versSaisieParis("2026-12-03T09:30:00Z"), "2026-12-03T10:30");
check("retour ISO, été", depuisSaisieParis("2026-10-02T14:00"), "2026-10-02T12:00:00.000Z");
check("retour ISO, hiver", depuisSaisieParis("2026-12-03T10:30"), "2026-12-03T09:30:00.000Z");
check("retour ISO, invalide", depuisSaisieParis(""), null);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
