import { NextResponse, type NextRequest } from "next/server";

import { syncAllGoogleAccounts } from "@/lib/gmail-sync";

/**
 * Synchronisation planifiée, une fois par jour (voir vercel.json).
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

  const result = await syncAllGoogleAccounts();
  return NextResponse.json(result);
}
