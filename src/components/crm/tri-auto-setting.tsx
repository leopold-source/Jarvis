"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Pause, Play } from "lucide-react";

import { Badge, Button, Card, SectionTitle, useToast } from "@/components/ui";
import { setTriAuto } from "@/app/(crm)/parametres/mail-actions";

/**
 * Suspendre le tri automatique sans perdre l'outil.
 *
 * Ce que l'on veut parfois arrêter, ce n'est pas le tri : c'est qu'une machine
 * touche à la boîte pendant qu'on n'y est pas — une semaine de congés, un
 * changement de consignes qu'on préfère éprouver à la main d'abord. Le bouton
 * « Trier » de l'écran des mails continue donc de fonctionner ; seul le passage
 * quotidien s'arrête.
 */
export function TriAutoSetting({ actif, isAdmin }: { actif: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function basculer() {
    setBusy(true);
    const resultat = await setTriAuto(!actif);
    setBusy(false);
    if (!resultat.ok) return toast(resultat.error, "error");
    toast(actif ? "Tri automatique suspendu." : "Tri automatique réactivé.");
    startTransition(() => router.refresh());
  }

  return (
    <Card className="p-5">
      <SectionTitle
        title="Tri automatique de la boîte mail"
        description="Le passage quotidien qui classe, écarte et prépare les réponses"
        action={
          <Badge tone={actif ? "emerald" : "stone"}>
            <Bot className="size-3" />
            {actif ? "Actif" : "Suspendu"}
          </Badge>
        }
      />

      <p className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 p-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
        Suspendu, plus rien ne bouge tout seul : aucun mail n&apos;est étiqueté, écarté ni archivé,
        et aucun brouillon n&apos;est préparé. Le bouton « Trier » de l&apos;écran des mails
        continue de fonctionner — on suspend l&apos;automatisme, pas l&apos;outil.
        <span className="mt-1.5 block">
          L&apos;historique des passages et les mails déjà triés restent intacts.
        </span>
      </p>

      <Button
        className="mt-4"
        variant={actif ? "secondary" : "primary"}
        loading={busy}
        disabled={!isAdmin}
        onClick={() => void basculer()}
      >
        {actif ? <Pause className="size-4" /> : <Play className="size-4" />}
        {actif ? "Suspendre le tri automatique" : "Réactiver le tri automatique"}
      </Button>

      {!isAdmin ? (
        <p className="mt-3 text-[11.5px] text-[var(--text-muted)]">
          Seul un administrateur peut suspendre le tri.
        </p>
      ) : null}
    </Card>
  );
}
