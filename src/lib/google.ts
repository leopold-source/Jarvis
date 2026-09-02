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

/** Lecture seule sur Gmail, plus l'adresse du compte pour l'afficher. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
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
 * on ne retombe sur l'origine de la requête que faute de mieux.
 */
export function googleRedirectUri(origin: string): string {
  return process.env.GOOGLE_REDIRECT_URI?.trim() || `${origin}/api/google/callback`;
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
    prompt: "consent",
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

async function gmail<T>(path: string, accessToken: string, params?: URLSearchParams): Promise<T> {
  const url = `${GMAIL_BASE}${path}${params ? `?${params}` : ""}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gmail ${response.status} : ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as T;
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
