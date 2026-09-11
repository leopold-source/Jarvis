"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  Linkedin,
  Loader2,
  EyeOff,
  Phone,
  Plus,
  Rocket,
  Rows3,
  Sparkles,
  Table2,
  Upload,
  UserRound,
  Users2,
  ClipboardPaste,
  X,
} from "lucide-react";

import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  SearchInput,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { DateField } from "@/components/ui/date-field";
import { LEAD_STATUS, LEAD_STATUS_ORDER, TONE_CLASSES, TONE_DOT } from "@/lib/constants";
import type { Lead, LeadStatus } from "@/lib/database.types";
import { cn, daysUntil, formatDate, formatMoney, normalize } from "@/lib/utils";
import {
  assignLead,
  convertLead,
  createLead,
  updateLead,
  updateLeads,
  type BulkField,
} from "@/app/(crm)/leads/actions";
import { useCellSelection, type CellSelection } from "@/lib/use-cell-selection";
import { ImportLeadsDialog } from "@/components/crm/import-leads-dialog";
import { buildOrgIndex, spreadByOrg, type OrgLink } from "@/lib/lead-orgs";
import { LeadDrawer } from "@/components/crm/lead-drawer";

const PAGE_SIZE = 60;

/**
 * Statuts qui restent à relancer même sans date planifiée.
 *
 * Un NRP ou un « à recontacter » sans date n'est pas un lead mort : c'est un
 * lead qu'on a oublié de replanifier. Le mode prospection les fait remonter
 * après les relances dues, pour qu'il y ait toujours de quoi appeler.
 */
const RELANCE_SANS_DATE: LeadStatus[] = ["nrp", "nrp2", "nrp3", "a_recontacter"];

/** Jamais appelé : la réserve dans laquelle on puise quand les relances sont faites. */
const JAMAIS_APPELE: LeadStatus[] = ["a_contacter"];

/**
 * Hauteurs de ligne, à la manière d'Airtable.
 *
 * Prospecter, c'est balayer une liste : on veut le plus de lignes possible à
 * l'écran. Consulter, c'est lire : on veut de l'air. Plutôt que d'arbitrer à
 * la place de l'utilisateur, on lui laisse le curseur — et on retient son
 * choix, parce que c'est une préférence, pas une décision à reprendre chaque
 * matin.
 */
const DENSITIES = {
  compacte: { label: "Compacte", row: "h-6", cell: "py-0", text: "text-[12px]", avatar: 16 },
  normale: { label: "Normale", row: "h-8", cell: "py-0.5", text: "text-[12.5px]", avatar: 18 },
  confort: { label: "Confort", row: "h-11", cell: "py-1.5", text: "text-[13px]", avatar: 22 },
} as const;

type Density = keyof typeof DENSITIES;
const DENSITY_ORDER = Object.keys(DENSITIES) as Density[];
const DENSITY_STORAGE_KEY = "antichaos.leads.density";

type MemberLite = { id: string; full_name: string | null; email: string; role: string };
type ViewMode = "lecture" | "prospection";

/**
 * Filtre sur la présence d'un numéro.
 *
 * « Renseigné » vaut pour le portable comme pour le standard : c'est la
 * question qu'on se pose vraiment — puis-je appeler cette fiche ? Un filtre qui
 * ne regarderait que le portable écarterait des centaines de lignes appelables.
 */
const PHONE_FILTERS = {
  tous: { label: "Téléphone : indifférent", keep: () => true },
  renseigne: { label: "Téléphone renseigné", keep: (lead: Lead) => Boolean(lead.phone ?? lead.phone_standard) },
  portable: { label: "Portable uniquement", keep: (lead: Lead) => Boolean(lead.phone) },
  vide: { label: "Téléphone vide", keep: (lead: Lead) => !lead.phone && !lead.phone_standard },
} as const;

type PhoneFilter = keyof typeof PHONE_FILTERS;

/**
 * Rang d'un lead dans la file d'appel.
 *
 * Une relance promise passe avant un premier appel : le retard, puis le jour
 * même, puis les relances qu'aucune date ne porte plus, puis seulement les
 * fiches jamais travaillées. Sans ce dernier rang, les 239 leads d'un import
 * noieraient les quelques rappels réellement dus.
 */
