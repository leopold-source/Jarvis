"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import {
  Bold,
  Clock,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  LayoutTemplate,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Maximize2,
  Minimize2,
  NotebookPen,
  Quote,
  RefreshCw,
  Sparkles,
  Strikethrough,
  Underline,
} from "lucide-react";

import { Button, useToast } from "@/components/ui";
import type { DealStage } from "@/lib/database.types";
import { noteVide, resumeEnHtml, trameHtml } from "@/lib/notes-logique";
import type { SyntheseAffaire } from "@/lib/synthese-affaire";
import { cn, formatDateHeure, formatHeure } from "@/lib/utils";
import {
  enregistrerNote,
  fetchNotes,
  genererSynthese,
  type NotesAffaire,
} from "@/app/(crm)/affaires/notes-actions";

type Quelle = "r1" | "r2";

const APRES_R1: DealStage[] = ["r2", "propale_envoyee", "gagne"];

/**
 * Le suivi d'une affaire : la synthèse en haut, le détail dessous.
 *
 * La synthèse IA donne la vue d'ensemble en trente secondes et ne se
 * régénère que sur un clic. Les notes R1 et R2 sont le détail, prises à la
 * main pendant ou après le rendez-vous, dans un vrai éditeur.
 */
export function DealSuivi({ dealId, stage }: { dealId: string; stage: DealStage }) {
  const [notes, setNotes] = useState<NotesAffaire | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<Quelle>(APRES_R1.includes(stage) ? "r2" : "r1");

  useEffect(() => {
    setNotes(null);
    setErreur(null);
    void fetchNotes(dealId).then((r) => (r.ok ? setNotes(r.data!) : setErreur(r.error)));
  }, [dealId]);

  if (erreur) return <p className="text-[12.5px] text-rose-500">{erreur}</p>;
  if (!notes) {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
        <Loader2 className="size-3.5 animate-spin" /> Chargement du suivi…
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <SyntheseIA
        dealId={dealId}
        initiale={notes.synthese}
        le={notes.synthese_at}
        notesModifieesLe={notes.notes_updated_at}
      />

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
            <NotebookPen className="size-3.5 text-brand-500 dark:text-brand-300" />
            Notes de rendez-vous
          </h3>
          <div role="tablist" className="ml-auto flex rounded-lg bg-[var(--surface-hover)] p-0.5">
            {(["r1", "r2"] as const).map((q) => {
              const rempli = !noteVide(q === "r1" ? notes.note_r1 : notes.note_r2);
              return (
                <button
                  key={q}
                  type="button"
                  role="tab"
                  aria-selected={onglet === q}
                  onClick={() => setOnglet(q)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                    onglet === q
                      ? "bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-sm"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                  )}
                >
                  {q.toUpperCase()}
                  {rempli ? <span className="size-1.5 rounded-full bg-brand-500" aria-label="renseignée" /> : null}
                </button>
              );
            })}
          </div>
        </div>
        <NoteEditeur
          key={`${dealId}-${onglet}`}
          dealId={dealId}
          quelle={onglet}
          initial={(onglet === "r1" ? notes.note_r1 : notes.note_r2) ?? ""}
          calls={notes.calls}
          onEnregistre={(html, at) =>
            setNotes((n) => (n ? { ...n, [onglet === "r1" ? "note_r1" : "note_r2"]: html, notes_updated_at: at } : n))
          }
        />
      </section>
    </div>
  );
}

/* --------------------------------------------------------- Synthèse IA */

