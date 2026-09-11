import { NextResponse, type NextRequest } from "next/server";

import { syncAllGoogleAccounts } from "@/lib/gmail-sync";
import { trierToutesLesBoites } from "@/lib/mail-triage";
import { envoyerBriefs } from "@/lib/brief-matinal";
import { runSuggestions } from "@/app/(crm)/suggestions-actions";

/**
 * Routine du matin, une fois par jour (voir vercel.json) : synchronisation
 * Gmail, tri de la boîte de réception, puis préparation des suggestions.
 *
 * Le coût réel — quelques appels à l'API Gmail par compte connecté — est
 * négligeable à n'importe quelle fréquence ; c'est la limite de Vercel qui
 * fixe le rythme (un cron par jour sur le plan Hobby). Un passage quotidien,
 * tôt le matin, reste largement suffisant pour un usage commercial : les
 * échanges de la veille sont rattachés avant la première relance du jour.
 *
 * Vercel signe ses propres invocations d'un `Authorization: Bearer
 * <CRON_SECRET>`.
 *
 * La vérification refuse quand le secret est ABSENT, et pas seulement quand il
 * est faux. La logique inverse — ne contrôler que si la variable existe —
 * paraît accommodante et laisse en réalité la route grande ouverte tant que
 * personne n'a pensé à la renseigner. Or celle-ci met des mails à la corbeille,
 * crée des brouillons et dépense chez Anthropic : il vaut mille fois mieux
 * qu'elle échoue bruyamment que de tourner pour un inconnu.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    return NextResponse.json(
      {
        error: "CRON_SECRET absente",
        detail:
          "Cette route agit sur la boîte mail et appelle un modèle payant. " +
          "Renseignez CRON_SECRET dans les variables d'environnement Vercel.",
      },
      { status: 503 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // La synchro d'abord : les suggestions du jour lisent le CRM, autant qu'il
  // soit à jour des échanges de la veille au moment où on les prépare.
  const sync = await syncAllGoogleAccounts();

  // Le tri vient après la synchro : il interroge le CRM pour savoir quels
  // expéditeurs sont connus, et cette liste doit inclure les échanges de la
  // veille — c'est elle qui empêche un client de partir à la corbeille.
  const tri = await trierToutesLesBoites();

  const suggestions = await runSuggestions(true);

  // Le brief part en dernier : il résume tout ce qui précède, y compris les
  // suggestions du jour, et ne serait qu'à moitié juste s'il partait avant.
  const briefs = await envoyerBriefs();

  return NextResponse.json({
    sync,
    tri,
    suggestions: suggestions.ok ? "ok" : suggestions.error,
    briefs,
  });
}
