"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";

import { useToast } from "@/components/ui";
import { TODO_CATEGORIES, TODO_STATUT, TODO_STATUT_ORDER, TONE_CLASSES, type Tone } from "@/lib/constants";
import type { Todo, TodoStatut } from "@/lib/database.types";
import { cn, todayIso } from "@/lib/utils";
import { creerTache, majCommentaire, majTache, supprimerTache, type TacheModifiable } from "@/app/(crm)/taches/actions";

type Membre = { id: string; nom: string };

const TONS_LIBRES: Tone[] = ["teal", "pink", "lime", "cyan", "fuchsia", "rose"];

/** La couleur d'une catégorie : celle du Sheet, sinon une couleur stable dérivée du nom. */
function toneCategorie(categorie: string): Tone {
  if (TODO_CATEGORIES[categorie]) return TODO_CATEGORIES[categorie]!;
  let h = 0;
  for (const c of categorie) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONS_LIBRES[h % TONS_LIBRES.length]!;
}

const prenom = (nom: string) => nom.split(" ")[0] ?? nom;

/**
 * Les tâches de l'équipe, en tableau — comme le Sheet qu'il remplace.
 *
 * Mêmes colonnes, même ordre de lignes, cellules modifiables sur place : on
 * clique, on tape, on sort de la cellule, c'est enregistré. Chaque associé a
 * sa colonne de commentaire et n'écrit que dans la sienne. Une ligne vide en
 * bas du tableau sert à en ajouter une nouvelle.
 */
