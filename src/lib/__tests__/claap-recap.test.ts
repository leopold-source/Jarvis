/**
 * Lecture des événements Claap, et règles du mail récap.
 *
 * Sans dépendance de test : `npx tsx src/lib/__tests__/claap-recap.test.ts`.
 * La forme de l'événement reprend celle réellement reçue — tout rangé sous
 * `event.recording` — avec des personnes fictives.
 */
import { composerResume, normalizeClaapPayload } from "@/lib/claap";
import {
  assemblerCorps,
  choisirCall,
  choisirDestinataires,
  corpsEnHtml,
  lireParticipants,
  type CallPourRecap,
} from "@/lib/recap-logique";

let pass = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`);
}

// --- L'événement, tel que Claap l'envoie ------------------------------------

const evenement = {
  event: {
    type: "recording_added",
    recording: {
      id: "Rec123",
      url: "https://app.claap.io/demo-Rec123",
      state: "Ready",
      title: "Acme x Antichaos",
      createdAt: "2026-09-21T12:55:00.000Z",
      durationSeconds: 2133.5,
      meeting: {
        type: "external",
        startingAt: "2026-09-21T13:00:00.000Z",
        endingAt: "2026-09-21T13:30:00.000Z",
        participants: [
          { name: "Romain Navet", attended: false },
          { name: "Jean Dupont", email: "Jean.Dupont@acme.fr", attended: true },
          { name: "Léopold Chrétien", email: "leopold@antichaos.fr", attended: true },
          { name: "Romain Navet", email: "romain@antichaos.fr", attended: true },
        ],
      },
      companies: [{ id: "c1", name: "Acme" }],
      keyTakeaways: [{ text: "Réunion de découverte avec **Jean Dupont**. %[14:36]()" }],
      actionItems: [{ items: [{ description: "Envoyer la présentation", isChecked: false }] }],
      outlines: [{ text: "### Contexte\n- 25 salariés %[15:40]()" }],
      transcripts: [{ url: "https://x/json", textUrl: "https://x/text", isActive: true, isTranscript: true }],
    },
  },
};

const call = normalizeClaapPayload(evenement)!;
check("l'identifiant est trouvé sous event.recording", call.providerCallId, "Rec123");
check("le type d'événement", call.eventType, "recording_added");
check("l'heure exacte du call", call.startedAt, "2026-09-21T13:00:00.000Z");
check("le jour", call.occurredOn, "2026-09-21");
check("la durée en minutes", call.durationMinutes, 36);
check("seul l'externe compte comme interlocuteur", call.externalEmails, ["jean.dupont@acme.fr"]);
check("le lien du transcript texte", call.transcriptUrl, "https://x/text");
check("l'entreprise détectée", call.suggestedCompany, "Acme");
check(
  "les horodatages Claap sont retirés du résumé",
  call.summary?.includes("%["),
  false,
);
check(
  "le résumé garde l'ordre de Claap",
  ["## Points clés", "## Actions", "## Détail"].map((t) => call.summary!.indexOf(t) >= 0),
  [true, true, true],
);
check("un événement sans identifiant est ignoré", normalizeClaapPayload({ event: { type: "x" } }), null);
check(
  "une réunion externe sans adresse connue reste externe",
  normalizeClaapPayload({
    event: {
      recording: {
        id: "R2",
        meeting: { type: "external", participants: [{ email: "leopold@antichaos.fr", attended: true }] },
        companies: [{ id: "c", name: "Client" }],
      },
    },
  })?.externe,
  true,
);
check(
  "le point hebdo entre associés est interne",
  normalizeClaapPayload({
    event: {
      recording: {
        id: "R3",
        meeting: { type: "internal", participants: [{ email: "leopold@antichaos.fr" }, { email: "romain@antichaos.fr" }] },
        companies: [],
      },
    },
  })?.externe,
  false,
);
check(
  "l'ancienne graphie reste lue",
  normalizeClaapPayload({ recordingId: "old1", title: "Vieux" })?.providerCallId,
  "old1",
);
check("pas de résumé quand Claap n'a rien produit", composerResume({ keyTakeaways: [] }), null);

// --- Le choix du call ---------------------------------------------------------

const c = (id: string, started_at: string | null, extra: Partial<CallPourRecap> = {}): CallPourRecap => ({
  id,
  started_at,
  occurred_on: started_at?.slice(0, 10) ?? null,
  transcript: "Bonjour…",
  summary: null,
  has_external: true,
  participants: [],
  ...extra,
});

const geste = "2026-09-21T14:00:00.000Z";
check(
  "le plus récent avant le passage en R2",
  choisirCall([c("r1", "2026-09-10T10:00:00Z"), c("r2", "2026-09-21T13:00:00Z")], geste),
  { etat: "pret", call: c("r2", "2026-09-21T13:00:00Z") },
);
check(
  "un call postérieur au geste n'est pas retenu",
  choisirCall([c("apres", "2026-09-22T09:00:00Z"), c("r2", "2026-09-21T13:00:00Z")], geste).etat === "pret" &&
    (choisirCall([c("apres", "2026-09-22T09:00:00Z"), c("r2", "2026-09-21T13:00:00Z")], geste) as { call: CallPourRecap }).call.id,
  "r2",
);
check(
  "la réunion interne est écartée",
  choisirCall([c("interne", "2026-09-21T13:30:00Z", { has_external: false }), c("r2", "2026-09-21T13:00:00Z")], geste)
    .etat,
  "pret",
);
check(
  "le R1 d'il y a dix jours n'est pas pris pour le R2 : on attend",
  choisirCall([c("r1", "2026-09-10T10:00:00Z")], geste).etat,
  "attente",
);
check(
  "et on signale quand même le plus récent",
  (choisirCall([c("r1", "2026-09-10T10:00:00Z")], geste) as { plusRecent: CallPourRecap }).plusRecent.id,
  "r1",
);
check(
  "le call est là mais pas encore transcrit",
  choisirCall([c("r2", "2026-09-21T13:00:00Z", { transcript: null, summary: null })], geste).etat,
  "en_traitement",
);
check("aucun call", choisirCall([], geste), { etat: "attente", plusRecent: null });
check(
  "la carte déplacée pendant le call",
  choisirCall([c("encours", "2026-09-21T14:10:00Z")], geste).etat,
  "pret",
);

// --- Les destinataires --------------------------------------------------------

const participants = lireParticipants(call.participants);
check(
  "les externes présents en destinataires, l'associé présent en copie",
  choisirDestinataires(participants, "leopold@antichaos.fr", []),
  { to: ["jean.dupont@acme.fr"], cc: ["romain@antichaos.fr"] },
);
check(
  "l'associé absent n'est pas en copie",
  choisirDestinataires(
    lireParticipants([
      { email: "a@client.fr", attended: true },
      { email: "romain@antichaos.fr", attended: false },
    ]),
    "leopold@antichaos.fr",
    [],
  ).cc,
  [],
);
check(
  "l'expéditeur ne se met pas en copie",
  choisirDestinataires(
    lireParticipants([
      { email: "a@client.fr", attended: true },
      { email: "leopold@antichaos.fr", attended: true },
    ]),
    "Leopold@antichaos.fr",
    [],
  ).cc,
  [],
);
check(
  "un invité absent reste proposé s'il est seul",
  choisirDestinataires(lireParticipants([{ email: "a@client.fr", attended: false }]), "leopold@antichaos.fr", []).to,
  ["a@client.fr"],
);
check(
  "l'invité absent n'est pas retenu quand d'autres étaient là",
  choisirDestinataires(
    lireParticipants([
      { email: "a@client.fr", attended: false },
      { email: "b@client.fr", attended: true },
    ]),
    "leopold@antichaos.fr",
    [],
  ).to,
  ["b@client.fr"],
);
check(
  "les calls importés ne gardaient que l'adresse",
  choisirDestinataires(lireParticipants(["x@client.fr"]), "leopold@antichaos.fr", []).to,
  ["x@client.fr"],
);
check(
  "sans participant connu, les interlocuteurs de l'affaire",
  choisirDestinataires([], "leopold@antichaos.fr", ["Contact@Client.fr", "romain@antichaos.fr"]).to,
  ["contact@client.fr"],
);

// --- La structure du mail -----------------------------------------------------

const corps = assemblerCorps({
  salutation: "Bonjour Jean,",
  recap: "Vous déployez l'ERP d'abord.",
  prochaines_etapes: ["- Je vous envoie la présentation", "Vous transmettez au groupe", " "],
});
check(
  "la structure demandée, dans l'ordre",
  corps,
  "Bonjour Jean,\n\nMerci pour cet échange.\n\nRécap du call\nVous déployez l'ERP d'abord.\n\nProchaines étapes\n- Je vous envoie la présentation\n- Vous transmettez au groupe",
);
const html = corpsEnHtml(corps);
check("les intertitres en gras", html.includes("<strong>Récap du call</strong>"), true);
check("les étapes en liste", html.includes("<ul><li>Je vous envoie la présentation</li>"), true);
check("le texte est échappé", corpsEnHtml("<script>").includes("<script>"), false);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
