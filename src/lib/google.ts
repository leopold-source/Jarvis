/**
 * Couche OAuth et Gmail.
 *
 * Appels directs en `fetch` plutôt que le SDK `googleapis` : on n'a besoin que
 * de quatre points d'entrée, et la dépendance pèse plus lourd que le code
 * qu'elle remplacerait.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Ce que l'application demande à Gmail.
 *
 * `modify` couvre les étiquettes et la mise à la corbeille ; `compose` couvre
 * les brouillons et leur envoi. Ni l'un ni l'autre ne permet la suppression
 * définitive — Google ne l'accorde qu'avec le périmètre complet, qu'on ne
 * demande pas. Un mail écarté à tort reste donc récupérable trente jours, ce
 * qui est exactement la garantie qu'on veut avant de laisser un modèle trier.
 *
 * Ce sont des périmètres « restreints » : pour une application publique,
 * Google impose un audit de sécurité. L'écran de consentement étant configuré
 * en Interne sur le Workspace antichaos.fr, cet audit ne s'applique pas.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  // Lecture seule sur l'agenda : afficher les rendez-vous du jour n'exige pas
  // le droit d'en créer, et un jeton qui peut écrire dans un calendrier est un
  // jeton qui peut effacer une réunion.
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export type GoogleCredentials = { clientId: string; clientSecret: string };

export function googleCredentials(): GoogleCredentials | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * URI de retour. Google exige une correspondance exacte avec ce qui est
 * déclaré dans la console : on privilégie donc la variable d'environnement, et
 * on ne retombe sur l'origine de la requête que faute de mieux — en retirant
 * un éventuel `www.`, puisque seul le domaine nu est déclaré côté Google et
 * qu'un visiteur peut atterrir sur l'un ou l'autre selon les redirections DNS.
 */
export function googleRedirectUri(origin: string): string {
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (configured) return configured;
  const bare = origin.replace(/^(https?:\/\/)www\./, "$1");
  return `${bare}/api/google/callback`;
}

export function googleAuthorizeUrl(redirectUri: string, state: string): string {
  const credentials = googleCredentials();
  if (!credentials) throw new Error("Identifiants Google absents.");

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    // Indispensables pour obtenir un refresh_token, et le réobtenir si
    // l'utilisateur reconnecte un compte déjà autorisé.
    access_type: "offline",
    // `select_account` force le sélecteur même quand une seule session Google
    // est active dans le navigateur, indispensable si le compte par défaut
    // n'est pas celui à connecter (ex. un Gmail personnel plutôt que le
    // compte professionnel attendu par un écran de consentement Interne).
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const credentials = googleCredentials();
  if (!credentials) throw new Error("Identifiants Google absents.");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...body,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error_description ?? payload.error ?? "Échange de jeton refusé.");
  }
  return payload as TokenResponse;
}

export function exchangeCode(code: string, redirectUri: string) {
  return postToken({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
}

export function refreshAccessToken(refreshToken: string) {
  return postToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
}

export async function revokeToken(token: string): Promise<void> {
  // Une révocation qui échoue ne doit pas empêcher de retirer la ligne en base :
  // l'utilisateur peut toujours retirer l'accès depuis son compte Google.
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    /* sans conséquence */
  }
}

/** Adresse du compte autorisé, pour savoir qui écrit et qui reçoit. */
export async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Impossible de lire l'adresse du compte Google.");
  const payload = (await response.json()) as { email?: string };
  if (!payload.email) throw new Error("Le compte Google n'expose pas d'adresse e-mail.");
  return payload.email;
}

/* ------------------------------------------------------------------ Gmail */

export type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
};

export type GmailMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};

