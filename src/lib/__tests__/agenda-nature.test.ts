/**
 * Ce qui mérite d'apparaître comme un rendez-vous.
 *
 * Sans dépendance de test : `npx tsx src/lib/__tests__/agenda-nature.test.ts`.
 * Les cas viennent de l'agenda réel — un « miam miam » à midi, une « lecture »
 * le soir, et le rendez-vous client noté à la main qu'il ne faut surtout pas
 * confondre avec eux.
 */
import { estUnVraiRendezVous } from "@/lib/agenda-nature";
import type { CalendarEvent } from "@/lib/google";

let pass = 0, fail = 0;
function check(label: string, got: boolean, want: boolean) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${got}${ok ? "" : ` (attendu ${want})`}`);
}

let seq = 0;
function event(partial: Partial<CalendarEvent> = {}): CalendarEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    summary: "Événement",
    start: { dateTime: "2026-09-11T12:00:00+02:00" },
    end: { dateTime: "2026-09-11T13:00:00+02:00" },
    organizer: { email: "leopold@antichaos.fr", self: true },
    ...partial,
  };
}

console.log("--- les créneaux qu'il se réserve ---");

// Le cas qui a motivé tout ceci : un midi bloqué toutes les semaines.
check(
  "« miam miam », répété, seul, sans lieu",
  estUnVraiRendezVous(event({ summary: "Miam miam", recurringEventId: "r1" })),
  false,
);

check(
  "« lecture » le soir",
  estUnVraiRendezVous(event({ summary: "Lecture", recurringEventId: "r2" })),
  false,
);

// Un bloc de travail ponctuel : pas un rendez-vous non plus, et c'est voulu.
check(
  "un bloc de travail ponctuel et sans lieu",
  estUnVraiRendezVous(event({ summary: "Préparer la propale Auddice" })),
  false,
);

check(
  "une journée entière posée seul",
  estUnVraiRendezVous(
    event({ summary: "Congé", start: { date: "2026-09-14" }, end: { date: "2026-09-15" } }),
  ),
  false,
);

// Un invité qui a décliné ne fait pas un rendez-vous : il n'y a plus personne.
check(
  "le seul invité a décliné",
  estUnVraiRendezVous(
    event({
      summary: "Point",
      attendees: [
        { email: "leopold@antichaos.fr", self: true, responseStatus: "accepted" },
        { email: "absent@client.fr", responseStatus: "declined" },
      ],
    }),
  ),
  false,
);

console.log("\n--- les vrais rendez-vous ---");

check(
  "un invité extérieur",
  estUnVraiRendezVous(
    event({
      summary: "Cadrage",
      attendees: [
        { email: "leopold@antichaos.fr", self: true },
        { email: "dg@bm2s.fr", responseStatus: "accepted" },
      ],
    }),
  ),
  true,
);

check(
  "un Meet, même sans invité listé",
  estUnVraiRendezVous(event({ summary: "Démo", hangoutLink: "https://meet.google.com/abc" })),
  true,
);

check(
  "une visio rangée dans conferenceData",
  estUnVraiRendezVous(
    event({
      summary: "Atelier",
      conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/x" }] },
    }),
  ),
  true,
);

// Une invitation acceptée engage envers quelqu'un, même si Google n'a renvoyé
// aucune liste d'invités.
check(
  "invité par quelqu'un d'autre",
  estUnVraiRendezVous(
    event({ summary: "Kickoff", organizer: { email: "contact@auddice.fr", self: false } }),
  ),
  true,
);

// Le cas fragile : noté à la main, sans invité ni visio. C'est l'adresse qui
// le sauve, et la non-répétition qui le distingue d'une habitude.
check(
  "un rendez-vous client noté à la main, avec une adresse",
  estUnVraiRendezVous(event({ summary: "RDV BM2S", location: "12 rue de la Part-Dieu, Lyon" })),
  true,
);

check(
  "un lieu répété reste une habitude",
  estUnVraiRendezVous(
    event({ summary: "Sport", location: "Basic Fit République", recurringEventId: "r3" }),
  ),
  false,
);

// Un point hebdomadaire est répété, mais il a du monde : la répétition ne
// disqualifie jamais à elle seule.
check(
  "le point hebdo avec Romain",
  estUnVraiRendezVous(
    event({
      summary: "Point Antichaos",
      recurringEventId: "r4",
      attendees: [
        { email: "leopold@antichaos.fr", self: true },
        { email: "romain@antichaos.fr", responseStatus: "accepted" },
      ],
    }),
  ),
  true,
);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