function prospectionRank(lead: Lead, today: string): number {
  if (lead.follow_up_on && lead.follow_up_on < today) return 0;
  if (lead.follow_up_on === today) return 1;
  if (JAMAIS_APPELE.includes(lead.status)) return 3;
  return 2;
}

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function LeadsWorkspace({
  leads,
  members,
  currentUserId,
  orgCooldownDays,
  isAdmin,
}: {
  leads: Lead[];
  members: MemberLite[];
  currentUserId: string;
  orgCooldownDays: number;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [region, setRegion] = useState("toutes");
  const [segment, setSegment] = useState("tous");
  const [owner, setOwner] = useState("tous");
  const [view, setView] = useState<ViewMode>("lecture");
  const [showOverdue, setShowOverdue] = useState(true);
  const [onlyGrouped, setOnlyGrouped] = useState(false);
  const [phoneFilter, setPhoneFilter] = useState<PhoneFilter>("tous");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [density, setDensity] = useState<Density>("compacte");

  // La préférence est relue après le premier rendu : la lire pendant
  // l'hydratation ferait diverger le serveur et le client.
  useEffect(() => {
    const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    if (stored && stored in DENSITIES) setDensity(stored as Density);
  }, []);

  function chooseDensity(next: Density) {
    setDensity(next);
    window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
  }

  const [selected, setSelected] = useState<Lead | null>(null);

  /*
    Copier une valeur, puis la coller sur la plage retenue.

    On ne mémorise que le champ et sa valeur, jamais la ligne d'origine : ce
    qu'on colle est une valeur, pas un lien vers une fiche.
  */
  const [copied, setCopied] = useState<{ field: BulkField; value: string | null; label: string } | null>(
    null,
  );
  const [pasting, setPasting] = useState(false);

  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  /*
    Mise à jour optimiste.

    Une modification passait par le serveur, une revalidation et un nouveau
    rendu des 432 lignes avant de s'afficher — une à deux secondes pendant
    lesquelles la valeur affichée était encore l'ancienne. On applique donc le
    changement localement tout de suite, et le serveur ne sert plus qu'à
    confirmer : `overrides` garde la valeur voulue jusqu'à ce que les données
    fraîches arrivent, moment où il n'a plus de raison d'être.
  */
  const [overrides, setOverrides] = useState<Record<string, Partial<Lead>>>({});
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setOverrides({}), [leads]);

  const applyLocal = useCallback((ids: string[], patch: Partial<Lead>) => {
    setOverrides((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = { ...next[id], ...patch };
      return next;
    });
  }, []);

  /*
    Le rafraîchissement est différé et groupé.

    Puisque l'écran est déjà juste, rien ne presse : enchaîner dix statuts
    déclenchait dix rendus complets du serveur, chacun ralentissant le
    suivant. Un seul, une seconde après le dernier geste, suffit à réconcilier.
  */
  const refresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      startTransition(() => router.refresh());
    }, 1000);
    // `startTransition` et `router` sont stables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  /** Les leads tels qu'ils doivent s'afficher : données du serveur, corrections en attente par-dessus. */
  const rows = useMemo(
    () => leads.map((lead) => (overrides[lead.id] ? { ...lead, ...overrides[lead.id] } : lead)),
    [leads, overrides],
  );

  // Permet d'ouvrir un lead directement depuis un lien (?lead=…).
  useEffect(() => {
    const id = params.get("lead");
    if (!id) return;
    const match = rows.find((lead) => lead.id === id);
    if (match) setSelected(match);
  }, [params, rows]);

  const regions = useMemo(
    () => [...new Set(rows.map((lead) => lead.region).filter(Boolean))].sort() as string[],
    [rows],
  );
  const segments = useMemo(
    () => [...new Set(rows.map((lead) => lead.segment).filter(Boolean))].sort() as string[],
    [rows],
  );

  const counts = useMemo(() => {
    const map = new Map<LeadStatus, number>();
    for (const lead of rows) map.set(lead.status, (map.get(lead.status) ?? 0) + 1);
    return map;
  }, [rows]);

  const today = todayIso();

  /*
    Qui d'autre, chez la même organisation, est déjà dans la base.

    Calculé sur l'ensemble des leads et non sur la vue filtrée : un collègue
    masqué par un filtre de région reste un collègue qu'on a peut-être appelé
    la semaine dernière. C'est précisément celui qu'on ne verrait pas.
  */
  const orgIndex = useMemo(
    () => buildOrgIndex(rows, orgCooldownDays),
    [rows, orgCooldownDays],
  );

  const grouped = useMemo(
    () => rows.filter((lead) => orgIndex.has(lead.id)).length,
    [rows, orgIndex],
  );

  const filtered = useMemo(() => {
    const needle = normalize(search.trim());
    const wanted = new Set(statuses);

    const base = rows.filter((lead) => {
      if (wanted.size > 0 && !wanted.has(lead.status)) return false;
      if (region !== "toutes" && lead.region !== region) return false;
      if (segment !== "tous" && lead.segment !== segment) return false;
      if (owner === "moi" && lead.owner_id !== currentUserId) return false;
      if (owner !== "tous" && owner !== "moi" && lead.owner_id !== owner) return false;
      if (onlyGrouped && !orgIndex.has(lead.id)) return false;
      if (!PHONE_FILTERS[phoneFilter].keep(lead)) return false;
      if (!needle) return true;
      return normalize(
        [lead.full_name, lead.company_name, lead.email, lead.phone, lead.company_activity]
          .filter(Boolean)
          .join(" "),
      ).includes(needle);
    });

    if (view === "lecture") return base;

    // Mode prospection : la file d'appel. Les retards d'abord, puis le jour
    // même, puis les relances orphelines, puis les fiches jamais appelées.
    const queue = base
      .filter((lead) => {
        if (lead.follow_up_on) {
          if (lead.follow_up_on > today) return false;
          if (!showOverdue && lead.follow_up_on < today) return false;
          return true;
        }
        return RELANCE_SANS_DATE.includes(lead.status) || JAMAIS_APPELE.includes(lead.status);
      })
      .sort((a, b) => {
        const rankA = prospectionRank(a, today);
        const rankB = prospectionRank(b, today);
        if (rankA !== rankB) return rankA - rankB;
        // À rang égal : la relance la plus ancienne, sinon le lead le plus vieux.
        const keyA = a.follow_up_on ?? a.created_at;
        const keyB = b.follow_up_on ?? b.created_at;
        return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
      });

    // Deux dirigeants d'un même groupe ne s'enchaînent jamais : c'est là, en
    // descendant la file sans réfléchir, qu'on rappelle la même boîte deux fois.
    return spreadByOrg(queue, orgIndex);
  }, [rows, search, statuses, region, segment, owner, currentUserId, view, showOverdue, today, onlyGrouped, phoneFilter, orgIndex]);

  const dueToday = useMemo(
    () => rows.filter((lead) => lead.follow_up_on === today).length,
    [rows, today],
  );
  const overdue = useMemo(
    () => rows.filter((lead) => lead.follow_up_on && lead.follow_up_on < today).length,
    [rows, today],
  );
  const undated = useMemo(
    () => rows.filter((lead) => !lead.follow_up_on && RELANCE_SANS_DATE.includes(lead.status)).length,
    [rows],
  );
  const jamaisAppeles = useMemo(
    () => rows.filter((lead) => JAMAIS_APPELE.includes(lead.status)).length,
    [rows],
  );

  const size = DENSITIES[density];
  const page = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  // La sélection ne porte que sur les lignes réellement affichées : coller sur
  // une ligne qu'on ne voit pas serait une modification à l'aveugle.
  const pageIds = useMemo(() => page.map((lead) => lead.id), [page]);
  const cells = useCellSelection(pageIds);

  /** Ce qu'une cellule contient, et comment le dire à l'écran. */
  const readCell = useCallback(
    (lead: Lead, field: BulkField): { value: string | null; label: string } => {
      switch (field) {
        case "status":
          return { value: lead.status, label: LEAD_STATUS[lead.status].label };
        case "follow_up_on":
          return {
            value: lead.follow_up_on,
            label: lead.follow_up_on ? formatDate(lead.follow_up_on) : "aucune relance",
          };
        case "owner_id": {
          const member = members.find((entry) => entry.id === lead.owner_id);
          return {
            value: lead.owner_id,
            label: member?.full_name ?? member?.email ?? "non assigné",
          };
        }
        case "comment":
          return {
            value: lead.comment,
            label: lead.comment ? `« ${lead.comment.slice(0, 40)} »` : "commentaire vide",
          };
      }
    },
    [members],
  );

  /*
    Coller : la valeur copiée, sur la plage retenue.

    La colonne doit être la même. Voir la colonne « Commentaire » surlignée et
    des statuts changer serait exactement le genre de surprise qu'on ne peut
    pas défaire — mieux vaut refuser et le dire.
  */
  const applyCopied = useCallback(async () => {
    if (!copied || cells.count === 0 || !cells.field) return;
    if (cells.field !== copied.field) {
      toast("La valeur copiée ne vient pas de cette colonne.", "error");
      return;
    }

    const targets = cells.ids;
    setPasting(true);
    // L'écran suit immédiatement ; le serveur ne fait que confirmer.
    applyLocal(targets, { [copied.field]: copied.value } as Partial<Lead>);
    const result = await updateLeads(targets, copied.field, copied.value);
    setPasting(false);

    if (!result.ok) {
      setOverrides({});
      toast(result.error, "error");
      return;
    }
    toast(`${result.data?.updated ?? 0} ligne(s) mises à jour.`);
    cells.clear();
    refresh();
    // `refresh`, `toast` et `applyLocal` sont stables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copied, cells]);

  /*
    ⌘C / ⌘V, au clavier plutôt qu'au bouton.

    Le raccourci n'est intercepté que si une cellule est désignée et qu'aucun
    texte n'est sélectionné : sans cette réserve, copier trois mots dans un
    commentaire copierait le commentaire entier.
  */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;

      if (event.key === "c" || event.key === "C") {
        const source = cells.anchor;
        if (!source) return;
        if (window.getSelection()?.toString()) return;
        const lead = page.find((entry) => entry.id === source.id);
        if (!lead) return;

        const field = source.field as BulkField;
        const { value, label } = readCell(lead, field);
        event.preventDefault();
        setCopied({ field, value, label });
        void navigator.clipboard?.writeText(value ?? "").catch(() => {});
        toast(`Copié : ${label}`);
        return;
      }

      if (event.key === "v" || event.key === "V") {
        if (!copied || cells.count === 0) return;
        event.preventDefault();
        void applyCopied();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells.anchor, cells.count, copied, page, readCell, applyCopied]);

  // Toute modification des filtres remet la pagination à zéro.
  useEffect(() => setVisible(PAGE_SIZE), [search, statuses, region, segment, owner, view, showOverdue, onlyGrouped, phoneFilter]);

  // Défilement infini : une sentinelle en bas de la liste charge la tranche
  // suivante avant d'être atteinte. L'effet dépend de `visible`, ce qui remet
  // l'observateur en place après chaque chargement — sans quoi une sentinelle
  // restée dans le champ de vision ne déclencherait plus rien.
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisible((current) => current + PAGE_SIZE);
      },
      { root: scroller.current, rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, visible]);

  async function patch(lead: Lead, field: string, value: string | null, silent = false) {
    // L'écran change d'abord. Si le serveur refuse, on efface la correction
    // locale et les données du serveur reprennent la main — l'utilisateur voit
    // sa saisie revenir en arrière, ce qui est le bon signal.
    applyLocal([lead.id], { [field]: value } as Partial<Lead>);

    const result = await updateLead(lead.id, { [field]: value });
    if (!result.ok) {
      setOverrides({});
      toast(result.error, "error");
      return false;
    }
    if (!silent) toast("Enregistré.");
    refresh();
    return true;
  }

  async function handleStatusChange(lead: Lead, next: LeadStatus) {
    // « Call pris » déclenche la conversion, pas un simple changement de statut.
    if (next === "call_pris") {
      setSelected(lead);
      return;
    }
    applyLocal([lead.id], { status: next });

    const result = await updateLead(lead.id, { status: next });
    if (!result.ok) {
      setOverrides({});
      toast(result.error, "error");
      return;
    }
    toast(`Statut : ${LEAD_STATUS[next].label}`);
    refresh();
  }

  return (
    <>
      <Card className="p-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Nom, entreprise, e-mail…"
            className="min-w-56 flex-1"
          />

          <StatusFilter
            selected={statuses}
            counts={counts}
            total={leads.length}
            onChange={setStatuses}
          />

          {regions.length > 0 ? (
            <Select
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              className="w-auto min-w-36"
              aria-label="Filtrer par région"
            >
              <option value="toutes">Toutes les régions</option>
              {regions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          ) : null}

          {segments.length > 0 ? (
            <Select
              value={segment}
              onChange={(event) => setSegment(event.target.value)}
              className="w-auto min-w-44 max-w-64"
              aria-label="Filtrer par campagne"
            >
              <option value="tous">Toutes les campagnes</option>
              {segments.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          ) : null}

          <Select
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            className="w-auto min-w-40"
            aria-label="Filtrer par propriétaire"
          >
            <option value="tous">Tous les propriétaires</option>
            <option value="moi">Mes leads</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name ?? member.email}
              </option>
            ))}
          </Select>

          <Select
            value={phoneFilter}
            onChange={(event) => setPhoneFilter(event.target.value as PhoneFilter)}
            className="w-auto min-w-44"
            aria-label="Filtrer sur la présence d'un téléphone"
          >
            {(Object.keys(PHONE_FILTERS) as PhoneFilter[]).map((key) => (
              <option key={key} value={key}>
                {PHONE_FILTERS[key].label}
              </option>
            ))}
          </Select>

          <span className="ml-auto flex items-center gap-2">
            {isAdmin ? (
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <Upload className="size-4" />
                Importer
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Nouveau lead
            </Button>
          </span>
        </div>

        {/* Bascule de vue : lecture pour explorer, prospection pour appeler. */}
        <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-[var(--border-subtle)] pt-3">
          <div className="flex rounded-[10px] bg-[var(--surface-hover)] p-1 text-[12.5px]">
            {(
              [
                { key: "lecture", label: "Lecture", icon: Table2 },
                { key: "prospection", label: "Prospection", icon: Rocket },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-all duration-200",
                  view === key
                    ? "bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-[var(--shadow-card)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          <span className="ml-auto flex items-center gap-1 rounded-[10px] bg-[var(--surface-hover)] p-1">
            {DENSITY_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => chooseDensity(key)}
                title={`Hauteur de ligne : ${DENSITIES[key].label.toLowerCase()}`}
                aria-pressed={density === key}
                className={cn(
                  "flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] transition-all duration-200",
                  density === key
                    ? "bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-[var(--shadow-card)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
                )}
              >
                <Rows3
                  className={cn(
                    "size-3.5 transition-transform duration-200",
                    key === "compacte" && "scale-y-75",
                    key === "confort" && "scale-y-125",
                  )}
                />
                <span className="hidden sm:inline">{DENSITIES[key].label}</span>
              </button>
            ))}
          </span>

          {grouped > 0 ? (
            <Button
              variant={onlyGrouped ? "secondary" : "subtle"}
              size="sm"
              onClick={() => setOnlyGrouped((value) => !value)}
              title="Les leads qui partagent une organisation ou une ligne téléphonique"
            >
              <Users2 className="size-3.5" />
              {grouped} rattaché{grouped > 1 ? "s" : ""}
            </Button>
          ) : null}

          {view === "prospection" ? (
            <>
              <span className="flex items-center gap-1.5">
                <Badge tone="orange">{dueToday} pour aujourd&apos;hui</Badge>
                {overdue > 0 ? <Badge tone="red">{overdue} en retard</Badge> : null}
                {undated > 0 ? <Badge tone="violet">{undated} sans date</Badge> : null}
                {jamaisAppeles > 0 ? <Badge tone="cyan">{jamaisAppeles} à contacter</Badge> : null}
              </span>
              <Button
                variant={showOverdue ? "secondary" : "subtle"}
                size="sm"
                onClick={() => setShowOverdue((value) => !value)}
                title={showOverdue ? "Masquer les relances en retard" : "Afficher les relances en retard"}
              >
                {showOverdue ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                {showOverdue ? "Retards affichés" : "Retards masqués"}
              </Button>
              <p className="order-first w-full text-[11.5px] text-[var(--text-muted)] lg:order-none lg:w-auto">
                Retards, puis relances du jour, puis les NRP et « à recontacter » sans date.
              </p>
            </>
          ) : (
            <p className="text-[11.5px] text-[var(--text-muted)]">
              Toute la base, dans l&apos;ordre d&apos;ajout.
            </p>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2.5">
          <p className="text-[12.5px] text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text-primary)]">{filtered.length}</span> lead
            {filtered.length > 1 ? "s" : ""}
            {filtered.length !== leads.length ? ` sur ${leads.length}` : ""}
          </p>
          <p className="hidden text-[11.5px] text-[var(--text-muted)] sm:block">
            Statut, téléphone, relance et commentaire s&apos;éditent directement dans le tableau.
          </p>
        </div>

        {/* Le tableau défile dans son propre cadre : l'en-tête reste visible et
            la liste occupe la hauteur utile de l'écran, ce qui compte plus que
            tout quand on enchaîne les appels. */}
        {page.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title="Aucun lead ne correspond"
            description="Ajustez les filtres ou ajoutez un nouveau lead."
          />
        ) : (
          <div ref={scroller} className="max-h-[calc(100vh-17rem)] min-h-64 overflow-auto">
            <table className={cn("w-full min-w-[1380px] text-left", size.text)}>
              <thead className="sticky top-0 z-10 bg-[var(--surface-raised)] text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="w-12 px-2 py-1.5 text-right font-medium">#</th>
                  <th className="px-2.5 py-1.5 font-medium">Contact</th>
                  <th className="px-2.5 py-1.5 font-medium">Poste</th>
                  <th className="px-2.5 py-1.5 font-medium">Entreprise</th>
                  <th className="px-2.5 py-1.5 font-medium">Statut</th>
                  <th className="min-w-40 px-2.5 py-1.5 font-medium">Téléphone</th>
                  <th className="px-2.5 py-1.5 font-medium">Relance</th>
                  <th className="px-2.5 py-1.5 font-medium">Assigné</th>
                  <th className="px-2.5 py-1.5 font-medium">Commentaire</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">CA</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {page.map((lead, index) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelected(lead)}
                    className={cn(
                      size.row,
                      "cursor-pointer transition-colors duration-150 hover:bg-[var(--surface-hover)]/60",
                      view === "prospection" && lead.follow_up_on === today && "bg-brand-500/[0.07]",
                      view === "prospection" &&
                        lead.follow_up_on &&
                        lead.follow_up_on < today &&
                        "bg-rose-500/[0.07]",
                    )}
                  >
                    <td
                      className={cn(
                        "px-2 text-right font-mono text-[11px] text-[var(--text-muted)] tabular-nums select-none",
                        size.cell,
                      )}
                    >
                      {index + 1}
                    </td>

                    <td className={cn("max-w-52 px-2.5", size.cell)}>
                      <p className="flex items-center gap-1 truncate font-medium" title={lead.email ?? undefined}>
                        <span className="truncate">{lead.full_name ?? lead.email ?? "Sans nom"}</span>
                        {lead.linkedin_url ? (
                          <a
                            href={lead.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            title="Profil LinkedIn"
                            className="shrink-0 text-[var(--text-muted)] transition-colors hover:text-brand-400"
                          >
                            <Linkedin className="size-3" />
                          </a>
                        ) : null}
                      </p>
                    </td>

                    <td className={cn("max-w-36 px-2.5 text-[var(--text-muted)]", size.cell)}>
                      <p className="truncate" title={lead.job_title ?? undefined}>
                        {lead.job_title ?? "—"}
                      </p>
                    </td>

                    <td className={cn("max-w-52 px-2.5", size.cell)}>
                      <p className="flex items-center gap-1.5 truncate" title={lead.company_activity ?? undefined}>
                        <span className="truncate">{lead.company_name ?? "—"}</span>
                        <OrgChip link={orgIndex.get(lead.id)} />
                      </p>
                    </td>

                    <CopyableCell
                      field="status"
                      lead={lead}
                      index={index}
                      cells={cells}
                      className={size.cell}
                    >
                      <StatusSelect lead={lead} onChange={handleStatusChange} />
                    </CopyableCell>

                    <td className={cn("px-2.5", size.cell)} onClick={(event) => event.stopPropagation()}>
                      <CopyablePhone
                        phone={lead.phone}
                        standard={lead.phone_standard}
                        dense={density === "compacte"}
                      />
                    </td>

                    <CopyableCell
                      field="follow_up_on"
                      lead={lead}
                      index={index}
                      cells={cells}
                      className={size.cell}
                    >
                      <DateField
                        dense={density !== "confort"}
                        value={lead.follow_up_on}
                        placeholder="Planifier"
                        className="w-32"
                        onChange={(value) => patch(lead, "follow_up_on", value, true)}
                      />
                    </CopyableCell>

                    <CopyableCell
                      field="owner_id"
                      lead={lead}
                      index={index}
                      cells={cells}
                      className={size.cell}
                    >
                      <OwnerSelect
                        lead={lead}
                        members={members}
                        avatarSize={size.avatar}
                        onAssign={async (ownerId) => {
                          const member = members.find((entry) => entry.id === ownerId);
                          applyLocal([lead.id], {
                            owner_id: ownerId,
                            owner_name: member?.full_name ?? member?.email ?? null,
                          });

                          const result = await assignLead(lead.id, ownerId);
                          if (!result.ok) {
                            setOverrides({});
                            toast(result.error, "error");
                            return;
                          }
                          refresh();
                        }}
                      />
                    </CopyableCell>

                    <CopyableCell
                      field="comment"
                      lead={lead}
                      index={index}
                      cells={cells}
                      className={cn("w-56", size.cell)}
                    >
                      <InlineComment
                        value={lead.comment}
                        onCommit={(value) => patch(lead, "comment", value)}
                      />
                    </CopyableCell>

                    <td className={cn("px-2.5 text-right tabular-nums text-[var(--text-secondary)]", size.cell)}>
                      {formatMoney(lead.revenue, true)}
                    </td>

                    <td className={cn("px-2 text-right", size.cell)}>
                      {lead.converted_deal_id ? (
                        <Badge tone="emerald">
                          <ExternalLink className="size-3" />
                          Converti
                        </Badge>
                      ) : (
                        <ArrowRight className="ml-auto size-3.5 text-[var(--text-muted)]" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Sentinelle du défilement infini. */}
            <div ref={sentinel} aria-hidden className="h-px" />

            {hasMore ? (
              <p className="flex items-center justify-center gap-2 py-2.5 text-[11.5px] text-[var(--text-muted)]">
                <Loader2 className="size-3.5 animate-spin" />
                Chargement des leads suivants…
              </p>
            ) : (
              <p className="py-2.5 text-center text-[11.5px] text-[var(--text-muted)]">
                Fin de la liste — {filtered.length} lead{filtered.length > 1 ? "s" : ""}.
              </p>
            )}
          </div>
        )}
      </Card>

      <SelectionBar
        count={cells.count}
        field={cells.field}
        copied={copied}
        pasting={pasting}
        onPaste={applyCopied}
        onClear={cells.clear}
      />

      <LeadDrawer
        lead={selected}
        org={selected ? orgIndex.get(selected.id) : undefined}
        onOpenLead={setSelected}
        onClose={() => setSelected(null)}
        onSaved={refresh}
        onConvert={async (lead, dealName, amount) => {
          const result = await convertLead(lead.id, dealName, amount);
          if (!result.ok) {
            toast(result.error, "error");
            return;
          }
          toast("Affaire créée avec son contact et son entreprise.");
          setSelected(null);
          router.push(`/affaires?affaire=${result.data!.dealId}`);
        }}
      />

      <NewLeadDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          toast("Lead ajouté.");
          refresh();
        }}
      />

      <ImportLeadsDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(inserted, skipped) => {
          setImporting(false);
          toast(
            skipped > 0
              ? `${inserted} lead(s) importé(s), ${skipped} doublon(s) ignoré(s).`
              : `${inserted} lead(s) importé(s).`,
          );
          refresh();
        }}
      />
    </>
  );
}

/* ------------------------------------------------- Filtre multi-statuts */

/**
 * La pastille qui dit « vous n'êtes pas seul sur cette boîte ».
 *
 * Discrète tant que le voisin est ancien, ambrée dès qu'il a été travaillé
 * récemment — c'est le seul moment où elle doit accrocher l'œil. Elle
 * n'empêche rien : appeler deux dirigeants d'un même groupe est parfois la
 * bonne décision, encore faut-il la prendre.
 */
function OrgChip({ link }: { link?: OrgLink }) {
  if (!link) return null;

  const alerte = link.recent !== null;
  const qui = link.siblings
    .map((sibling) => `${sibling.full_name ?? "sans nom"} — ${LEAD_STATUS[sibling.status].label}`)
    .join("\n");

  return (
    <span
      title={
        (alerte
          ? `Contacté il y a ${link.daysSince} j chez la même organisation.\n\n`
          : `Même organisation.\n\n`) + qui
      }
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ring-inset",
        alerte
          ? "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300"
          : "bg-[var(--surface-hover)] text-[var(--text-muted)] ring-[var(--border-subtle)]",
      )}
    >
      <Users2 className="size-2.5" />
      {link.siblings.length + 1}
    </span>
  );
}