export function TachesWorkspace({
  initiales,
  membres,
  moi,
}: {
  initiales: Todo[];
  membres: Membre[];
  moi: string;
}) {
  const toast = useToast();
  const [taches, setTaches] = useState(initiales);
  const [qui, setQui] = useState("tous");
  const [categorie, setCategorie] = useState("toutes");
  const [statut, setStatut] = useState("tous");
  const [recherche, setRecherche] = useState("");

  useEffect(() => setTaches(initiales), [initiales]);

  const categories = useMemo(
    () => [...new Set([...Object.keys(TODO_CATEGORIES), ...taches.map((t) => t.categorie).filter((c): c is string => Boolean(c))])],
    [taches],
  );

  const visibles = taches.filter((t) => {
    if (qui === "moi" && !t.assignee_ids.includes(moi)) return false;
    if (qui === "personne" && t.assignee_ids.length) return false;
    if (!["tous", "moi", "personne"].includes(qui) && !t.assignee_ids.includes(qui)) return false;
    if (categorie !== "toutes" && (t.categorie ?? "") !== (categorie === "aucune" ? "" : categorie)) return false;
    if (statut === "ouvertes" && t.statut === "fait") return false;
    if (!["tous", "ouvertes"].includes(statut) && t.statut !== statut) return false;
    if (recherche.trim()) {
      const q = recherche.trim().toLowerCase();
      const texte = [t.titre, t.details, ...Object.values(t.commentaires ?? {})].join(" ").toLowerCase();
      if (!texte.includes(q)) return false;
    }
    return true;
  });

  async function maj(id: string, patch: Partial<TacheModifiable>) {
    const avant = taches;
    setTaches((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const r = await majTache(id, patch);
    if (!r.ok) {
      setTaches(avant);
      return toast(r.error, "error");
    }
    setTaches((ts) => ts.map((t) => (t.id === id ? r.data! : t)));
  }

  async function commenter(id: string, texte: string) {
    const r = await majCommentaire(id, texte);
    if (!r.ok) return toast(r.error, "error");
    setTaches((ts) => ts.map((t) => (t.id === id ? r.data! : t)));
  }

  async function supprimer(t: Todo) {
    if (!window.confirm(`Supprimer « ${t.titre} » ?`)) return;
    const r = await supprimerTache(t.id);
    if (!r.ok) return toast(r.error, "error");
    setTaches((ts) => ts.filter((x) => x.id !== t.id));
  }

  async function ajouter(titre: string) {
    const r = await creerTache({
      titre,
      assignee_ids: qui !== "tous" && qui !== "personne" ? [qui === "moi" ? moi : qui] : [moi],
      categorie: categorie !== "toutes" && categorie !== "aucune" ? categorie : null,
      statut: statut !== "tous" && statut !== "ouvertes" ? (statut as TodoStatut) : "a_faire",
    });
    if (!r.ok) {
      toast(r.error, "error");
      return false;
    }
    setTaches((ts) => [...ts, r.data!]);
    return true;
  }

  const aujourdhui = todayIso();
  const ouvertes = visibles.filter((t) => t.statut !== "fait").length;

  return (
    <div className="flex flex-col gap-3">
      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <Filtre valeur={qui} onChange={setQui} label="Qui">
          <option value="tous">Tout le monde</option>
          <option value="moi">Moi</option>
          {membres
            .filter((m) => m.id !== moi)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {prenom(m.nom)}
              </option>
            ))}
          <option value="personne">Personne</option>
        </Filtre>
        <Filtre valeur={categorie} onChange={setCategorie} label="Catégorie">
          <option value="toutes">Toutes catégories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="aucune">Sans catégorie</option>
        </Filtre>
        <Filtre valeur={statut} onChange={setStatut} label="Statut">
          <option value="tous">Tous statuts</option>
          <option value="ouvertes">Non faites</option>
          {TODO_STATUT_ORDER.map((s) => (
            <option key={s} value={s}>
              {TODO_STATUT[s].label}
            </option>
          ))}
        </Filtre>
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher"
            className="h-8 w-44 rounded-lg bg-[var(--surface-input)] pr-2 pl-8 ring-1 ring-[var(--border-subtle)] outline-none focus:ring-brand-500/60"
          />
        </label>
        <span className="ml-auto text-[12px] text-[var(--text-muted)]">
          {visibles.length} ligne{visibles.length > 1 ? "s" : ""} · {ouvertes} non faite{ouvertes > 1 ? "s" : ""}
        </span>
      </div>

      {/* Le tableau */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised,var(--surface-base))]">
        <table className="w-full min-w-[1400px] table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-[56px]" />
            <col className="w-[300px]" />
            <col className="w-[140px]" />
            <col className="w-[130px]" />
            <col className="w-[110px]" />
            <col className="w-[280px]" />
            <col className="w-[120px]" />
            {membres.map((m) => (
              <col key={m.id} className="w-[210px]" />
            ))}
            <col className="w-[36px]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-[var(--surface-hover)] text-left text-[11.5px] font-semibold text-[var(--text-secondary)]">
            <tr>
              {["Prio", "Tâche", "Catégorie", "Statut", "Qui", "Détails", "Quand", ...membres.map((m) => `Com ${prenom(m.nom)}`), ""].map(
                (t, i) => (
                  <th key={`${t}${i}`} className="border-r border-b border-[var(--border-subtle)] px-2 py-2 last:border-r-0">
                    {t}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {visibles.map((t) => (
              <Ligne
                key={t.id}
                t={t}
                membres={membres}
                moi={moi}
                categories={categories}
                aujourdhui={aujourdhui}
                onMaj={(patch) => void maj(t.id, patch)}
                onCommentaire={(texte) => void commenter(t.id, texte)}
                onSupprimer={() => void supprimer(t)}
              />
            ))}
            <NouvelleLigne colonnes={7 + membres.length} onAjouter={ajouter} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Filtre({
  valeur,
  onChange,
  label,
  children,
}: {
  valeur: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={valeur}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="h-8 rounded-lg bg-[var(--surface-input)] px-2 ring-1 ring-[var(--border-subtle)] outline-none focus:ring-brand-500/60"
    >
      {children}
    </select>
  );
}

/* ------------------------------------------------------------ Cellules */

const CELLULE = "border-r border-b border-[var(--border-subtle)] align-top last:border-r-0";

/**
 * Un texte modifiable sur place, qui grandit avec son contenu — comme une
 * cellule de tableur qui passe à la ligne. Entrée valide, Maj+Entrée ajoute
 * une ligne, Échap annule.
 */
function Texte({
  valeur,
  onSave,
  placeholder,
  lectureSeule,
  className,
}: {
  valeur: string;
  onSave: (v: string) => void;
  placeholder?: string;
  lectureSeule?: boolean;
  className?: string;
}) {
  const [texte, setTexte] = useState(valeur);
  const ref = useRef<HTMLTextAreaElement>(null);
  const focus = useRef(false);

  useEffect(() => {
    if (!focus.current) setTexte(valeur);
  }, [valeur]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [texte]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={texte}
      readOnly={lectureSeule}
      placeholder={placeholder}
      onFocus={() => (focus.current = true)}
      onChange={(e) => setTexte(e.target.value)}
      onBlur={() => {
        focus.current = false;
        if (texte !== valeur) onSave(texte);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setTexte(valeur);
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
      className={cn(
        "block w-full resize-none overflow-hidden bg-transparent px-2 py-1.5 leading-snug outline-none",
        "placeholder:text-[var(--text-muted)]/60 focus:bg-[var(--surface-input)] focus:ring-2 focus:ring-brand-500/50 focus:ring-inset",
        lectureSeule && "cursor-default focus:bg-transparent focus:ring-0",
        className,
      )}
    />
  );
}

/** Une liste déroulante en pastille colorée, comme les menus du Sheet. */
function Pastille({
  valeur,
  tone,
  onChange,
  label,
  children,
}: {
  valeur: string;
  tone: Tone | null;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-1.5 py-1">
      <select
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(
          "w-full cursor-pointer appearance-none truncate rounded-full px-2.5 py-0.5 text-[12px] font-medium ring-1 outline-none",
          tone ? TONE_CLASSES[tone] : "text-[var(--text-muted)] ring-[var(--border-subtle)]",
        )}
      >
        {children}
      </select>
    </div>
  );
}

function Ligne({
  t,
  membres,
  moi,
  categories,
  aujourdhui,
  onMaj,
  onCommentaire,
  onSupprimer,
}: {
  t: Todo;
  membres: Membre[];
  moi: string;
  categories: string[];
  aujourdhui: string;
  onMaj: (patch: Partial<TacheModifiable>) => void;
  onCommentaire: (texte: string) => void;
  onSupprimer: () => void;
}) {
  const fait = t.statut === "fait";
  const enRetard = !fait && t.due_on !== null && t.due_on < aujourdhui;
  // « Qui » comme dans le Sheet : un prénom, ou « L+R » quand c'est tout le monde.
  const tous = membres.length > 1 && membres.every((m) => t.assignee_ids.includes(m.id));
  const valeurQui = tous ? "tous" : (t.assignee_ids[0] ?? "");
  const initialesEquipe = membres.map((m) => prenom(m.nom).charAt(0).toUpperCase()).join("+");

  return (
    <tr className="group hover:bg-[var(--surface-hover)]/30">
      <td className={cn(CELLULE, "text-center")}>
        <select
          value={t.priorite ?? ""}
          onChange={(e) => onMaj({ priorite: e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : null })}
          aria-label="Priorité"
          className={cn(
            "mt-1 w-10 cursor-pointer appearance-none rounded bg-transparent py-0.5 text-center font-semibold outline-none hover:bg-[var(--surface-hover)]",
            t.priorite === 1 && "text-rose-600 dark:text-rose-400",
            t.priorite === 2 && "text-amber-600 dark:text-amber-400",
          )}
        >
          <option value="">–</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </select>
      </td>
      <td className={CELLULE}>
        <Texte
          valeur={t.titre}
          onSave={(v) => (v.trim() ? onMaj({ titre: v }) : undefined)}
          className={cn(fait && "text-[var(--text-muted)]")}
        />
      </td>
      <td className={CELLULE}>
        <Pastille
          valeur={t.categorie ?? ""}
          tone={t.categorie ? toneCategorie(t.categorie) : null}
          label="Catégorie"
          onChange={(v) => {
            if (v === "__nouvelle") {
              const nom = window.prompt("Nouvelle catégorie");
              if (nom?.trim()) onMaj({ categorie: nom.trim() });
              return;
            }
            onMaj({ categorie: v || null });
          }}
        >
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="__nouvelle">＋ Nouvelle…</option>
        </Pastille>
      </td>
      <td className={CELLULE}>
        <Pastille
          valeur={t.statut}
          tone={TODO_STATUT[t.statut].tone}
          label="Statut"
          onChange={(v) => onMaj({ statut: v as TodoStatut })}
        >
          {TODO_STATUT_ORDER.map((s) => (
            <option key={s} value={s}>
              {TODO_STATUT[s].label}
            </option>
          ))}
        </Pastille>
      </td>
      <td className={CELLULE}>
        <select
          value={valeurQui}
          onChange={(e) =>
            onMaj({ assignee_ids: e.target.value === "tous" ? membres.map((m) => m.id) : e.target.value ? [e.target.value] : [] })
          }
          aria-label="Qui"
          className="w-full cursor-pointer appearance-none bg-transparent px-2 py-1.5 outline-none hover:bg-[var(--surface-hover)]"
        >
          <option value="">—</option>
          {membres.map((m) => (
            <option key={m.id} value={m.id}>
              {prenom(m.nom)}
            </option>
          ))}
          {membres.length > 1 ? <option value="tous">{initialesEquipe}</option> : null}
        </select>
      </td>
      <td className={CELLULE}>
        <Texte valeur={t.details ?? ""} onSave={(v) => onMaj({ details: v })} className="text-[12.5px]" />
      </td>
      <td className={CELLULE}>
        <input
          type="date"
          value={t.due_on ?? ""}
          onChange={(e) => onMaj({ due_on: e.target.value || null })}
          aria-label="Quand"
          className={cn(
            "w-full cursor-pointer bg-transparent px-2 py-1.5 text-[12.5px] tabular-nums outline-none hover:bg-[var(--surface-hover)]",
            // Case vide : pas de « jj/mm/aaaa » gris sur chaque ligne, seulement l'icône.
            !t.due_on && "text-transparent focus:text-[var(--text-muted)] [&::-webkit-calendar-picker-indicator]:opacity-30",
            enRetard && "font-medium text-rose-600 dark:text-rose-400",
          )}
        />
      </td>
      {membres.map((m) => (
        <td key={m.id} className={CELLULE}>
          <Texte
            valeur={t.commentaires?.[m.id] ?? ""}
            onSave={onCommentaire}
            lectureSeule={m.id !== moi}
            className="text-[12.5px]"
          />
        </td>
      ))}
      <td className={cn(CELLULE, "text-center")}>
        <button
          type="button"
          onClick={onSupprimer}
          aria-label="Supprimer la tâche"
          className="mt-1 rounded p-1 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-500 focus:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      </td>
    </tr>
  );
}

/** La ligne vide du bas : on tape la tâche, Entrée, et la suivante attend déjà. */
function NouvelleLigne({ colonnes, onAjouter }: { colonnes: number; onAjouter: (titre: string) => Promise<boolean> }) {
  const [titre, setTitre] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function valider() {
    if (!titre.trim() || envoi) return;
    setEnvoi(true);
    const ok = await onAjouter(titre.trim());
    setEnvoi(false);
    if (ok) setTitre("");
  }

  return (
    <tr>
      <td className={cn(CELLULE, "text-center text-[var(--text-muted)]")}>
        <Plus className="mx-auto mt-2 size-3.5" />
      </td>
      <td className={CELLULE} colSpan={colonnes}>
        <input
          value={titre}
          disabled={envoi}
          onChange={(e) => setTitre(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void valider()}
          onBlur={() => void valider()}
          placeholder="Nouvelle tâche… (Entrée pour ajouter)"
          aria-label="Nouvelle tâche"
          className="w-full bg-transparent px-2 py-2 outline-none placeholder:text-[var(--text-muted)] focus:bg-[var(--surface-input)]"
        />
      </td>
    </tr>
  );
}
