"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  CircleAlert,
  Handshake,
  Compass,
  MessageSquare,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";

import { Badge, Button, Card, Drawer, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { DateField } from "@/components/ui/date-field";
import { TODO_CATEGORIES, TODO_STATUT, TODO_STATUT_ORDER, type Tone } from "@/lib/constants";
import type { Todo, TodoComment, TodoStatut } from "@/lib/database.types";
import { classerEcheance } from "@/lib/echeances";
import { lireSaisie, type Membre } from "@/lib/taches-saisie";
import { avatarGradient, cn, formatDate, formatDateHeure, initials, todayIso } from "@/lib/utils";
import {
  ajouterCommentaire,
  creerTache,
  fetchCommentaires,
  majTache,
  supprimerCommentaire,
  supprimerTache,
} from "@/app/(crm)/taches/actions";

type Lien = { id: string; nom: string };

const TONS_CATEGORIE: Tone[] = ["orange", "amber", "teal", "sky", "violet", "pink", "lime", "indigo", "cyan", "fuchsia"];

/** Une couleur stable par catégorie, sans rien stocker. */
function toneCategorie(categorie: string): Tone {
  const connue = TODO_CATEGORIES.indexOf(categorie);
  if (connue >= 0) return TONS_CATEGORIE[connue]!;
  let h = 0;
  for (const c of categorie) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONS_CATEGORIE[h % TONS_CATEGORIE.length]!;
}

/** Dans un groupe : les prioritaires, puis par échéance, puis les plus anciennes. */
function trier(a: Todo, b: Todo): number {
  if (a.prio !== b.prio) return a.prio ? -1 : 1;
  if (a.due_on !== b.due_on) return !a.due_on ? 1 : !b.due_on ? -1 : a.due_on < b.due_on ? -1 : 1;
  return a.created_at < b.created_at ? -1 : 1;
}

/**
 * La liste de tâches de l'équipe.
 *
 * Pensée comme le Sheet qu'elle remplace — une ligne par tâche, lisible d'un
 * coup d'œil — avec ce qu'un Sheet ne fait pas : l'ajout en une phrase, les
 * tâches rangées par statut, ce qui est en retard en rouge, et une discussion
 * par tâche à la place des colonnes « Com Léopold » et « Com Romain ».
 */
export function TachesWorkspace({
  initiales,
  membres,
  moi,
  commentaires,
  affaires,
  chantiers,
}: {
  initiales: Todo[];
  membres: Membre[];
  moi: string;
  commentaires: Record<string, number>;
  affaires: Lien[];
  chantiers: Lien[];
}) {
  const toast = useToast();
  const [taches, setTaches] = useState(initiales);
  const [compteurs, setCompteurs] = useState(commentaires);
  const [qui, setQui] = useState<string>("tous");
  const [categorie, setCategorie] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [faitesOuvertes, setFaitesOuvertes] = useState(false);
  const [ouverte, setOuverte] = useState<string | null>(null);

  useEffect(() => setTaches(initiales), [initiales]);

  const aujourdhui = todayIso();
  const categories = useMemo(
    () => [...new Set([...TODO_CATEGORIES, ...taches.map((t) => t.categorie).filter((c): c is string => Boolean(c))])],
    [taches],
  );
  const enUsage = useMemo(
    () => [...new Set(taches.map((t) => t.categorie).filter((c): c is string => Boolean(c)))].sort(),
    [taches],
  );

  const visibles = taches.filter((t) => {
    if (qui === "moi" && !t.assignee_ids.includes(moi)) return false;
    if (qui !== "moi" && qui !== "tous" && !t.assignee_ids.includes(qui)) return false;
    if (categorie && t.categorie !== categorie) return false;
    if (recherche.trim()) {
      const q = recherche.trim().toLowerCase();
      if (!t.titre.toLowerCase().includes(q) && !(t.details ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  async function maj(id: string, patch: Partial<Todo>) {
    const avant = taches;
    setTaches((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const r = await majTache(id, patch);
    if (!r.ok) {
      setTaches(avant);
      toast(r.error, "error");
      return;
    }
    setTaches((ts) => ts.map((t) => (t.id === id ? r.data! : t)));
  }

  async function supprimer(id: string) {
    if (!window.confirm("Supprimer cette tâche ?")) return;
    const r = await supprimerTache(id);
    if (!r.ok) return toast(r.error, "error");
    setTaches((ts) => ts.filter((t) => t.id !== id));
    setOuverte(null);
  }

  const detail = taches.find((t) => t.id === ouverte) ?? null;
  const ouvertesVisibles = visibles.filter((t) => t.statut !== "fait").length;
  const enRetard = visibles.filter((t) => t.statut !== "fait" && t.due_on && t.due_on < aujourdhui).length;

  return (
    <>
      <AjoutRapide
        membres={membres}
        categories={categories}
        moi={moi}
        categorieParDefaut={categorie}
        onCree={(t) => setTaches((ts) => [...ts, t])}
      />

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-[var(--surface-hover)] p-0.5 text-[12px]">
          {[{ id: "tous", nom: "Équipe" }, { id: "moi", nom: "Moi" }, ...membres.filter((m) => m.id !== moi)].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setQui(m.id)}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                qui === m.id ? "bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
              )}
            >
              {m.id === "tous" || m.id === "moi" ? m.nom : m.nom.split(" ")[0]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {enUsage.map((c) => (
            <button key={c} type="button" onClick={() => setCategorie(categorie === c ? null : c)}>
              <Badge tone={categorie === c ? toneCategorie(c) : "stone"} className={cn(categorie && categorie !== c && "opacity-50")}>
                {c}
              </Badge>
            </button>
          ))}
        </div>
        <label className="relative ml-auto shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher" className="h-9 w-48 pl-8 sm:h-8" />
        </label>
      </div>

      <p className="-mt-2 text-[12px] text-[var(--text-muted)]">
        {ouvertesVisibles} tâche{ouvertesVisibles > 1 ? "s" : ""} ouverte{ouvertesVisibles > 1 ? "s" : ""}
        {enRetard ? <span className="text-rose-500"> · {enRetard} en retard</span> : null}
      </p>

      {/* Groupes par statut */}
      <div className="flex flex-col gap-4">
        {TODO_STATUT_ORDER.map((statut) => {
          const groupe = visibles.filter((t) => t.statut === statut).sort(statut === "fait" ? (a, b) => ((b.done_at ?? "") > (a.done_at ?? "") ? 1 : -1) : trier);
          if (!groupe.length) return null;
          const replie = statut === "fait" && !faitesOuvertes;
          return (
            <Card key={statut} className="overflow-hidden p-0">
              <button
                type="button"
                onClick={() => statut === "fait" && setFaitesOuvertes((o) => !o)}
                className={cn("flex w-full items-center gap-2 px-4 py-2.5 text-left", statut === "fait" && "cursor-pointer")}
              >
                <Badge tone={TODO_STATUT[statut].tone}>{TODO_STATUT[statut].label}</Badge>
                <span className="text-[12px] text-[var(--text-muted)]">{groupe.length}</span>
                {statut === "fait" ? (
                  <ChevronDown className={cn("ml-auto size-4 text-[var(--text-muted)] transition-transform", !replie && "rotate-180")} />
                ) : null}
              </button>
              {replie ? null : (
                <ul className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
                  {groupe.map((t) => (
                    <Ligne
                      key={t.id}
                      t={t}
                      membres={membres}
                      aujourdhui={aujourdhui}
                      commentaires={compteurs[t.id] ?? 0}
                      onMaj={(patch) => void maj(t.id, patch)}
                      onOuvrir={() => setOuverte(t.id)}
                    />
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
        {visibles.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-[var(--text-muted)]">Aucune tâche ici. Ajoutez-en une en une phrase, juste au-dessus.</p>
        ) : null}
      </div>

      {detail ? (
        <DetailTache
          t={detail}
          membres={membres}
          categories={categories}
          affaires={affaires}
          chantiers={chantiers}
          onClose={() => setOuverte(null)}
          onMaj={(patch) => maj(detail.id, patch)}
          onSupprimer={() => void supprimer(detail.id)}
          onCommentaires={(n) => setCompteurs((c) => ({ ...c, [detail.id]: n }))}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------ Ajout rapide */

function AjoutRapide({
  membres,
  categories,
  moi,
  categorieParDefaut,
  onCree,
}: {
  membres: Membre[];
  categories: string[];
  moi: string;
  categorieParDefaut: string | null;
  onCree: (t: Todo) => void;
}) {
  const toast = useToast();
  const [texte, setTexte] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  const lu = lireSaisie(texte, { membres, categories, aujourdhui: todayIso() });

  async function ajouter() {
    if (!lu.titre.trim()) return;
    setEnvoi(true);
    const r = await creerTache({
      titre: lu.titre,
      categorie: lu.categorie ?? categorieParDefaut,
      // Sans « @ », la tâche revient à qui l'écrit.
      assignee_ids: lu.assignees.length ? lu.assignees : [moi],
      due_on: lu.due_on,
      prio: lu.prio,
    });
    setEnvoi(false);
    if (!r.ok) return toast(r.error, "error");
    onCree(r.data!);
    setTexte("");
    champ.current?.focus();
  }

  const nomDe = (id: string) => membres.find((m) => m.id === id)?.nom.split(" ")[0] ?? "?";

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <Plus className="ml-1 size-4 shrink-0 text-[var(--text-muted)]" />
        <input
          ref={champ}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void ajouter()}
          placeholder="Nouvelle tâche…  @Romain  #Prospection  demain  !"
          aria-label="Nouvelle tâche"
          className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--text-muted)] sm:text-sm"
        />
        <Button variant="primary" size="sm" loading={envoi} disabled={!lu.titre.trim()} onClick={() => void ajouter()}>
          Ajouter
        </Button>
      </div>
      {texte.trim() ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-7 text-[11.5px] text-[var(--text-muted)]">
          <span className="font-medium text-[var(--text-primary)]">{lu.titre || "…"}</span>
          <span>· {(lu.assignees.length ? lu.assignees : [moi]).map(nomDe).join(" + ")}</span>
          {lu.categorie ?? categorieParDefaut ? <Badge tone={toneCategorie((lu.categorie ?? categorieParDefaut)!)}>{lu.categorie ?? categorieParDefaut}</Badge> : null}
          {lu.due_on ? <span>· pour le {formatDate(lu.due_on)}</span> : null}
          {lu.prio ? <span className="text-amber-500">· prioritaire</span> : null}
        </div>
      ) : (
        <p className="mt-1 pl-7 text-[11.5px] text-[var(--text-muted)]">
          « @prénom » pour assigner (@tous pour les deux), « #catégorie », une date (demain, lundi, 12/10), « ! » pour prioritaire.
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ Une ligne */

function Avatars({ ids, membres }: { ids: string[]; membres: Membre[] }) {
  if (!ids.length) return <span className="text-[11px] text-[var(--text-muted)]">—</span>;
  return (
    <span className="flex -space-x-1">
      {ids.map((id) => {
        const nom = membres.find((m) => m.id === id)?.nom ?? "?";
        return (
          <span
            key={id}
            title={nom}
            className={cn(
              "grid size-6 place-items-center rounded-full bg-linear-to-br text-[9.5px] font-semibold text-white ring-2 ring-[var(--surface-raised,var(--surface-base))]",
              avatarGradient(id),
            )}
          >
            {initials(nom)}
          </span>
        );
      })}
    </span>
  );
}

function Ligne({
  t,
  membres,
  aujourdhui,
  commentaires,
  onMaj,
  onOuvrir,
}: {
  t: Todo;
  membres: Membre[];
  aujourdhui: string;
  commentaires: number;
  onMaj: (patch: Partial<Todo>) => void;
  onOuvrir: () => void;
}) {
  const fait = t.statut === "fait";
  const echeance = fait ? null : classerEcheance(t.due_on, aujourdhui);

  return (
    <li className="group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[var(--surface-hover)]/40 sm:px-4">
      <input
        type="checkbox"
        checked={fait}
        onChange={() => onMaj({ statut: fait ? "a_faire" : "fait" })}
        aria-label={fait ? "Rouvrir" : "Marquer comme fait"}
        className="size-4 shrink-0 cursor-pointer accent-emerald-600"
      />
      <button
        type="button"
        onClick={() => onMaj({ prio: !t.prio })}
        aria-label={t.prio ? "Retirer la priorité" : "Rendre prioritaire"}
        title="Prioritaire"
        className={cn("shrink-0", t.prio ? "text-amber-500" : "text-[var(--text-muted)] opacity-30 hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-60")}
      >
        <Star className={cn("size-3.5", t.prio && "fill-current")} />
      </button>

      <button type="button" onClick={onOuvrir} className="min-w-0 flex-1 text-left">
        <p className={cn("truncate text-[13.5px]", fait && "text-[var(--text-muted)] line-through")}>{t.titre}</p>
        {t.details ? <p className="truncate text-[11.5px] text-[var(--text-muted)]">{t.details.split("\n")[0]}</p> : null}
      </button>

      {commentaires ? (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-[var(--text-muted)]" title={`${commentaires} commentaire(s)`}>
          <MessageSquare className="size-3" />
          {commentaires}
        </span>
      ) : null}
      {t.categorie ? (
        <Badge tone={toneCategorie(t.categorie)} className="hidden shrink-0 sm:inline-flex">
          {t.categorie}
        </Badge>
      ) : null}
      {t.due_on && !fait ? (
        <span
          className={cn(
            "flex w-[92px] shrink-0 items-center justify-end gap-1 text-[11.5px] tabular-nums",
            echeance === "retard" ? "font-medium text-rose-500" : echeance === "jour" ? "font-medium text-brand-600 dark:text-brand-300" : "text-[var(--text-muted)]",
          )}
        >
          <CalendarDays className="size-3" />
          {echeance === "jour" ? "Aujourd'hui" : formatDate(t.due_on).slice(0, 5)}
        </span>
      ) : (
        <span className="hidden w-[92px] shrink-0 sm:block" aria-hidden />
      )}
      <Select
        value={t.statut}
        onChange={(e) => onMaj({ statut: e.target.value as TodoStatut })}
        aria-label="Statut"
        className="hidden h-8 w-[118px] py-0 pr-7 text-[12px] sm:block sm:h-8 sm:text-[12px]"
      >
        {TODO_STATUT_ORDER.map((s) => (
          <option key={s} value={s}>
            {TODO_STATUT[s].label}
          </option>
        ))}
      </Select>
      <span className="flex w-11 shrink-0 justify-end">
        <Avatars ids={t.assignee_ids} membres={membres} />
      </span>
    </li>
  );
}

/* ------------------------------------------------------------ Détail */

function DetailTache({
  t,
  membres,
  categories,
  affaires,
  chantiers,
  onClose,
  onMaj,
  onSupprimer,
  onCommentaires,
}: {
  t: Todo;
  membres: Membre[];
  categories: string[];
  affaires: Lien[];
  chantiers: Lien[];
  onClose: () => void;
  onMaj: (patch: Partial<Todo>) => Promise<void>;
  onSupprimer: () => void;
  onCommentaires: (n: number) => void;
}) {
  const [titre, setTitre] = useState(t.titre);
  const [details, setDetails] = useState(t.details ?? "");

  useEffect(() => {
    setTitre(t.titre);
    setDetails(t.details ?? "");
  }, [t.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <input
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          onBlur={() => titre.trim() && titre !== t.titre && void onMaj({ titre })}
          aria-label="Titre"
          className="w-full bg-transparent outline-none"
        />
      }
      subtitle={`Créée le ${formatDate(t.created_at)}${t.done_at ? ` · faite le ${formatDate(t.done_at)}` : ""}`}
      footer={
        <>
          <Button variant="ghost" onClick={onSupprimer} className="mr-auto text-rose-500 hover:text-rose-400">
            <Trash2 className="size-4" /> Supprimer
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Statut">
            <Select value={t.statut} onChange={(e) => void onMaj({ statut: e.target.value as TodoStatut })}>
              {TODO_STATUT_ORDER.map((s) => (
                <option key={s} value={s}>
                  {TODO_STATUT[s].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quand">
            <DateField value={t.due_on} onChange={(v) => void onMaj({ due_on: v })} className="w-full" />
          </Field>
          <Field label="Catégorie">
            <Input
              list="categories-taches"
              defaultValue={t.categorie ?? ""}
              key={`${t.id}-${t.categorie}`}
              onBlur={(e) => e.target.value !== (t.categorie ?? "") && void onMaj({ categorie: e.target.value })}
              placeholder="Webapp AC, Prospection…"
            />
            <datalist id="categories-taches">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Priorité">
            <button
              type="button"
              onClick={() => void onMaj({ prio: !t.prio })}
              className={cn(
                "flex h-11 w-full items-center gap-2 rounded-[10px] px-3 text-sm ring-1 ring-[var(--border-subtle)] sm:h-9.5",
                t.prio ? "bg-amber-500/12 text-amber-700 dark:text-amber-300" : "text-[var(--text-muted)]",
              )}
            >
              <Star className={cn("size-4", t.prio && "fill-current")} />
              {t.prio ? "Prioritaire" : "Normale"}
            </button>
          </Field>
        </div>

        <Field label="Qui">
          <div className="flex flex-wrap gap-1.5">
            {membres.map((m) => {
              const actif = t.assignee_ids.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() =>
                    void onMaj({ assignee_ids: actif ? t.assignee_ids.filter((x) => x !== m.id) : [...t.assignee_ids, m.id] })
                  }
                  className={cn(
                    "flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-[12.5px] ring-1 transition-colors",
                    actif ? "bg-brand-500/12 ring-brand-500/40" : "text-[var(--text-muted)] ring-[var(--border-subtle)] hover:text-[var(--text-primary)]",
                  )}
                >
                  <span className={cn("grid size-5 place-items-center rounded-full bg-linear-to-br text-[9px] font-semibold text-white", avatarGradient(m.id), !actif && "opacity-40")}>
                    {initials(m.nom)}
                  </span>
                  {m.nom.split(" ")[0]}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Détails">
          <Textarea
            rows={4}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            onBlur={() => details !== (t.details ?? "") && void onMaj({ details })}
            placeholder="Contexte, liens, ce qu'on attend…"
          />
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Affaire liée">
            <div className="relative">
              <Handshake className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <Select value={t.deal_id ?? ""} onChange={(e) => void onMaj({ deal_id: e.target.value || null })} className="pl-8">
                <option value="">Aucune</option>
                {affaires.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nom}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field label="Chantier lié">
            <div className="relative">
              <Compass className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <Select value={t.chantier_id ?? ""} onChange={(e) => void onMaj({ chantier_id: e.target.value || null })} className="pl-8">
                <option value="">Aucun</option>
                {chantiers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
        </div>

        <Discussion todoId={t.id} membres={membres} onCompte={onCommentaires} />
      </div>
    </Drawer>
  );
}

/** Les échanges sur une tâche : ce que faisaient les colonnes « Com » du Sheet. */
function Discussion({ todoId, membres, onCompte }: { todoId: string; membres: Membre[]; onCompte: (n: number) => void }) {
  const toast = useToast();
  const [liste, setListe] = useState<TodoComment[] | null>(null);
  const [texte, setTexte] = useState("");
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    setListe(null);
    void fetchCommentaires(todoId).then((r) => setListe(r.ok ? r.data! : []));
  }, [todoId]);

  async function publier() {
    if (!texte.trim()) return;
    setEnvoi(true);
    const r = await ajouterCommentaire(todoId, texte);
    setEnvoi(false);
    if (!r.ok) return toast(r.error, "error");
    const suivante = [...(liste ?? []), r.data!];
    setListe(suivante);
    onCompte(suivante.length);
    setTexte("");
  }

  async function retirer(id: string) {
    const r = await supprimerCommentaire(id);
    if (!r.ok) return toast(r.error, "error");
    const suivante = (liste ?? []).filter((c) => c.id !== id);
    setListe(suivante);
    onCompte(suivante.length);
  }

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
        <MessageSquare className="size-3.5" /> Discussion
      </h3>
      {liste === null ? null : liste.length === 0 ? (
        <p className="mb-2 text-[12px] text-[var(--text-muted)]">Pas encore d&apos;échange sur cette tâche.</p>
      ) : (
        <ul className="mb-3 space-y-2.5">
          {liste.map((c) => {
            const nom = membres.find((m) => m.id === c.author_id)?.nom ?? "?";
            return (
              <li key={c.id} className="group flex gap-2.5">
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-full bg-linear-to-br text-[9.5px] font-semibold text-white", avatarGradient(c.author_id))}>
                  {initials(nom)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] text-[var(--text-muted)]">
                    <span className="font-medium text-[var(--text-primary)]">{nom.split(" ")[0]}</span> · {formatDateHeure(c.created_at)}
                    <button
                      type="button"
                      onClick={() => void retirer(c.id)}
                      className="ml-2 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-500"
                    >
                      retirer
                    </button>
                  </p>
                  <p className="text-[13px] whitespace-pre-line">{c.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          rows={2}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void publier();
          }}
          placeholder="Un commentaire, une question à l'autre… (⌘⏎ pour publier)"
          className="flex-1"
        />
        <Button variant="secondary" loading={envoi} disabled={!texte.trim()} onClick={() => void publier()}>
          Publier
        </Button>
      </div>
      {liste && liste.length === 0 ? null : (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
          <CircleAlert className="size-3" /> Chacun ne peut retirer que ses propres commentaires.
        </p>
      )}
    </section>
  );
}