function SyntheseIA({
  dealId,
  initiale,
  le,
  notesModifieesLe,
}: {
  dealId: string;
  initiale: SyntheseAffaire | null;
  le: string | null;
  notesModifieesLe: string | null;
}) {
  const toast = useToast();
  const [synthese, setSynthese] = useState(initiale);
  const [date, setDate] = useState(le);
  const [enCours, setEnCours] = useState(false);

  async function generer() {
    setEnCours(true);
    const r = await genererSynthese(dealId);
    setEnCours(false);
    if (!r.ok) return toast(r.error, "error");
    setSynthese(r.data!.synthese);
    setDate(r.data!.at);
  }

  const perimee = Boolean(date && notesModifieesLe && notesModifieesLe > date);

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 p-3.5">
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
          <Sparkles className="size-3.5 text-brand-500 dark:text-brand-300" />
          Synthèse de l&apos;affaire
        </h3>
        {date ? (
          <span className={cn("text-[11px]", perimee ? "text-amber-600 dark:text-amber-300" : "text-[var(--text-muted)]")}>
            {perimee ? "notes modifiées depuis le " : "au "}
            {formatDateHeure(date)}
          </span>
        ) : null}
        <Button variant="ghost" size="sm" className="ml-auto" loading={enCours} onClick={() => void generer()}>
          {enCours ? null : synthese ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-3.5" />}
          {synthese ? "Actualiser" : "Générer"}
        </Button>
      </div>

      {!synthese ? (
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
          Une vue d&apos;ensemble de toutes les interactions — prospection, calls, notes, mails, devis — générée à la
          demande.
        </p>
      ) : (
        <div className="mt-2.5 space-y-2.5 text-[12.5px] leading-relaxed">
          <p className="font-medium">{synthese.situation}</p>
          <Bloc titre="Besoin">
            <p>{synthese.besoin}</p>
          </Bloc>
          {synthese.interlocuteurs.length ? (
            <Bloc titre="Interlocuteurs">
              <ul className="list-disc space-y-0.5 pl-4">
                {synthese.interlocuteurs.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </Bloc>
          ) : null}
          {synthese.jalons.length ? (
            <Bloc titre="Jalons">
              <ol className="space-y-0.5">
                {synthese.jalons.map((j, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-20 shrink-0 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">{j.date}</span>
                    <span>{j.fait}</span>
                  </li>
                ))}
              </ol>
            </Bloc>
          ) : null}
          {synthese.points_ouverts.length ? (
            <Bloc titre="Points ouverts">
              <ul className="list-disc space-y-0.5 pl-4">
                {synthese.points_ouverts.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Bloc>
          ) : null}
          <p className="rounded-lg bg-brand-500/10 px-2.5 py-1.5 text-[12.5px]">
            <span className="font-medium text-brand-600 dark:text-brand-300">Prochaine action · </span>
            {synthese.prochaine_action}
          </p>
        </div>
      )}
    </section>
  );
}

function Bloc({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-[10.5px] font-medium tracking-wide text-[var(--text-muted)] uppercase">{titre}</p>
      {children}
    </div>
  );
}

/* --------------------------------------------------------- Éditeur */

const DELAI_SAUVEGARDE = 900;

function NoteEditeur({
  dealId,
  quelle,
  initial,
  calls,
  onEnregistre,
}: {
  dealId: string;
  quelle: Quelle;
  initial: string;
  calls: NotesAffaire["calls"];
  onEnregistre: (html: string, at: string) => void;
}) {
  const toast = useToast();
  const [etat, setEtat] = useState<{ type: "repos" | "attente" | "ecriture" | "ok" | "erreur"; at?: string }>({
    type: "repos",
  });
  const [plein, setPlein] = useState(false);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aEcrire = useRef<string | null>(null);
  const dernier = useRef(initial);

  const surEnregistre = useRef(onEnregistre);
  surEnregistre.current = onEnregistre;

  const sauver = useCallback(async () => {
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = null;
    const html = aEcrire.current;
    if (html === null || html === dernier.current) return;
    aEcrire.current = null;
    setEtat({ type: "ecriture" });
    const r = await enregistrerNote(dealId, quelle, html);
    if (!r.ok) {
      aEcrire.current = html;
      setEtat({ type: "erreur" });
      toast(r.error, "error");
      return;
    }
    dernier.current = html;
    setEtat({ type: "ok", at: r.data!.at });
    surEnregistre.current(html, r.data!.at);
  }, [dealId, quelle, toast]);
  const sauverRef = useRef(sauver);
  sauverRef.current = sauver;

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: `Notes du ${quelle.toUpperCase()}… « # » titre, « - » liste, « [ ] » case à cocher`,
      }),
    ],
    content: initial,
    editorProps: { attributes: { class: "note-riche" } },
    onUpdate: ({ editor: e }) => {
      aEcrire.current = e.getHTML();
      setEtat({ type: "attente" });
      if (minuteur.current) clearTimeout(minuteur.current);
      minuteur.current = setTimeout(() => void sauverRef.current(), DELAI_SAUVEGARDE);
    },
    onBlur: () => void sauverRef.current(),
  });

  // Rien ne se perd en changeant d'onglet ou en fermant l'affaire.
  useEffect(() => () => void sauverRef.current(), []);

  useEffect(() => {
    if (!plein) return;
    const echap = (e: KeyboardEvent) => e.key === "Escape" && setPlein(false);
    document.addEventListener("keydown", echap);
    return () => document.removeEventListener("keydown", echap);
  }, [plein]);

  if (!editor) return <div className="h-40 rounded-xl bg-[var(--surface-input)]" />;

  const vide = editor.isEmpty || noteVide(editor.getHTML());
  const corps = (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl bg-[var(--surface-input)] ring-1 ring-[var(--border-subtle)] focus-within:ring-2 focus-within:ring-brand-500/60",
        plein && "h-full",
      )}
    >
      <BarreOutils
        editor={editor}
        quelle={quelle}
        vide={vide}
        calls={calls}
        plein={plein}
        onPlein={() => setPlein((p) => !p)}
      />
      <div className={cn("overflow-y-auto px-3.5 py-3", plein ? "flex-1" : "max-h-[55vh] min-h-40")}>
        <EditorContent editor={editor} />
      </div>
      <p className="flex items-center gap-1.5 border-t border-[var(--border-subtle)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
        {etat.type === "ecriture" || etat.type === "attente" ? (
          <>
            <Loader2 className="size-3 animate-spin" /> Enregistrement…
          </>
        ) : etat.type === "ok" ? (
          `Enregistré à ${formatHeure(etat.at)}`
        ) : etat.type === "erreur" ? (
          <span className="text-rose-500">Non enregistré — réessai à la prochaine frappe</span>
        ) : (
          "Enregistrement automatique"
        )}
      </p>
    </div>
  );

  if (!plein) return corps;
  // Plein écran : hors du tiroir, pour prendre des notes pendant le call.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-[var(--surface-base)] p-3 sm:p-8">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col">{corps}</div>
    </div>,
    document.body,
  );
}

