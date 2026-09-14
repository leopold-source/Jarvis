"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

/**
 * Récupère une session laissée dans le fragment de l'adresse.
 *
 * Supabase envoie deux formes de liens. La forme moderne porte un code dans la
 * requête — `?code=…` — et c'est celle que `/auth/callback` sait échanger. Mais
 * dès que l'adresse de redirection demandée n'est pas dans la liste autorisée
 * du projet, le service retombe sur l'ancienne : il renvoie vers l'URL du site
 * en collant les jetons derrière un dièse, `#access_token=…&type=magiclink`.
 *
 * Ce fragment n'est jamais envoyé au serveur — c'est la règle du dièse — donc
 * aucune route ne peut le voir. Il y avait là un trou : le lien était valide,
 * la session était dans la barre d'adresse, et l'application renvoyait vers
 * l'écran de connexion sans rien en faire.
 *
 * Le fragment survit aux redirections, y compris celle qui mène ici. Le
 * consommer sur cette page rattrape donc les deux cas d'un coup — celui où le
 * lien vise la racine et celui où il vise déjà la connexion. On efface ensuite
 * le fragment de l'historique : un jeton de session n'a rien à faire dans une
 * adresse qu'on peut recopier.
 */
export function LienFragment() {
  const router = useRouter();
  const [etat, setEtat] = useState<"repos" | "ouverture" | "echec">("repos");

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (!fragment.includes("access_token")) return;

    const params = new URLSearchParams(fragment);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) return;

    setEtat("ouverture");

    void createClient()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => {
        // Le jeton disparaît de la barre d'adresse dans tous les cas : qu'il
        // ait servi ou non, il ne doit pas rester derrière.
        window.history.replaceState(null, "", window.location.pathname + window.location.search);

        if (error) {
          setEtat("echec");
          return;
        }

        const suite = new URLSearchParams(window.location.search).get("suite");
        router.replace(suite?.startsWith("/") ? suite : "/");
        // `refresh` parce que la session vit désormais dans un cookie que seul
        // le serveur peut lire : sans cela, la page suivante serait rendue
        // comme si personne n'était connecté.
        router.refresh();
      });
  }, [router]);

  if (etat === "repos") return null;

  return (
    <p
      className={
        etat === "echec"
          ? "mb-4 rounded-lg bg-rose-500/10 px-3 py-2 text-center text-[12.5px] text-rose-400 ring-1 ring-rose-500/25"
          : "mb-4 flex items-center justify-center gap-2 text-center text-[12.5px] text-[var(--text-muted)]"
      }
    >
      {etat === "echec" ? (
        "Ce lien de connexion a expiré. Demandez-en un nouveau ci-dessous."
      ) : (
        <>
          <Loader2 className="size-3.5 animate-spin" />
          Connexion en cours…
        </>
      )}
    </p>
  );
}