async function gmail<T>(
  path: string,
  accessToken: string,
  params?: URLSearchParams,
  init?: { method: "POST" | "PUT"; body: unknown },
): Promise<T> {
  const url = `${GMAIL_BASE}${path}${params ? `?${params}` : ""}`;
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init ? { "Content-Type": "application/json" } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gmail ${response.status} : ${detail.slice(0, 200)}`);
  }
  // Certaines écritures répondent 204 sans corps.
  const texte = await response.text();
  return (texte ? JSON.parse(texte) : {}) as T;
}

export function listMessages(accessToken: string, query: string, pageToken?: string) {
  const params = new URLSearchParams({ q: query, maxResults: "100" });
  if (pageToken) params.set("pageToken", pageToken);
  return gmail<GmailListResponse>("/messages", accessToken, params);
}

/** En-têtes seuls : suffisant pour rattacher un échange, sans aspirer les corps. */
export function getMessage(accessToken: string, id: string) {
  const params = new URLSearchParams({ format: "metadata" });
  for (const header of ["From", "To", "Cc", "Subject", "Date"]) {
    params.append("metadataHeaders", header);
  }
  return gmail<GmailMessage>(`/messages/${id}`, accessToken, params);
}

/* ---------------------------------------------------------- Utilitaires */

export function header(message: GmailMessage, name: string): string {
  const found = message.payload?.headers?.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? "";
}

/** Extrait les adresses d'un en-tête « Nom <adresse>, autre@exemple.fr ». */
export function parseAddresses(value: string): string[] {
  const matches = value.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g);
  return matches ? matches.map((address) => address.toLowerCase()) : [];
}

/* ------------------------------------------------- Gmail : lecture du corps */

export type GmailPart = {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};

export type GmailFullMessage = GmailMessage & {
  labelIds?: string[];
  payload?: GmailMessage["payload"] & GmailPart;
};

export function getFullMessage(accessToken: string, id: string) {
  return gmail<GmailFullMessage>(`/messages/${id}`, accessToken, new URLSearchParams({ format: "full" }));
}

function decodeBase64Url(data: string): string {
  const normalise = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalise, "base64").toString("utf8");
}

/**
 * Le texte d'un message, aplati.
 *
 * On préfère `text/plain` au HTML : la version texte dit la même chose en dix
 * fois moins de jetons, et un mail commercial en HTML est surtout composé de
 * styles qui n'apprennent rien au modèle. À défaut, on détricote grossièrement
 * le HTML — mieux vaut un texte imparfait qu'un message vide.
 */
export function messageText(message: GmailFullMessage, maxChars = 4000): string {
  const morceaux: { plain: string[]; html: string[] } = { plain: [], html: [] };

  const parcourir = (part?: GmailPart) => {
    if (!part) return;
    const data = part.body?.data;
    if (data) {
      if (part.mimeType === "text/plain") morceaux.plain.push(decodeBase64Url(data));
      else if (part.mimeType === "text/html") morceaux.html.push(decodeBase64Url(data));
    }
    part.parts?.forEach(parcourir);
  };
  parcourir(message.payload as GmailPart);

  const brut =
    morceaux.plain.join("\n").trim() ||
    morceaux.html
      .join("\n")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();

  // Les citations du fil précédent n'apportent rien au classement et coûtent
  // cher : on coupe à la première ligne de reprise.
  const sansCitation = brut.split(/^\s*(?:>|Le .+ a écrit\s*:|-{2,}\s*Message d'origine)/m)[0];

  return sansCitation.replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
}

/* ------------------------------------------------ Gmail : étiquettes, corbeille */

export type GmailLabel = { id: string; name: string };

/**
 * Retourne l'identifiant de l'étiquette, en la créant à la première utilisation.
 *
 * La création peut échouer alors que tout va bien : Gmail réserve certains noms
 * et refuse un doublon créé entre-temps. Comme cette fonction est appelée au
 * début du tri, l'erreur emporterait tout le passage — on relit donc la liste
 * avant d'abandonner.
 */
export async function ensureLabel(accessToken: string, name: string): Promise<string> {
  const trouver = async () => {
    const { labels } = await gmail<{ labels?: GmailLabel[] }>("/labels", accessToken);
    return labels?.find((label) => label.name.toLowerCase() === name.toLowerCase())?.id ?? null;
  };

  const existante = await trouver();
  if (existante) return existante;

  try {
    const creee = await gmail<GmailLabel>("/labels", accessToken, undefined, {
      method: "POST",
      body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
    });
    return creee.id;
  } catch (caught) {
    const seconde = await trouver();
    if (seconde) return seconde;
    throw caught;
  }
}

export function addLabel(accessToken: string, messageId: string, labelId: string) {
  return gmail<unknown>(`/messages/${messageId}/modify`, accessToken, undefined, {
    method: "POST",
    body: { addLabelIds: [labelId] },
  });
}

/**
 * Mise à la corbeille — jamais `delete`.
 *
 * L'API expose bien une suppression définitive ; on ne l'appelle pas, et le
 * périmètre demandé ne l'autoriserait pas de toute façon. Un classement erroné
 * doit rester rattrapable.
 */
export function trashMessage(accessToken: string, messageId: string) {
  return gmail<unknown>(`/messages/${messageId}/trash`, accessToken, undefined, {
    method: "POST",
    body: {},
  });
}

/* ---------------------------------------------------- Gmail : brouillons */

export type GmailDraft = { id: string; message?: { id: string; threadId: string } };

/**
 * Compose un message RFC 2822 encodé pour Gmail.
 *
 * `In-Reply-To` et `References` sont ce qui fait qu'une réponse se range dans
 * le bon fil plutôt que d'ouvrir une conversation parallèle chez le
 * destinataire. Les omettre passerait inaperçu de notre côté et serait visible
 * du sien.
 */
function composeRaw({
  to,
  subject,
  body,
  inReplyTo,
}: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string | null;
}): string {
  // Un sujet non-ASCII doit être encodé, sinon Gmail le tronque aux accents.
  const sujet = /^[\x20-\x7E]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;

  const lignes = [
    `To: ${to}`,
    `Subject: ${sujet}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    "",
    Buffer.from(body, "utf8").toString("base64"),
  ];

  return Buffer.from(lignes.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function createDraft(
  accessToken: string,
  options: { to: string; subject: string; body: string; threadId?: string | null; inReplyTo?: string | null },
) {
  return gmail<GmailDraft>("/drafts", accessToken, undefined, {
    method: "POST",
    body: {
      message: {
        raw: composeRaw(options),
        ...(options.threadId ? { threadId: options.threadId } : {}),
      },
    },
  });
}

export function updateDraft(
  accessToken: string,
  draftId: string,
  options: { to: string; subject: string; body: string; threadId?: string | null; inReplyTo?: string | null },
) {
  return gmail<GmailDraft>(`/drafts/${draftId}`, accessToken, undefined, {
    method: "PUT",
    body: {
      id: draftId,
      message: {
        raw: composeRaw(options),
        ...(options.threadId ? { threadId: options.threadId } : {}),
      },
    },
  });
}

/** Envoie un brouillon existant. Seul geste de cette couche qui sorte du domaine. */
export function sendDraft(accessToken: string, draftId: string) {
  return gmail<{ id: string; threadId: string }>("/drafts/send", accessToken, undefined, {
    method: "POST",
    body: { id: draftId },
  });
}

/* ------------------------------------------------------ Google Agenda */

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

export type CalendarEvent = {
  id: string;
  summary?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; self?: boolean }>;
  organizer?: { email?: string; displayName?: string };
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
};