function BarreOutils({
  editor,
  quelle,
  vide,
  calls,
  plein,
  onPlein,
}: {
  editor: Editor;
  quelle: Quelle;
  vide: boolean;
  calls: NotesAffaire["calls"];
  plein: boolean;
  onPlein: () => void;
}) {
  const c = () => editor.chain().focus();
  const outils: Array<{ icone: typeof Bold; titre: string; actif: boolean; faire: () => void } | "sep"> = [
    { icone: Heading2, titre: "Titre", actif: editor.isActive("heading", { level: 2 }), faire: () => c().toggleHeading({ level: 2 }).run() },
    { icone: Heading3, titre: "Sous-titre", actif: editor.isActive("heading", { level: 3 }), faire: () => c().toggleHeading({ level: 3 }).run() },
    "sep",
    { icone: Bold, titre: "Gras (⌘B)", actif: editor.isActive("bold"), faire: () => c().toggleBold().run() },
    { icone: Italic, titre: "Italique (⌘I)", actif: editor.isActive("italic"), faire: () => c().toggleItalic().run() },
    { icone: Underline, titre: "Souligné (⌘U)", actif: editor.isActive("underline"), faire: () => c().toggleUnderline().run() },
    { icone: Strikethrough, titre: "Barré", actif: editor.isActive("strike"), faire: () => c().toggleStrike().run() },
    { icone: Highlighter, titre: "Surligner", actif: editor.isActive("highlight"), faire: () => c().toggleHighlight().run() },
    "sep",
    { icone: List, titre: "Liste", actif: editor.isActive("bulletList"), faire: () => c().toggleBulletList().run() },
    { icone: ListOrdered, titre: "Liste numérotée", actif: editor.isActive("orderedList"), faire: () => c().toggleOrderedList().run() },
    { icone: ListChecks, titre: "Cases à cocher", actif: editor.isActive("taskList"), faire: () => c().toggleTaskList().run() },
    { icone: Quote, titre: "Citation", actif: editor.isActive("blockquote"), faire: () => c().toggleBlockquote().run() },
    {
      icone: Link2,
      titre: "Lien",
      actif: editor.isActive("link"),
      faire: () => {
        const avant = editor.getAttributes("link").href as string | undefined;
        const url = window.prompt("Adresse du lien", avant ?? "https://");
        if (url === null) return;
        if (!url.trim()) c().extendMarkRange("link").unsetLink().run();
        else c().extendMarkRange("link").setLink({ href: url.trim() }).run();
      },
    },
    "sep",
    {
      icone: Clock,
      titre: "Horodater",
      actif: false,
      faire: () =>
        c()
          .insertContent(`<p><mark>${formatDateHeure(new Date().toISOString())}</mark> </p>`)
          .run(),
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--border-subtle)] px-1.5 py-1">
      {outils.map((o, i) =>
        o === "sep" ? (
          <span key={`s${i}`} className="mx-1 h-4 w-px bg-[var(--border-subtle)]" aria-hidden />
        ) : (
          <button
            key={o.titre}
            type="button"
            title={o.titre}
            aria-label={o.titre}
            aria-pressed={o.actif}
            onMouseDown={(e) => e.preventDefault()}
            onClick={o.faire}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              o.actif
                ? "bg-brand-500/15 text-brand-600 dark:text-brand-300"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
            )}
          >
            <o.icone className="size-3.5" />
          </button>
        ),
      )}

      <span className="ml-auto flex items-center gap-1">
        {vide ? (
          <button
            type="button"
            onClick={() => c().setContent(trameHtml(quelle)).focus("start").run()}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            <LayoutTemplate className="size-3.5" /> Trame {quelle.toUpperCase()}
          </button>
        ) : null}
        {calls.length ? (
          <select
            value=""
            aria-label="Insérer un résumé Claap"
            onChange={(e) => {
              const call = calls.find((x) => x.id === e.target.value);
              if (call) {
                c()
                  .insertContent(
                    resumeEnHtml(`Résumé Claap — ${call.titre}${call.quand ? ` (${formatDateHeure(call.quand)})` : ""}`, call.resume),
                  )
                  .run();
              }
            }}
            className="max-w-40 rounded-md bg-transparent px-1 py-1 text-[11.5px] text-[var(--text-muted)] outline-none hover:bg-[var(--surface-hover)]"
          >
            <option value="">+ Résumé Claap</option>
            {calls.map((call) => (
              <option key={call.id} value={call.id}>
                {call.titre}
                {call.quand ? ` · ${formatDateHeure(call.quand)}` : ""}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          title={plein ? "Réduire (Échap)" : "Plein écran"}
          aria-label={plein ? "Réduire" : "Plein écran"}
          onClick={onPlein}
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        >
          {plein ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </span>
    </div>
  );
}