/**
 * Ce que la sélection permet, dit au moment où elle existe.
 *
 * Une barre plutôt qu'une aide dans un menu : les raccourcis ⌘C / ⌘V ne
 * s'inventent pas, et personne ne va les chercher. Elle disparaît dès que la
 * sélection est vide, donc elle n'encombre jamais la lecture.
 */
function SelectionBar({
  count,
  field,
  copied,
  pasting,
  onPaste,
  onClear,
}: {
  count: number;
  field: string | null;
  copied: { field: BulkField; value: string | null; label: string } | null;
  pasting: boolean;
  onPaste: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;

  const FIELD_LABEL: Record<string, string> = {
    status: "Statut",
    follow_up_on: "Relance",
    owner_id: "Assigné",
    comment: "Commentaire",
  };

  const memeColonne = copied !== null && copied.field === field;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-overlay)] py-2 pr-2 pl-4 shadow-[var(--shadow-card)] backdrop-blur animate-fade-up">
        <span className="text-[12.5px] font-medium whitespace-nowrap">
          {count} cellule{count > 1 ? "s" : ""}
          {field ? ` · ${FIELD_LABEL[field] ?? field}` : ""}
        </span>

        <span className="h-4 w-px bg-[var(--border-subtle)]" aria-hidden />

        {copied ? (
          <>
            <span className="max-w-64 truncate text-[11.5px] text-[var(--text-muted)]">
              {FIELD_LABEL[copied.field] ?? copied.field} :{" "}
              <span className="text-[var(--text-secondary)]">{copied.label}</span>
            </span>
            {/* Le bouton reste visible mais inerte quand les colonnes diffèrent :
                le désactiver explique mieux qu'un refus au moment du clic. */}
            <Button
              size="sm"
              variant="primary"
              loading={pasting}
              disabled={!memeColonne}
              title={memeColonne ? undefined : "La valeur copiée vient d'une autre colonne"}
              onClick={onPaste}
            >
              <ClipboardPaste className="size-3.5" />
              Coller ({count})
            </Button>
          </>
        ) : (
          <span className="text-[11.5px] text-[var(--text-muted)]">
            <Kbd>⌘</Kbd>
            <Kbd>C</Kbd> copie la cellule de départ, <Kbd>⌘</Kbd>
            <Kbd>V</Kbd> l&apos;applique à la plage
          </span>
        )}

        <button
          type="button"
          onClick={onClear}
          aria-label="Effacer la sélection"
          className="rounded-full p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-px rounded border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-1 font-sans text-[10px] text-[var(--text-secondary)]">
      {children}
    </kbd>
  );
}

