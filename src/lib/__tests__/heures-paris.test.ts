/**
 * Les heures affichées sont celles de Paris, quelle que soit la machine.
 *
 * Sans dépendance de test : `npx tsx src/lib/__tests__/heures-paris.test.ts`.
 * Le processus est forcé en UTC avant tout import — c'est la situation de
 * Vercel, et c'est celle qui affichait un rendez-vous de quatorze heures à
 * midi. Un test qui tournerait dans le fuseau de Paris ne prouverait rien.
 */
process.env.TZ = "UTC";

import { finDeJourneeParis, formatDate, formatDateHeure, formatHeure } from "@/lib/utils";

let pass = 0,
  fail = 0;
function check(label: string, got: string, want: string) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${got}${ok ? "" : ` (attendu ${want})`}`);
}

// Un instant UTC, rendu en heure d'été : +2.
check("14 h en été", formatHeure("2026-09-16T12:00:00Z"), "14:00");
// Le même, en heure d'hiver : +1.
check("13 h en hiver", formatHeure("2026-01-16T12:00:00Z"), "13:00");
// Google donne ses horodatages avec leur décalage : il doit être respecté.
check("un horodatage Google", formatHeure("2026-09-16T14:30:00+02:00"), "14:30");
// Le cas qui trahit tout : 23 h 30 à Paris, c'est déjà demain à Londres… non,
// c'est encore aujourd'hui, mais 21 h 30 UTC. Le jour ne doit pas reculer.
check("tard le soir", formatDateHeure("2026-09-16T21:30:00Z"), "16/09 23:30");
// Minuit passé à Paris appartient au lendemain, pas à la veille.
check("après minuit", formatDateHeure("2026-09-16T22:30:00Z"), "17/09 00:30");
check("avec l'année", formatDateHeure("2026-09-16T22:30:00Z", { avecAnnee: true }), "17/09/2026 00:30");

// Une date nue n'est pas un instant : elle ne doit pas changer de jour.
check("une date de relance", formatDate("2026-09-16"), "16/09/2026");
check("une date nue, en long", formatDate("2026-09-16", "long"), "16 septembre 2026");
// Un instant, lui, se ramène bien à Paris.
check("un instant tardif", formatDate("2026-09-16T22:30:00Z"), "17/09/2026");

// La fenêtre de l'agenda se ferme à minuit à Paris, pas à minuit UTC.
check("fin de journée, été", finDeJourneeParis(new Date("2026-09-16T10:00:00Z")).toISOString(), "2026-09-16T21:59:59.999Z");
check("fin de journée, hiver", finDeJourneeParis(new Date("2026-01-16T10:00:00Z")).toISOString(), "2026-01-16T22:59:59.999Z");
// Un instant qui appartient déjà au lendemain parisien ferme le lendemain.
check("fin de journée, après minuit", finDeJourneeParis(new Date("2026-09-16T22:30:00Z")).toISOString(), "2026-09-17T21:59:59.999Z");

check("valeur absente", formatHeure(null), "—");
check("valeur illisible", formatDateHeure("pas une date"), "—");

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
