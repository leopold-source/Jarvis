"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users2 } from "lucide-react";

import { Button, Card, Input, SectionTitle, useToast } from "@/components/ui";
import { setOrgCooldown } from "@/app/(crm)/parametres/dormancy-actions";

/**
 * Le délai de courtoisie entre deux appels dans la même organisation.
 *
 * Un arbitrage commercial, donc réglable : chez un groupe de trois cents
 * personnes, appeler deux directions la même semaine ne choque personne ;
 * chez une PME de quinze, si.
 */
export function OrgCooldownSetting({ days, isAdmin }: { days: number; isAdmin: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState(String(days));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const result = await setOrgCooldown(Number(draft) || 0);
    setBusy(false);
    if (!result.ok) return toast(result.error, "error");
    toast("Délai enregistré.");
    startTransition(() => router.refresh());
  }

  return (
    <Card className="p-5">
      <SectionTitle
        title="Contacts d'une même organisation"
        description="Sous ce délai, ouvrir une fiche affiche qui a déjà été appelé chez le même client"
      />

      <p className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 p-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
        Les leads sont rattachés par domaine e-mail, puis par site, puis par nom d&apos;entreprise —
        et une ligne téléphonique partagée relie deux fiches même lorsque les entreprises diffèrent.
        Rien n&apos;est fusionné ni masqué : en mode prospection, deux fiches d&apos;un même groupe
        ne se suivent simplement jamais dans la file d&apos;appel.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Users2 className="size-4 text-brand-500 dark:text-brand-300" />
        <span className="text-[12.5px]">Signaler un contact chez le même client datant de moins de</span>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!isAdmin || busy}
          inputMode="numeric"
          className="h-7 w-16 text-right text-[12.5px]"
          aria-label="Délai en jours"
        />
        <span className="text-[12.5px]">jours</span>
        {isAdmin && draft !== String(days) ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={save}>
            Enregistrer
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
