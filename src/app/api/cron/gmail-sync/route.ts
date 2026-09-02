import { NextResponse, type NextRequest } from "next/server";

import { syncAllGoogleAccounts } from "@/lib/gmail-sync";
import { runSuggestions } from "@/app/(crm)/suggestions-actions";

/**
 * Routine du matin, une fois par jour (voir vercel.json) : synchronisation
 * Gmail, puis préparation des suggestions du jour.
 *
 * Le coût réel — quelques appels à l'API Gmail par compte connecté — est
 * négligeable à n'importe quelle fréquence ; c'est la limite de Vercel qui
 * fixe le rythme (un cron par jour sur le plan Hobby). Un passage quotidien,
 * tôt le matin, reste largement suffisant pour un usage commercial : les
 * échanges de la veille sont rattachés avant la première relance du jour.
 *
 * Vercel signe ses propres invocations d'un `Authorization: Bearer
 * <CRON_SECRET>` dès que cette variable est définie ; on la vérifie pour que
 * la route ne puisse pas être déclenchée depuis l'extérieur.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // La synchro d'abord : les suggestions du jour lisent le CRM, autant qu'il
  // soit à jour des échanges de la veille au moment où on les prépare.
  const sync = await syncAllGoogleAccounts();
  const suggestions = await runSuggestions(true);

  return NextResponse.json({
    sync,
    suggestions: suggestions.ok ? "ok" : suggestions.error,
  });
}
