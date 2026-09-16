"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoonStar, X } from "lucide-react";

import { Badge, Button, Card, Input, SectionTitle, useToast } from "@/components/ui";
import { setLeadDormancy } from "@/app/(crm)/parametres/dormancy-actions";

/**
 * Le seuil au-delà duquel un lead est dit endormi.
 *
 * Éteint tant qu'il n'est pas renseigné, et c'est délibéré. Un défaut
 * implicite — trente jours, disons — aurait marqué des centaines de fiches
 * comme endormies sans que personne l'ait demandé, et la notion se serait
 * découverte en constatant ses effets. Ici, tant que la case est vide, le mot
 * n'existe nulle part dans l'application.
 */
export function LeadDormancySetting({
  days,
  endormis,
  isAdmin,
}: {
  days: number | null;
  endormis: number;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState(days === null ? "" : String(days));
  const [busy, setBusy] = useState(false);

  async function enregistrer(valeur: number | null) {
    setBusy(true);
    const resultat = await setLeadDormancy(valeur);
    setBusy(false);
    if (!resultat.ok) return toast(resultat.error, "error");
    toast(valeur === null ? "Dormance désactivée." : `Seuil réglé à ${valeur} jours.`);
    startTransition(() => router.refresh());
  }

  return (
    <Card className="p-5">
      <SectionTitle
        title="Leads endormis"
        description="Au bout de combien de jours sans changement de statut un lead cesse d'être considéré comme vivant"
      />

      <p className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 p-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
        Un lead endormi n&apos;est ni perdu ni disqualifié : son statut n&apos;a simplement plus
        bougé depuis longtemps. Il garde sa place et reste appelable — il porte seulement une
        marque, et un filtre permet de ne voir que ceux-là quand on veut faire le ménage.
        <span className="mt-1.5 block">
          Tant que ce champ est vide, la notion n&apos;existe pas : aucune fiche n&apos;est
          marquée, aucun filtre n&apos;apparaît.
        </span>
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Désactivé"
          disabled={!isAdmin || busy}
          aria-label="Jours sans changement de statut"
          className="w-32"
        />
        <span className="text-[12.5px] text-[var(--text-muted)]">jours</span>

        <Button
          variant="secondary"
          loading={busy}
          disabled={!isAdmin || draft.trim() === "" || Number(draft) <= 0}
          onClick={() => void enregistrer(Number(draft))}
        >
          Enregistrer
        </Button>

        {/* Éteindre doit être aussi simple qu'allumer : sans ce bouton, il
            faudrait deviner qu'un champ vidé puis enregistré fait l'affaire. */}
        {days !== null ? (
          <Button
            variant="ghost"
            disabled={!isAdmin || busy}
            onClick={() => {
              setDraft("");
              void enregistrer(null);
            }}
          >
            <X className="size-3.5" />
            Désactiver
          </Button>
        ) : null}

        {days !== null ? (
          <Badge tone={endormis > 0 ? "violet" : "stone"}>
            <MoonStar className="size-3" />
            {endormis} endormi{endormis > 1 ? "s" : ""}
          </Badge>
        ) : null}
      </div>

      {!isAdmin ? (
        <p className="mt-3 text-[11.5px] text-[var(--text-muted)]">
          Seul un administrateur peut modifier ce seuil.
        </p>
      ) : null}
    </Card>
  );
}
