"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Compass,
  Flag,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Target,
  Trash2,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import {
  CHANTIER_STATUS,
  METRIC_SOURCE,
  METRIC_SOURCE_ORDER,
  TONE_DOT,
  TONE_GRADIENT,
} from "@/lib/constants";
import type { Chantier, MetricSource, Objectif } from "@/lib/database.types";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import {
  createChantier,
  createObjectif,
  deleteChantier,
  deleteObjectif,
  refreshObjectifs,
  updateChantier,
  updateObjectif,
} from "@/app/(crm)/chantiers/actions";

type TeamMember = { id: string; full_name: string | null; email: string };

/**
 * Le tableau des chantiers.
 *
 * Un chantier sans objectif est une intention ; c'est pourquoi la carte le dit
 * franchement plutôt que d'afficher une barre à zéro, qui laisserait croire
 * qu'un chiffre existe. Les chantiers terminés sortent de la vue mais restent
 * accessibles d'un clic : ils sont la mémoire de ce que l'on a mené à bout.
 */
export function ChantiersBoard({
  chantiers,
  objectifs,
  team,
  currentUserId,
}: {
  chantiers: Chantier[];
  objectifs: Objectif[];
  team: TeamMember[];
  currentUserId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [newChantier, setNewChantier] = useState(false);
  const [objectifFor, setObjectifFor] = useState<Chantier | null>(null);

  const byChantier = useMemo(() => {
    const map = new Map<string, Objectif[]>();
    for (const objectif of objectifs) {
      const list = map.get(objectif.chantier_id) ?? [];
      list.push(objectif);
      map.set(objectif.chantier_id, list);
    }
    return map;
  }, [objectifs]);

  const done = chantiers.filter((chantier) => chantier.status === "termine");
  const live = chantiers.filter((chantier) => chantier.status !== "termine");

  async function act(run: () => Promise<{ ok: boolean; error?: string }>, message?: string) {
    setBusy(true);
    const result = await run();
    setBusy(false);
    if (!result.ok) {
      toast(result.error ?? "Échec.", "error");
      return false;
    }
    if (message) toast(message);
    startTransition(() => router.refresh());
    return true;
  }

  const owners = new Map(team.map((member) => [member.id, member.full_name ?? member.email]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setNewChantier(true)}>
          <Plus className="size-4" />
          Nouveau chantier
        </Button>

        <Button
          variant="ghost"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const result = await refreshObjectifs();
            setBusy(false);
            if (!result.ok) return toast(result.error, "error");
            toast(
              result.data?.updated
                ? `${result.data.updated} objectif(s) remis à jour.`
                : "Les chiffres étaient déjà à jour.",
            );
            startTransition(() => router.refresh());
          }}
        >
          <RefreshCw className="size-4" />
          Recalculer les chiffres
        </Button>

        {done.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowDone((value) => !value)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", showDone && "rotate-180")} />
            {done.length} chantier(s) terminé(s)
          </button>
        ) : null}
      </div>

      {live.length === 0 ? (
        <EmptyState
          icon={<Compass className="size-5" />}
          title="Aucun chantier en cours"
          description="Un chantier, c'est un sujet que l'on décide de faire avancer : la prospection LinkedIn, les partenariats de recommandation, l'offre. Chacun porte un objectif chiffré."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {live.map((chantier, index) => (
            <ChantierCard
              key={chantier.id}
              chantier={chantier}
              objectifs={byChantier.get(chantier.id) ?? []}
              ownerName={chantier.owner_id ? (owners.get(chantier.owner_id) ?? null) : null}
              index={index}
              busy={busy}
              onAddObjectif={() => setObjectifFor(chantier)}
              act={act}
            />
          ))}
        </div>
      )}

      {showDone && done.length > 0 ? (
        <div className="grid animate-fade-up gap-4 lg:grid-cols-2">
          {done.map((chantier, index) => (
            <ChantierCard
              key={chantier.id}
              chantier={chantier}
              objectifs={byChantier.get(chantier.id) ?? []}
              ownerName={chantier.owner_id ? (owners.get(chantier.owner_id) ?? null) : null}
              index={index}
              busy={busy}
              onAddObjectif={() => setObjectifFor(chantier)}
              act={act}
            />
          ))}
        </div>
      ) : null}

      <NewChantierModal
        open={newChantier}
        onClose={() => setNewChantier(false)}
        team={team}
        currentUserId={currentUserId}
        onSubmit={async (input) => {
          const ok = await act(() => createChantier(input), "Chantier créé.");
          if (ok) setNewChantier(false);
        }}
      />

      <NewObjectifModal
        chantier={objectifFor}
        onClose={() => setObjectifFor(null)}
        onSubmit={async (input) => {
          const ok = await act(() => createObjectif(input), "Objectif ajouté.");
          if (ok) setObjectifFor(null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- Carte */

function ChantierCard({
  chantier,
  objectifs,
  ownerName,
  index,
  busy,
  onAddObjectif,
  act,
}: {
  chantier: Chantier;
  objectifs: Objectif[];
  ownerName: string | null;
  index: number;
  busy: boolean;
  onAddObjectif: () => void;
  act: (run: () => Promise<{ ok: boolean; error?: string }>, message?: string) => Promise<boolean>;
}) {
  const meta = CHANTIER_STATUS[chantier.status];
  const finished = chantier.status === "termine";

  const durationDays = finished
    ? Math.max(
        0,
        Math.round(
          (new Date(chantier.completed_at ?? Date.now()).getTime() -
            new Date(chantier.started_on).getTime()) /
            86_400_000,
        ),
      )
    : null;

  return (
    <Card
      glow={!finished}
      style={{ ["--i" as string]: index }}
      className={cn("stagger relative overflow-hidden p-5", finished && "opacity-70")}
    >
      {/* Une lueur d'ambiance, dans la couleur du statut. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-linear-to-br opacity-20 blur-3xl",
          TONE_GRADIENT[meta.tone],
        )}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[meta.tone])} aria-hidden />
            <h3 className="truncate text-[15px] font-semibold tracking-tight">{chantier.title}</h3>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          {chantier.intention ? (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
              {chantier.intention}
            </p>
          ) : null}
          <p className="mt-1.5 text-[11.5px] text-[var(--text-muted)]">
            {ownerName ?? "Sans pilote"} · démarré le {formatDate(chantier.started_on)}
            {durationDays != null ? ` · mené en ${durationDays} j` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!finished ? (
            <IconAction
              title={chantier.status === "en_pause" ? "Reprendre" : "Mettre en pause"}
              busy={busy}
              onClick={() =>
                act(
                  () =>
                    updateChantier(chantier.id, {
                      status: chantier.status === "en_pause" ? "actif" : "en_pause",
                    }),
                )
              }
            >
              {chantier.status === "en_pause" ? (
                <Play className="size-3.5" />
              ) : (
                <Pause className="size-3.5" />
              )}
            </IconAction>
          ) : null}

          <IconAction
            title={finished ? "Rouvrir le chantier" : "Marquer terminé"}
            busy={busy}
            onClick={() =>
              act(
                () => updateChantier(chantier.id, { status: finished ? "actif" : "termine" }),
                finished ? "Chantier rouvert." : "Chantier terminé. Il reste consultable.",
              )
            }
          >
            {finished ? <Play className="size-3.5" /> : <Flag className="size-3.5" />}
          </IconAction>

          <IconAction
            title="Supprimer"
            danger
            busy={busy}
            onClick={() => act(() => deleteChantier(chantier.id), "Chantier supprimé.")}
          >
            <Trash2 className="size-3.5" />
          </IconAction>
        </div>
      </div>

      <div className="relative mt-4 space-y-2.5">
        {objectifs.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[var(--border-subtle)] px-3 py-2.5 text-[12px] text-[var(--text-muted)]">
            Pas encore d&apos;objectif : ce chantier est une intention, pas encore une mesure.
          </p>
        ) : (
          objectifs.map((objectif) => (
            <ObjectifRow key={objectif.id} objectif={objectif} busy={busy} act={act} />
          ))
        )}
      </div>

      <Button size="sm" variant="ghost" className="relative mt-3" onClick={onAddObjectif}>
        <Plus className="size-3.5" />
        Ajouter un objectif
      </Button>
    </Card>
  );
}

function IconAction({
  title,
  children,
  onClick,
  busy,
  danger,
}: {
  title: string;
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40",
        danger ? "hover:text-rose-500" : "hover:text-[var(--text-primary)]",
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- Objectifs */

function ObjectifRow({
  objectif,
  busy,
  act,
}: {
  objectif: Objectif;
  busy: boolean;
  act: (run: () => Promise<{ ok: boolean; error?: string }>, message?: string) => Promise<boolean>;
}) {
  const source = METRIC_SOURCE[objectif.source];
  const target = Number(objectif.target_value);
  const current = Number(objectif.current_value);
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const reached = target > 0 && current >= target;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(current));

  const show = (value: number) =>
    source.money ? formatMoney(value, true) : `${value.toLocaleString("fr-FR")}${objectif.unit ? ` ${objectif.unit}` : ""}`;

  return (
    <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium">
          <Target className="size-3.5 shrink-0 text-brand-500 dark:text-brand-300" />
          <span className="truncate">{objectif.title}</span>
        </span>
        <span
          className={cn(
            "text-[12px] font-semibold tabular-nums",
            reached ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--text-secondary)]",
          )}
        >
          {show(current)} / {show(target)}
        </span>
      </div>

      {/* La barre : la seule information qui se lit sans lire. */}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
        <div
          className={cn(
            "h-full rounded-full bg-linear-to-r transition-[width] duration-700 ease-out",
            reached ? "from-emerald-500 to-teal-400" : "from-brand-500 to-accent-400",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
        <span>{source.label}</span>
        {objectif.due_on ? <span>· pour le {formatDate(objectif.due_on)}</span> : null}
        {objectif.rationale ? <span className="w-full italic">« {objectif.rationale} »</span> : null}

        <span className="ml-auto flex items-center gap-1">
          {objectif.source === "manuel" ? (
            editing ? (
              <>
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="h-6 w-20 text-right text-[11.5px]"
                  aria-label="Valeur atteinte"
                />
                <IconAction
                  title="Enregistrer"
                  busy={busy}
                  onClick={async () => {
                    const ok = await act(() =>
                      updateObjectif(objectif.id, { current_value: Number(draft) || 0 }),
                    );
                    if (ok) setEditing(false);
                  }}
                >
                  <Check className="size-3.5" />
                </IconAction>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraft(String(current));
                  setEditing(true);
                }}
                className="rounded px-1.5 py-0.5 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"
              >
                Mettre à jour
              </button>
            )
          ) : null}

          <IconAction
            title="Supprimer l'objectif"
            danger
            busy={busy}
            onClick={() => act(() => deleteObjectif(objectif.id))}
          >
            <Trash2 className="size-3" />
          </IconAction>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Modales */

function NewChantierModal({
  open,
  onClose,
  team,
  currentUserId,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  team: TeamMember[];
  currentUserId: string;
  onSubmit: (input: { title: string; intention: string | null; owner_id: string | null }) => void;
}) {
  const [title, setTitle] = useState("");
  const [intention, setIntention] = useState("");
  const [owner, setOwner] = useState(currentUserId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouveau chantier"
      description="Un sujet que l'on décide de faire avancer, et quelqu'un pour le porter."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={title.trim().length === 0}
            onClick={() =>
              onSubmit({
                title: title.trim(),
                intention: intention.trim() || null,
                owner_id: owner || null,
              })
            }
          >
            Créer
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Intitulé">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Partenariats de recommandation"
            autoFocus
          />
        </Field>
        <Field label="Pourquoi ce chantier" hint="La phrase qui justifie qu'on y passe du temps.">
          <Textarea
            rows={2}
            value={intention}
            onChange={(event) => setIntention(event.target.value)}
            placeholder="Sortir de la dépendance à la prospection à froid."
          />
        </Field>
        <Field label="Pilote">
          <Select value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="">Sans pilote</option>
            {team.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name ?? member.email}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function NewObjectifModal({
  chantier,
  onClose,
  onSubmit,
}: {
  chantier: Chantier | null;
  onClose: () => void;
  onSubmit: (input: {
    chantier_id: string;
    title: string;
    rationale: string | null;
    target_value: number;
    unit: string | null;
    source: MetricSource;
    due_on: string | null;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [target, setTarget] = useState("");
  const [source, setSource] = useState<MetricSource>("manuel");
  const [unit, setUnit] = useState("");
  const [dueOn, setDueOn] = useState("");

  const meta = METRIC_SOURCE[source];

  return (
    <Modal
      open={chantier !== null}
      onClose={onClose}
      title={`Objectif — ${chantier?.title ?? ""}`}
      description="Un chantier sans chiffre ne se pilote pas : il se raconte."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={!chantier || title.trim().length === 0 || !Number(target)}
            onClick={() =>
              chantier &&
              onSubmit({
                chantier_id: chantier.id,
                title: title.trim(),
                rationale: rationale.trim() || null,
                target_value: Number(target) || 0,
                unit: (unit.trim() || meta.unit) || null,
                source,
                due_on: dueOn || null,
              })
            }
          >
            Ajouter
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Objectif">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="10 partenaires actifs"
            autoFocus
          />
        </Field>

        <Field label="Pourquoi ce chiffre" hint="Ce qui a conduit à le fixer là et pas ailleurs.">
          <Textarea
            rows={2}
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Un partenaire nous amène en moyenne deux RDV par trimestre."
          />
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Cible">
            <Input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              inputMode="decimal"
              placeholder="10"
            />
          </Field>
          <Field label="Échéance">
            <Input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
          </Field>
        </div>

        <Field label="Comment on le mesure" hint={meta.hint}>
          <Select
            value={source}
            onChange={(event) => setSource(event.target.value as MetricSource)}
          >
            {METRIC_SOURCE_ORDER.map((key) => (
              <option key={key} value={key}>
                {METRIC_SOURCE[key].label}
              </option>
            ))}
          </Select>
        </Field>

        {source === "manuel" ? (
          <Field label="Unité" hint="Facultatif : partenaires, posts, heures…">
            <Input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="partenaires" />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
