import Link from "next/link";
import { CalendarDays, Link2, MapPin, Users, Video } from "lucide-react";

import { Card, SectionTitle } from "@/components/ui";
import { agendaDe, type RendezVous } from "@/lib/agenda";
import { cn } from "@/lib/utils";

/**
 * Les rendez-vous qui arrivent, en haut du tableau de bord.
 *
 * Rendu dans sa propre frontière asynchrone : l'appel à Google prend quelques
 * centaines de millisecondes et n'a aucune raison de retarder l'affichage du
 * pipeline. La page arrive complète, cette carte se remplit ensuite.
 */
export async function AgendaDuJour({ userId }: { userId: string }) {
  const resultat = await agendaDe(userId, { jours: 1 });

  if (!resultat.ok) {
    // Rien à dire si l'agenda n'est simplement pas branché : une carte qui
    // réclame une connexion à chaque ouverture devient du bruit.
    if (resultat.raison === "non_connecte") return null;

    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-amber-500/15 text-amber-600 ring-1 ring-amber-500/25 dark:text-amber-300">
            <CalendarDays className="size-4.5" />
          </span>
          <p className="min-w-0 flex-1 text-[12.5px] text-[var(--text-muted)]">
            {resultat.raison === "perimetre"
              ? "Ton compte Google a été connecté avant l'ajout de l'agenda."
              : `Agenda indisponible : ${resultat.detail}`}
          </p>
          <Link
            href="/parametres?onglet=google"
            className="text-[12.5px] text-brand-400 transition-colors hover:text-brand-300"
          >
            Reconnecter
          </Link>
        </div>
      </Card>
    );
  }

  const maintenant = Date.now();
  const aujourdhui = new Date().toDateString();

  const duJour = resultat.rendezVous.filter(
    (rdv) => rdv.journee_entiere || (rdv.debut && new Date(rdv.debut).toDateString() === aujourdhui),
  );
  const demain = resultat.rendezVous.filter((rdv) => !duJour.includes(rdv));

  return (
    <Card glow className="p-5">
      <SectionTitle
        title="Ton agenda"
        description={
          duJour.length === 0
            ? "Plus aucun rendez-vous aujourd'hui"
            : `${duJour.length} rendez-vous ${duJour.length > 1 ? "restants" : "restant"} aujourd'hui`
        }
      />

      {resultat.rendezVous.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">
          Rien d&apos;ici demain soir. C&apos;est le moment de passer des appels.
        </p>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {duJour.map((rdv, index) => (
            <Rendez
              key={rdv.id}
              rdv={rdv}
              index={index}
              encours={
                !rdv.journee_entiere &&
                rdv.debut !== null &&
                rdv.fin !== null &&
                new Date(rdv.debut).getTime() <= maintenant &&
                new Date(rdv.fin).getTime() >= maintenant
              }
            />
          ))}

          {demain.length > 0 ? (
            <li className="pt-2.5 text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
              Demain
            </li>
          ) : null}
          {demain.map((rdv, index) => (
            <Rendez key={rdv.id} rdv={rdv} index={duJour.length + index} encours={false} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function Rendez({
  rdv,
  index,
  encours,
}: {
  rdv: RendezVous;
  index: number;
  encours: boolean;
}) {
  const heure = rdv.journee_entiere
    ? "journée"
    : rdv.debut
      ? new Date(rdv.debut).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
      : "—";

  return (
    <li
      style={{ ["--i" as string]: index }}
      className={cn(
        "stagger flex items-start gap-3 rounded-[10px] px-2.5 py-2 transition-colors",
        encours
          ? "bg-brand-500/10 ring-1 ring-brand-500/25 ring-inset"
          : "hover:bg-[var(--surface-hover)]/50",
      )}
    >
      <span
        className={cn(
          "w-14 shrink-0 pt-0.5 text-right font-mono text-[12px] tabular-nums",
          encours ? "text-brand-500 dark:text-brand-300" : "text-[var(--text-muted)]",
        )}
      >
        {heure}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium">{rdv.titre}</span>
          {encours ? (
            <span className="rounded-full bg-brand-500/20 px-1.5 py-px text-[10px] text-brand-600 dark:text-brand-300">
              en cours
            </span>
          ) : null}
        </span>

        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-[var(--text-muted)]">
          {rdv.participants.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1">
              <Users className="size-3 shrink-0" />
              <span className="truncate">{rdv.participants.join(", ")}</span>
            </span>
          ) : null}
          {rdv.lieu ? (
            <span className="flex min-w-0 items-center gap-1">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{rdv.lieu}</span>
            </span>
          ) : null}
        </span>
      </span>

      {/* Rejoindre en un clic : c'est la seule action qu'on veut d'un agenda
          affiché sur un tableau de bord. */}
      {rdv.visio ? (
        <a
          href={rdv.visio}
          target="_blank"
          rel="noreferrer"
          title="Rejoindre la visio"
          className="shrink-0 rounded-lg bg-brand-500/15 p-1.5 text-brand-500 transition-colors hover:bg-brand-500/25 dark:text-brand-300"
        >
          <Video className="size-3.5" />
        </a>
      ) : rdv.lien ? (
        <a
          href={rdv.lien}
          target="_blank"
          rel="noreferrer"
          title="Ouvrir dans Google Agenda"
          className="shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        >
          <Link2 className="size-3.5" />
        </a>
      ) : null}
    </li>
  );
}