/**
 * Une cellule sélectionnable, comme dans un tableur.
 *
 * La sélection s'arrête à la cellule : surligner la ligne entière pour copier
 * un statut laisserait croire que tout va être écrasé. Le cadre se dessine sur
 * les bords de la plage — traits pleins en haut et en bas, continus sur les
 * côtés — pour qu'on lise un bloc et non une suite de cases teintées.
 */
function CopyableCell({
  field,
  lead,
  index,
  cells,
  className,
  children,
}: {
  field: BulkField;
  lead: Lead;
  index: number;
  cells: CellSelection;
  className?: string;
  children: React.ReactNode;
}) {
  const selected = cells.isSelected(lead.id, field);
  const { first, last } = cells.edge(lead.id, field);
  const isAnchor = cells.anchor?.id === lead.id && cells.anchor.field === field;

  return (
    <td
      // En capture : le repère se pose même quand l'enfant arrête l'événement.
      onMouseDownCapture={(event) => cells.onCellMouseDown({ id: lead.id, field, index }, event)}
      onMouseEnter={() => cells.onCellMouseEnter({ id: lead.id, field, index })}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "relative px-2.5",
        selected && "bg-brand-500/12",
        className,
      )}
    >
      {/* Le cadre est peint par-dessus, sans bordure sur le <td> : une bordure
          décalerait le contenu d'un pixel à chaque sélection. */}
      {selected ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 border-x-2 border-brand-500",
            first && "border-t-2",
            last && "border-b-2",
          )}
        />
      ) : null}
      {isAnchor && cells.count === 1 ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 border-2 border-brand-500" />
      ) : null}
      {children}
    </td>
  );
}

