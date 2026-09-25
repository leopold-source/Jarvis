"use client";

import { useState } from "react";
import { Send } from "lucide-react";

import { Button, Card, SectionTitle, useToast } from "@/components/ui";
import { envoyerBriefMaintenant } from "@/app/(crm)/parametres/brief-actions";

/** Le récap commercial du matin : ce qu'il contient, et un essai à la demande. */
export function BriefSetting({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [envoi, setEnvoi] = useState(false);

  async function essayer() {
    setEnvoi(true);
    const resultats = await envoyerBriefMaintenant();
    setEnvoi(false);
    const r = resultats[0];
    if (!r) return toast("Aucun destinataire.", "error");
    toast(r.envoye ? `Récap envoyé — ${r.detail}` : r.detail, r.envoye ? undefined : "error");
  }

  return (
    <Card className="p-5">
      <SectionTitle
        title="Récap commercial du matin"
        description="Chaque jour ouvré vers 7 h, un mail commun à toute l'équipe : le cap du jour, le plan de chacun (affaires puis relances de leads, par ordre d'importance), les rendez-vous, les tâches d'équipe, le bilan de la veille et le pipeline. Envoyé depuis la boîte Gmail d'un associé."
      />
      {isAdmin ? (
        <Button variant="secondary" className="mt-4" loading={envoi} onClick={() => void essayer()}>
          <Send className="size-4" />
          Envoyer le récap maintenant
        </Button>
      ) : null}
    </Card>
  );
}