/**
 * Les rendez-vous d'une fenêtre de temps, sur l'agenda principal.
 *
 * `singleEvents` développe les récurrences en occurrences réelles : sans lui,
 * un point hebdomadaire renverrait sa règle de répétition et non la réunion de
 * ce matin. `orderBy=startTime` n'est d'ailleurs accepté qu'avec.
 */
export async function listCalendarEvents(
  accessToken: string,
  from: Date,
  to: Date,
  max = 12,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(max),
  });

  const response = await fetch(`${CALENDAR_BASE}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Agenda ${response.status} : ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as { items?: CalendarEvent[] };
  // Une invitation refusée reste dans la liste : l'afficher ferait croire à un
  // rendez-vous qui n'aura pas lieu.
  return (payload.items ?? []).filter((event) => {
    if (event.status === "cancelled") return false;
    const moi = event.attendees?.find((invite) => invite.self);
    return moi?.responseStatus !== "declined";
  });
}

/** Le lien de visioconférence, quel que soit l'endroit où Google l'a rangé. */
export function eventVideoLink(event: CalendarEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const entree = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
  return entree?.uri ?? null;
}

/**
 * Sort un message de la corbeille.
 *
 * Le pendant indispensable de `trashMessage` : proposer d'écarter un mail sans
 * offrir de le récupérer reviendrait à ne pas assumer que le tri se trompe.
 */
export function untrashMessage(accessToken: string, messageId: string) {
  return gmail<unknown>(`/messages/${messageId}/untrash`, accessToken, undefined, {
    method: "POST",
    body: {},
  });
}

/**
 * Sort un message de la boîte de réception sans l'effacer.
 *
 * Gmail n'a pas de dossier « archive » : ranger consiste à retirer l'étiquette
 * INBOX, ce qui fait disparaître le message de la boîte tout en le laissant
 * dans « Tous les messages » et sous ses propres étiquettes.
 */
export function archiveMessage(accessToken: string, messageId: string) {
  return gmail<unknown>(`/messages/${messageId}/modify`, accessToken, undefined, {
    method: "POST",
    body: { removeLabelIds: ["INBOX"] },
  });
}
