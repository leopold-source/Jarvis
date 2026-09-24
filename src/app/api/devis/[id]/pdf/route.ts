import { NextResponse } from "next/server";

import { getProfile } from "@/lib/auth";
import { lirePennylane } from "@/lib/pennylane";

/**
 * Le PDF d'un devis, tel que Pennylane l'a mis en page.
 *
 * Pennylane ne donne qu'un lien signé qui expire au bout d'une demi-heure :
 * on le redemande à chaque ouverture et on relaie le fichier, affiché dans la
 * page plutôt que téléchargé. Juste après la création, le PDF peut ne pas être
 * prêt ; une petite page d'attente se recharge alors d'elle-même.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile();
  if (!profile || profile.role === "client") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const devis = await lirePennylane<{ public_file_url?: string | null; filename?: string | null }>(
    `/quotes/${encodeURIComponent(id)}`,
  );
  if (!devis.ok) return NextResponse.json({ error: devis.error }, { status: devis.status || 502 });

  const lien = devis.data?.public_file_url;
  const fichier = lien ? await fetch(lien, { signal: AbortSignal.timeout(20_000) }).catch(() => null) : null;
  if (!fichier?.ok) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3">
<body style="font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#777">
Pennylane prépare le PDF…</body>`,
      { status: 202, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    );
  }

  const nom = (devis.data?.filename || `devis-${id}.pdf`).replace(/[^\w.\- ]/g, "_");
  return new Response(fichier.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nom}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
