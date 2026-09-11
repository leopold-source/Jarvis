"use client";

import { useMemo, useState } from "react";
import { Flag, Info } from "lucide-react";

import { TASK_STATUS } from "@/lib/constants";
import type { Task } from "@/lib/database.types";
import { cn, formatDate } from "@/lib/utils";

/**
 * Le planning, en barres.
 *
 * Écrit à la main plutôt qu'avec une bibliothèque : un Gantt de projet tient
 * en un calcul de pourcentages, alors qu'une dépendance imposerait son propre
 * thème, ses couleurs et deux cents kilo-octets pour un écran qu'on regarde
 * dix secondes.
 *
 * Ce que le client doit lire sans qu'on le lui explique : où on en est
 * aujourd'hui, ce qui est fini, ce qui glisse. Le trait vertical du jour porte
 * l'essentiel — une barre qui se termine à sa gauche sans être verte est en
 * retard, et cela se voit sans légende.
 */
export function PortalGantt({ tasks }: { tasks: Task[] }) {
  const [survol, setSurvol] = useState<string | null>(null);

  const plan = useMemo(() => {
    const datees = tasks.filter((tache) => tache.start_on || tache.due_on);
    if (datees.length === 0) return null;

    const jours = datees.flatMap((tache) =>
      [tache.start_on, tache.due_on].filter(Boolean).map((d) => new Date(d as string).getTime()),
    );

    // Une marge de part et d'autre : une barre collée au bord se lit mal, et
    // le trait du jour doit pouvoir exister même si tout est déjà terminé.
    const marge = 3 * 86_400_000;
    const debut = Math.min(...jours) - marge;
    const fin = Math.max(...jours, Date.now()) + marge;
    const etendue = Math.max(fin - debut, 86_400_000);

    const position = (iso: string | null, repli: number) => {
      const t = iso ? new Date(iso).getTime() : repli;
      return ((t - debut) / etendue) * 100;
    };

    return {
      debut,
      fin,
      aujourdhui: ((Date.now() - debut) / etendue) * 100,
      barres: datees
        .slice()
        .sort((a, b) => (a.start_on ?? a.due_on ?? "").localeCompare(b.start_on ?? b.due_on ?? ""))
        .map((tache) => {
          const gauche = position(tache.start_on, new Date(tache.due_on!).getTime() - 86_400_000);
          const droite = position(tache.due_on, new Date(tache.start_on!).getTime() + 86_400_000);
          return {
            tache,
            gauche,
            // Un jalon est un instant, pas une durée : on lui donne une
            // largeur minimale pour qu'il reste cliquable et visible.
            largeur: Math.max(droite - gauche, tache.kind === "jalon" ? 0.8 : 1.4),
          };
        }),
    };
  }, [tasks]);

  if (!plan) {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
        <Info className="size-3.5" />
        Le planning s&apos;affichera dès que les étapes auront des dates.
      </p>
    );
  }

  const enRetard = (tache: Task) =>
    tache.status !== "termine" && tache.due_on !== null && new Date(tache.due_on) < new Date();

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[620px]">
        {/* Repères de mois, pour situer sans lire les dates une à une. */}
        <div className="relative mb-2 h-4 border-b border-[var(--border-subtle)]">
          {moisEntre(plan.debut, plan.fin).map((mois) => (
            <span
              key={mois.cle}
              className="absolute -translate-x-1/2 text-[10px] tracking-wide text-[var(--text-muted)] uppercase"
              style={{ left: `${mois.position}%` }}
            >
              {mois.label}
            </span>
          ))}
        </div>

        <div className="relative space-y-1.5">
          {/* Le trait du jour, derrière les barres. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-0 w-px bg-brand-500/60"
            style={{ left: `${Math.min(100, Math.max(0, plan.aujourdhui))}%` }}
          >
            <span className="absolute -top-1 -left-1 size-2 rounded-full bg-brand-500" />
          </span>

          {plan.barres.map(({ tache, gauche, largeur }) => {
            const meta = TASK_STATUS[tache.status];
            const retard = enRetard(tache);
            const jalon = tache.kind === "jalon";

            return (
              <div
                key={tache.id}
                className="relative grid grid-cols-[11rem_1fr] items-center gap-3"
                onMouseEnter={() => setSurvol(tache.id)}
                onMouseLeave={() => setSurvol(null)}
              >
                <span className="flex items-center gap-1 truncate text-[11.5px] text-[var(--text-secondary)]">
                  {jalon ? <Flag className="size-3 shrink-0 text-brand-400" /> : null}
                  <span className="truncate" title={tache.title}>
                    {tache.title}
                  </span>
                </span>

                <span className="relative h-5">
                  <span
                    className={cn(
                      "absolute top-1/2 block -translate-y-1/2 rounded-full transition-all duration-300",
                      jalon ? "h-4 rotate-45 rounded-[3px]" : "h-2.5",
                      tache.status === "termine"
                        ? "bg-linear-to-r from-emerald-500 to-teal-400"
                        : retard
                          ? "bg-linear-to-r from-rose-500 to-orange-400"
                          : tache.status === "en_cours"
                            ? "bg-linear-to-r from-brand-500 to-accent-400"
                            : "bg-[var(--surface-hover)] ring-1 ring-[var(--border-subtle)] ring-inset",
                      survol === tache.id && "shadow-[0_0_0_3px_var(--glow-brand)]",
                    )}
                    style={{
                      left: `${Math.max(0, gauche)}%`,
                      width: `${Math.min(100 - Math.max(0, gauche), largeur)}%`,
                    }}
                  />

                  {survol === tache.id ? (
                    <span className="absolute -top-8 left-0 z-20 rounded-lg bg-[var(--surface-overlay)] px-2 py-1 text-[11px] whitespace-nowrap shadow-[var(--shadow-card)] ring-1 ring-[var(--border-subtle)]">
                      {formatDate(tache.start_on)} → {formatDate(tache.due_on)} · {meta.label}
                      {retard ? " · en retard" : ""}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-muted)]">
          <Legende classe="from-emerald-500 to-teal-400" label="Terminé" />
          <Legende classe="from-brand-500 to-accent-400" label="En cours" />
          <Legende classe="from-rose-500 to-orange-400" label="En retard" />
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-6 rounded-full bg-[var(--surface-hover)] ring-1 ring-[var(--border-subtle)] ring-inset" />
            À venir
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-brand-500" />
            Aujourd&apos;hui
          </span>
        </div>
      </div>
    </div>
  );
}

function Legende({ classe, label }: { classe: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2.5 w-6 rounded-full bg-linear-to-r", classe)} />
      {label}
    </span>
  );
}

/** Les premiers de mois compris dans la fenêtre, placés en pourcentage. */
function moisEntre(debut: number, fin: number) {
  const out: Array<{ cle: string; label: string; position: number }> = [];
  const curseur = new Date(debut);
  curseur.setDate(1);
  curseur.setHours(0, 0, 0, 0);

  const etendue = fin - debut;
  while (curseur.getTime() <= fin) {
    const t = curseur.getTime();
    if (t >= debut) {
      out.push({
        cle: `${curseur.getFullYear()}-${curseur.getMonth()}`,
        label: curseur.toLocaleDateString("fr-FR", { month: "short" }),
        position: ((t - debut) / etendue) * 100,
      });
    }
    curseur.setMonth(curseur.getMonth() + 1);
  }
  return out;
}
