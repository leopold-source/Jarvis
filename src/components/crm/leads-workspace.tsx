"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
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
import { cn, daysUntil, formatMoney, normalize } from "@/lib/utils";
import { assignLead, convertLead, createLead, updateLead } from "@/app/(crm)/leads/actions";
import { ImportLeadsDialog } from "@/components/crm/import-leads-dialog";
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
 * Rang d'un lead dans la file d'appel : le retard passe avant le jour même,
 * qui passe avant les relances orphelines.
 */
function prospectionRank(lead: Lead, today: string): number {
  if (lead.follow_up_on && lead.follow_up_on < today) return 0;
  if (lead.follow_up_on === today) return 1;
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
  isAdmin,
}: {
  leads: Lead[];
  members: MemberLite[];
  currentUserId: string;
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
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const refresh = () => startTransition(() => router.refresh());

  // Permet d'ouvrir un lead directement depuis un lien (?lead=…).
  useEffect(() => {
    const id = params.get("lead");
    if (!id) return;
    const match = leads.find((lead) => lead.id === id);
    if (match) setSelected(match);
  }, [params, leads]);

  const regions = useMemo(
    () => [...new Set(leads.map((lead) => lead.region).filter(Boolean))].sort() as string[],
    [leads],
  );
  const segments = useMemo(
    () => [...new Set(leads.map((lead) => lead.segment).filter(Boolean))].sort() as string[],
    [leads],
  );

  const counts = useMemo(() => {
    const map = new Map<LeadStatus, number>();
    for (const lead of leads) map.set(lead.status, (map.get(lead.status) ?? 0) + 1);
    return map;
  }, [leads]);

  const today = todayIso();

  const filtered = useMemo(() => {
    const needle = normalize(search.trim());
    const wanted = new Set(statuses);

    const base = leads.filter((lead) => {
      if (wanted.size > 0 && !wanted.has(lead.status)) return false;
      if (region !== "toutes" && lead.region !== region) return false;
      if (segment !== "tous" && lead.segment !== segment) return false;
      if (owner === "moi" && lead.owner_id !== currentUserId) return false;
      if (owner !== "tous" && owner !== "moi" && lead.owner_id !== owner) return false;
      if (!needle) return true;
      return normalize(
        [lead.full_name, lead.company_name, lead.email, lead.phone, lead.company_activity]
          .filter(Boolean)
          .join(" "),
      ).includes(needle);
    });

    if (view === "lecture") return base;

    // Mode prospection : la file d'appel. Les retards d'abord, puis le jour
    // même, puis les leads à relancer qu'aucune date ne porte plus.
    return base
      .filter((lead) => {
        if (lead.follow_up_on) {
          if (lead.follow_up_on > today) return false;
          if (!showOverdue && lead.follow_up_on < today) return false;
          return true;
        }
        return RELANCE_SANS_DATE.includes(lead.status);
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
  }, [leads, search, statuses, region, segment, owner, currentUserId, view, showOverdue, today]);

  const dueToday = useMemo(
    () => leads.filter((lead) => lead.follow_up_on === today).length,
    [leads, today],
  );
  const overdue = useMemo(
    () => leads.filter((lead) => lead.follow_up_on && lead.follow_up_on < today).length,
    [leads, today],
  );
  const undated = useMemo(
    () => leads.filter((lead) => !lead.follow_up_on && RELANCE_SANS_DATE.includes(lead.status)).length,
    [leads],
  );

  const size = DENSITIES[density];
  const page = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  // Toute modification des filtres remet la pagination à zéro.
  useEffect(() => setVisible(PAGE_SIZE), [search, statuses, region, segment, owner, view, showOverdue]);

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
    const result = await updateLead(lead.id, { [field]: value });
    if (!result.ok) {
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
    const result = await updateLead(lead.id, { status: next });
    if (!result.ok) {
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

          {view === "prospection" ? (
            <>
              <span className="flex items-center gap-1.5">
                <Badge tone="orange">{dueToday} pour aujourd&apos;hui</Badge>
                {overdue > 0 ? <Badge tone="red">{overdue} en retard</Badge> : null}
                {undated > 0 ? <Badge tone="violet">{undated} sans date</Badge> : null}
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
            <table className={cn("w-full min-w-[1240px] text-left", size.text)}>
              <thead className="sticky top-0 z-10 bg-[var(--surface-raised)] text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="w-12 px-2 py-1.5 text-right font-medium">#</th>
                  <th className="px-2.5 py-1.5 font-medium">Contact</th>
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
                    <td className={cn("px-2 text-right font-mono text-[11px] text-[var(--text-muted)] tabular-nums", size.cell)}>
                      {index + 1}
                    </td>

                    <td className={cn("max-w-52 px-2.5", size.cell)}>
                      <p className="truncate font-medium" title={lead.email ?? undefined}>
                        {lead.full_name ?? lead.email ?? "Sans nom"}
                      </p>
                    </td>

                    <td className={cn("max-w-52 px-2.5", size.cell)}>
                      <p className="truncate" title={lead.company_activity ?? undefined}>
                        {lead.company_name ?? "—"}
                      </p>
                    </td>

                    <td className={cn("px-2.5", size.cell)} onClick={(event) => event.stopPropagation()}>
                      <StatusSelect lead={lead} onChange={handleStatusChange} />
                    </td>

                    <td className={cn("px-2.5", size.cell)} onClick={(event) => event.stopPropagation()}>
                      <CopyablePhone phone={lead.phone} dense={density === "compacte"} />
                    </td>

                    <td className={cn("px-2.5", size.cell)} onClick={(event) => event.stopPropagation()}>
                      <DateField
                        dense={density !== "confort"}
                        value={lead.follow_up_on}
                        placeholder="Planifier"
                        className="w-32"
                        onChange={(value) => patch(lead, "follow_up_on", value, true)}
                      />
                    </td>

                    <td className={cn("px-2.5", size.cell)} onClick={(event) => event.stopPropagation()}>
                      <OwnerSelect
                        lead={lead}
                        members={members}
                        avatarSize={size.avatar}
                        onAssign={async (ownerId) => {
                          const result = await assignLead(lead.id, ownerId);
                          if (!result.ok) {
                            toast(result.error, "error");
                            return;
                          }
                          refresh();
                        }}
                      />
                    </td>

                    <td className={cn("w-56 px-2.5", size.cell)} onClick={(event) => event.stopPropagation()}>
                      <InlineComment
                        value={lead.comment}
                        onCommit={(value) => patch(lead, "comment", value)}
                      />
                    </td>

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

      <LeadDrawer
        lead={selected}
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
function CopyablePhone({ phone, dense }: { phone: string | null; dense?: boolean }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  if (!phone) return <span className="text-[var(--text-muted)]">—</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(phone!);
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
        {phone}
      </button>
      <a
        href={`tel:${phone.replace(/\s/g, "")}`}
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