function StatusFilter({
  selected,
  counts,
  total,
  onChange,
}: {
  selected: LeadStatus[];
  counts: Map<LeadStatus, number>;
  total: number;
  onChange: (value: LeadStatus[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function toggle(status: LeadStatus) {
    onChange(
      selected.includes(status)
        ? selected.filter((value) => value !== status)
        : [...selected, status],
    );
  }

  const label =
    selected.length === 0
      ? `Tous les statuts (${total})`
      : selected.length === 1
        ? LEAD_STATUS[selected[0]].label
        : `${selected.length} statuts`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-9.5 min-w-48 items-center gap-2 rounded-[10px] px-3 text-sm transition-all",
          "bg-[var(--surface-input)] ring-1 ring-[var(--border-subtle)] hover:ring-[var(--border-strong)]",
          selected.length > 0 && "ring-brand-500/60",
        )}
      >
        {selected.length > 0 ? (
          <span className="flex -space-x-1">
            {selected.slice(0, 4).map((status) => (
              <span
                key={status}
                className={cn(
                  "size-2.5 rounded-full ring-2 ring-[var(--surface-input)]",
                  TONE_DOT[LEAD_STATUS[status].tone],
                )}
              />
            ))}
          </span>
        ) : null}
        <span className="truncate">{label}</span>
        <ChevronDown className="ml-auto size-4 shrink-0 text-[var(--text-muted)]" />
      </button>

      {open ? (
        <div
          role="listbox"
          className={cn(
            "absolute left-0 z-40 mt-2 w-72 animate-pop overflow-hidden rounded-xl",
            "border border-[var(--border-strong)] bg-[var(--surface-overlay)] shadow-[var(--shadow-pop)]",
          )}
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
            <span className="text-[11.5px] text-[var(--text-muted)]">
              {selected.length === 0 ? "Aucun filtre" : `${selected.length} sélectionné(s)`}
            </span>
            {selected.length > 0 ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[11.5px] text-brand-400 hover:text-brand-300"
              >
                Tout effacer
              </button>
            ) : null}
          </div>

          <ul className="max-h-80 overflow-y-auto py-1">
            {LEAD_STATUS_ORDER.map((status) => {
              const active = selected.includes(status);
              return (
                <li key={status}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => toggle(status)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--surface-hover)]"
                  >
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors",
                        active
                          ? "border-brand-400 bg-brand-500 text-white"
                          : "border-[var(--border-strong)]",
                      )}
                    >
                      {active ? <Check className="size-3" /> : null}
                    </span>
                    <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[LEAD_STATUS[status].tone])} />
                    <span className="flex-1 truncate">{LEAD_STATUS[status].label}</span>
                    <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
                      {counts.get(status) ?? 0}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------- Cellules éditables */

function StatusSelect({
  lead,
  onChange,
}: {
  lead: Lead;
  onChange: (lead: Lead, status: LeadStatus) => void;
}) {
  return (
    <select
      value={lead.status}
      onChange={(event) => onChange(lead, event.target.value as LeadStatus)}
      aria-label={`Statut de ${lead.full_name ?? "ce lead"}`}
      className={cn(
        "cursor-pointer appearance-none rounded-full border-0 px-2 py-0.5 text-[11px] font-medium",
        "ring-1 ring-inset outline-none transition-colors",
        TONE_CLASSES[LEAD_STATUS[lead.status].tone],
      )}
    >
      {LEAD_STATUS_ORDER.map((value) => (
        <option
          key={value}
          value={value}
          className="bg-[var(--surface-overlay)] text-[var(--text-primary)]"
        >
          {LEAD_STATUS[value].label}
        </option>
      ))}
    </select>
  );
}

/** Numéro cliquable : un clic copie, un second clic sur l'icône appelle. */
/**
 * Le numéro à composer, portable d'abord.
 *
 * Le standard prend le relais quand il n'y a pas de portable, marqué comme
 * tel : dans un export de sourcing il est deux fois plus souvent renseigné, et
 * l'afficher change une colonne vide en un appel possible. Le repère « std »
 * n'est pas cosmétique — on n'aborde pas un standard comme une ligne directe.
 */
function CopyablePhone({
  phone,
  standard,
  dense,
}: {
  phone: string | null;
  standard?: string | null;
  dense?: boolean;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const numero = phone ?? standard ?? null;
  const estStandard = !phone && Boolean(standard);

  if (!numero) return <span className="text-[var(--text-muted)]">—</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(numero!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Copie impossible depuis ce navigateur.", "error");
    }
  }

  return (
    // `whitespace-nowrap` est ici essentiel : sans lui, un numéro français
    // s'enroule sur quatre lignes et fait exploser la hauteur de la ligne.
    <span className="flex items-center gap-1 whitespace-nowrap">
      <button
        type="button"
        onClick={copy}
        title="Copier le numéro"
        className={cn(
          "group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono transition-colors",
          dense ? "text-[11px]" : "text-[11.5px]",
          copied
            ? "bg-emerald-500/15 text-emerald-500"
            : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
        )}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3 opacity-50 group-hover:opacity-100" />}
        {numero}
      </button>
      {estStandard ? (
        <span
          title="Ligne standard : pas de portable connu"
          className="rounded bg-[var(--surface-hover)] px-1 text-[9.5px] tracking-wide text-[var(--text-muted)] uppercase"
        >
          std
        </span>
      ) : null}
      <a
        href={`tel:${numero.replace(/\s/g, "")}`}
        title="Appeler"
        className="rounded-md p-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-brand-400"
      >
        <Phone className="size-3.5" />
      </a>
    </span>
  );
}

/** Assignation du lead à un collaborateur, sans quitter le tableau. */
function OwnerSelect({
  lead,
  members,
  onAssign,
  avatarSize = 18,
}: {
  lead: Lead;
  members: MemberLite[];
  onAssign: (ownerId: string | null) => Promise<void>;
  avatarSize?: number;
}) {
  const current = members.find((member) => member.id === lead.owner_id);

  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {current ? (
        <Avatar name={current.full_name} email={current.email} size={avatarSize} />
      ) : (
        <span
          style={{ width: avatarSize, height: avatarSize }}
          className="grid shrink-0 place-items-center rounded-full bg-[var(--surface-hover)] text-[var(--text-muted)]"
        >
          <UserRound className="size-3" />
        </span>
      )}
      <select
        value={lead.owner_id ?? ""}
        onChange={(event) => onAssign(event.target.value || null)}
        aria-label="Assigner le lead"
        className={cn(
          "max-w-24 cursor-pointer appearance-none truncate rounded-md bg-transparent py-0.5 pr-1 pl-0.5 text-[11.5px]",
          "outline-none transition-colors hover:text-brand-500 dark:hover:text-brand-300",
          !current && "text-[var(--text-muted)]",
        )}
      >
        <option value="">Non assigné</option>
        {members.map((member) => (
          <option key={member.id} value={member.id} className="bg-[var(--surface-overlay)] text-[var(--text-primary)]">
            {member.full_name ?? member.email}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * Commentaire éditable dans la ligne. Replié il tient sur une ligne ; au focus
 * il s'ouvre en zone de texte, et l'enregistrement se fait à la sortie du champ.
 */
function InlineComment({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (value: string | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(value ?? ""), [value]);

  async function commit() {
    setEditing(false);
    if (draft === (value ?? "")) return;
    setSaving(true);
    const ok = await onCommit(draft.trim() || null);
    setSaving(false);
    if (!ok) setDraft(value ?? "");
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "w-full truncate rounded-md px-1.5 py-0.5 text-left text-[12px] transition-colors",
          "hover:bg-[var(--surface-hover)]",
          draft ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)] italic",
          saving && "opacity-50",
        )}
        title={draft || "Ajouter un commentaire"}
      >
        {draft || "Ajouter…"}
      </button>
    );
  }

  return (
    <textarea
      autoFocus
      rows={3}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setDraft(value ?? "");
          setEditing(false);
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) commit();
      }}
      placeholder="Compte rendu d'appel…"
      className={cn(
        "w-full resize-y rounded-md bg-[var(--surface-input)] px-2 py-1.5 text-[12.5px] leading-relaxed",
        "ring-1 ring-brand-500/60 outline-none",
      )}
    />
  );
}

