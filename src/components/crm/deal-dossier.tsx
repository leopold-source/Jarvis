"use client";

import { useEffect, useState } from "react";
import { Banknote, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui";
import { DOSSIER_STATUS } from "@/lib/constants";
import type { Dossier } from "@/lib/database.types";
import { DossierPanel } from "@/components/crm/dossier-panel";
import { fetchDossierForDeal } from "@/app/(crm)/facturation/actions";

/**
 * Le dossier administratif, vu depuis l'affaire.
 *
 * Il n'apparaît que si l'affaire est gagnée — c'est à ce moment que le dossier
 * naît. Avant, la section n'aurait rien à montrer et ne ferait qu'encombrer.
 */
export function DealDossier({ dealId, isAdmin }: { dealId: string; isAdmin: boolean }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "none" } | { status: "ready"; dossier: Dossier }
  >({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    fetchDossierForDeal(dealId).then((dossier) => {
      if (!active) return;
      setState(dossier ? { status: "ready", dossier } : { status: "none" });
    });
    return () => {
      active = false;
    };
  }, [dealId]);

  if (state.status === "none") return null;

  return (
    <section>
      <h3 className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
        <Banknote className="size-3.5 text-brand-500 dark:text-brand-300" />
        Dossier administratif
        {state.status === "ready" ? (
          <>
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              {state.dossier.code}
            </span>
            <Badge tone={DOSSIER_STATUS[state.dossier.status].tone}>
              {DOSSIER_STATUS[state.dossier.status].label}
            </Badge>
          </>
        ) : null}
      </h3>

      <div className="mt-2">
        {state.status === "loading" ? (
          <p className="flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
            <Loader2 className="size-3.5 animate-spin" />
            Chargement…
          </p>
        ) : (
          <DossierPanel dossierId={state.dossier.id} isAdmin={isAdmin} />
        )}
      </div>
    </section>
  );
}