/* ------------------------------------------------------- Nouveau lead */

function NewLeadDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    company_name: "",
    region: "",
    comment: "",
  });

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setSaving(true);
    const result = await createLead({
      first_name: form.first_name || null,
      last_name: form.last_name || null,
      email: form.email || null,
      phone: form.phone || null,
      company_name: form.company_name || null,
      region: form.region || null,
      comment: form.comment || null,
    });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    setForm({ first_name: "", last_name: "", email: "", phone: "", company_name: "", region: "", comment: "" });
    onCreated();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouveau lead"
      description="Une fiche de prospection, à convertir en affaire dès qu'un rendez-vous est décroché."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            Créer le lead
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Prénom">
          <Input value={form.first_name} onChange={(event) => set("first_name", event.target.value)} />
        </Field>
        <Field label="Nom">
          <Input value={form.last_name} onChange={(event) => set("last_name", event.target.value)} />
        </Field>
        <Field label="E-mail">
          <Input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} />
        </Field>
        <Field label="Téléphone">
          <Input value={form.phone} onChange={(event) => set("phone", event.target.value)} />
        </Field>
        <Field label="Entreprise" className="sm:col-span-2">
          <Input
            value={form.company_name}
            onChange={(event) => set("company_name", event.target.value)}
            placeholder="Raison sociale"
          />
        </Field>
        <Field label="Région">
          <Input value={form.region} onChange={(event) => set("region", event.target.value)} />
        </Field>
        <Field label="Commentaire" className="sm:col-span-2">
          <Textarea rows={3} value={form.comment} onChange={(event) => set("comment", event.target.value)} />
        </Field>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
        <Building2 className="size-3.5" />
        L&apos;entreprise ne sera créée dans le CRM qu&apos;à la conversion du lead.
      </p>
    </Modal>
  );
}
