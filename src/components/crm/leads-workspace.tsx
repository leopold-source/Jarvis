"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Copy,
  Lock,
  ExternalLink,
  Eye,
  Linkedin,
  Loader2,
  MoonStar,
  EyeOff,
  Phone,
  Plus,
  Rocket,
  Rows3,
  Sparkles,
  Table2,
  Upload,
  UserRound,
  RotateCw,
  SlidersHorizontal,
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
import { LEAD_STATUS, LEAD_STATUS_ORDER, NRP_MAX, TONE_CLASSES, TONE_DOT } from "@/lib/constants";
import type { LeadListe, LeadStatus } from "@/lib/database.types";
import { cn, daysUntil, formatDate, formatDateHeure, formatMoney, formatRelative, normalize, todayIso } from "@/lib/utils";
import { libelleAction } from "@/lib/lead-action";
import {
  assignLead,
  convertLead,
  rechercherEntreprises,
  type EntrepriseConnue,
  createLead,
  incrementerNrp,
  updateLead,
  updateLeads,
  type BulkField,
} from "@/app/(crm)/leads/actions";
import { useCellSelection, type CellSelection } from "@/lib/use-cell-selection";
import { ImportLeadsDialog } from "@/components/crm/import-leads-dialog";
import { buildOrgIndex, collapseByOrg, type FileEntry, type OrgLink } from "@/lib/lead-orgs";
import { ConfirmationModal } from "@/components/crm/confirmation-modal";
import { forcerProspection } from "@/app/(crm)/actions-du-jour";
import { LeadDrawer } from "@/components/crm/lead-drawer";

const PAGE_SIZE = 60;

/**
 * Statuts qui restent à relancer même sans date planifiée.
 *
 * Un NRP ou un « à recontacter » sans date n'est pas un lead mort : c'est un
 * lead qu'on a oublié de replanifier. Le mode prospection les fait remonter
 * après les relances dues, pour qu'il y ait toujours de quoi appeler.
 */
const RELANCE_SANS_DATE: LeadStatus[] = ["nrp", "a_recontacter"];

/** Jamais appelé : la réserve dans laquelle on puise quand les relances sont faites. */
const JAMAIS_APPELE: LeadStatus[] = ["a_contacter"];

/**
 * Les fiches qui ont fini leur course de prospection : rendez-vous décroché,
 * ou hors cible. Elles restent en base — c'est d'elles que se calcule le taux
 * de call pris — mais n'ont plus rien à faire dans la file d'appel, même si
 * une date de relance traîne encore dessus.
 */
const SORTIS_DE_PROSPECTION: LeadStatus[] = ["call_pris", "non_qualifie"];

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
  renseigne: { label: "Téléphone renseigné", keep: (lead: LeadListe) => Boolean(lead.phone ?? lead.phone_standard) },
  portable: { label: "Portable uniquement", keep: (lead: LeadListe) => Boolean(lead.phone) },
  vide: { label: "Téléphone vide", keep: (lead: LeadListe) => !lead.phone && !lead.phone_standard },
} as const;

type PhoneFilter = keyof typeof PHONE_FILTERS;

/**
 * Rang d'un lead dans la file d'appel.
 *
 * D'abord les relances dues des leads assignés — une promesse faite par l'un
 * de nous —, puis les relances dues des leads sans responsable, puis les
 * relances sans date (NRP, à recontacter), et seulement ensuite les fiches
 * jamais appelées. À rang égal, la relance la plus ancienne passe devant.
 */
function prospectionRank(lead: LeadListe, today: string): number {
  const due = lead.follow_up_on !== null && lead.follow_up_on <= today;
  if (due && lead.owner_id) return 0;
  if (due) return 1;
  if (JAMAIS_APPELE.includes(lead.status)) return 3;
  return 2;
}



export function LeadsWorkspace({
  leads,
  members,
  currentUserId,
  orgCooldownDays,
  dormanceJours,
  isAdmin,
  verrou,
}: {
  leads: LeadListe[];
  members: MemberLite[];
  currentUserId: string;
  orgCooldownDays: number;
  /**
   * Jours sans changement de statut au-delà desquels un lead est dit endormi.
   *
   * `null` éteint la notion : ni marque, ni filtre, ni mot nulle part. Un seuil
   * par défaut aurait marqué des centaines de fiches sans que personne l'ait
   * demandé, et on l'aurait découvert en constatant ses effets.
   */
  dormanceJours: number | null;
  isAdmin: boolean;
  /**
   * La prospection libre suit le plan du jour : tant que mes affaires et mes
   * relances ne sont pas traitées, la file n'offre que des relances.
   */
  verrou: { ouvert: boolean; affaires: number; relances: number };
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
  const [view, setView] = useState<ViewMode>(() => (params.get("vue") === "prospection" ? "prospection" : "lecture"));
  const [showOverdue, setShowOverdue] = useState(true);
  const [onlyGrouped, setOnlyGrouped] = useState(false);
  const [phoneFilter, setPhoneFilter] = useState<PhoneFilter>("tous");
  /** Les niveaux de NRP retenus, de 1 à 9. Vide = pas de filtre. */
  const [nrpNiveaux, setNrpNiveaux] = useState<number[]>([]);
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

  const [selected, setSelected] = useState<LeadListe | null>(null);

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
  const [overrides, setOverrides] = useState<Record<string, Partial<LeadListe>>>({});
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setOverrides({}), [leads]);

  const applyLocal = useCallback((ids: string[], patch: Partial<LeadListe>) => {
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

  // Combien de fiches à chaque niveau d'appel sans réponse. Comptées sur
  // l'ensemble et non sur la vue filtrée : un compteur qui change en cochant
  // une case ne dit plus ce qu'il reste à faire.
  const comptesNrp = useMemo(() => {
    const map = new Map<number, number>();
    for (const lead of rows) {
      if (lead.status !== "nrp") continue;
      const niveau = lead.nrp_count ?? 0;
      if (niveau >= 1) map.set(niveau, (map.get(niveau) ?? 0) + 1);
    }
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

  /*
    Combien de fois on a demandé à changer d'interlocuteur, par organisation.

    Un compteur et non l'identifiant du lead retenu : le cercle vient du
    modulo, donc revenir au point de départ ne demande aucune mémoire de ce
    qu'était le point de départ. Volontairement non persisté — c'est un geste
    de session, pas une préférence, et le retrouver le lendemain sur une file
    entre-temps réordonnée surprendrait plus qu'il n'aiderait.
  */
  const [rotation, setRotation] = useState<Map<string, number>>(() => new Map());

  // Les filtres, repliés par défaut sur téléphone seulement : à partir de
  // `sm` le bloc est toujours affiché, quel que soit cet état.
  const [filtresOuverts, setFiltresOuverts] = useState(false);
  // « Prospecter quand même » : valable pour la journée, dans cet onglet.
  const cleForcage = `prospection-forcee-${todayIso()}`;
  const [force, setForce] = useState(false);
  useEffect(() => {
    try {
      setForce(sessionStorage.getItem(cleForcage) === "1");
    } catch {
      setForce(false);
    }
  }, [cleForcage]);
  const libre = verrou.ouvert || force;
  // L'affaire née d'un « call pris », dont on propose de confirmer le rendez-vous.
  const [aConfirmer, setAConfirmer] = useState<string | null>(null);
  const [seulementEndormis, setSeulementEndormis] = useState(false);

  /*
    Les fiches endormies, calculées une fois pour toute la liste.

    Une fiche arrivée au bout — convertie, écartée, non qualifiée — ne dort
    pas : elle a fini sa course. Les compter parmi les endormies gonflerait le
    chiffre de tout ce qu'on a déjà traité, et le filtre ne servirait à rien.
  */
  const endormis = useMemo(() => {
    if (dormanceJours === null) return new Set<string>();
    const limite = Date.now() - dormanceJours * 86_400_000;
    const closes: LeadStatus[] = ["call_pris", "non_qualifie", "pas_interesse"];
    return new Set(
      rows
        .filter(
          (lead) =>
            !closes.includes(lead.status) &&
            lead.status_changed_at !== null &&
            new Date(lead.status_changed_at).getTime() < limite,
        )
        .map((lead) => lead.id),
    );
  }, [rows, dormanceJours]);

  const tourner = useCallback((groupId: string) => {
    setRotation((courant) => {
      const suivant = new Map(courant);
      suivant.set(groupId, (courant.get(groupId) ?? 0) + 1);
      return suivant;
    });
  }, []);

  const grouped = useMemo(
    () => rows.filter((lead) => orgIndex.has(lead.id)).length,
    [rows, orgIndex],
  );

  const entrees: FileEntry[] = useMemo(() => {
    const needle = normalize(search.trim());
    const wanted = new Set(statuses);
    const niveaux = new Set(nrpNiveaux);

    const base = rows.filter((lead) => {
      if (wanted.size > 0 && !wanted.has(lead.status)) return false;
      // Un niveau coché suppose le statut : demander « NRP 3 » sans être en
      // NRP n'aurait aucun sens, et cocher le statut en plus serait un geste
      // de trop.
      if (niveaux.size > 0 && (lead.status !== "nrp" || !niveaux.has(lead.nrp_count ?? 0))) {
        return false;
      }
      if (region !== "toutes" && lead.region !== region) return false;
      if (segment !== "tous" && lead.segment !== segment) return false;
      if (owner === "moi" && lead.owner_id !== currentUserId) return false;
      if (owner !== "tous" && owner !== "moi" && lead.owner_id !== owner) return false;
      if (onlyGrouped && !orgIndex.has(lead.id)) return false;
      if (seulementEndormis && !endormis.has(lead.id)) return false;
      if (!PHONE_FILTERS[phoneFilter].keep(lead)) return false;
      if (!needle) return true;
      return normalize(
        [lead.full_name, lead.company_name, lead.email, lead.phone, lead.company_activity]
          .filter(Boolean)
          .join(" "),
      ).includes(needle);
    });

    /*
      « Les 1 d'abord, puis les 2 ».

      L'ordre ne s'impose que lorsque la liste se réduit à la pile NRP — un
      niveau coché, ou le seul statut NRP retenu. Ailleurs, trier par nombre
      d'appels manqués bousculerait une liste où ce nombre ne veut rien dire
      pour les neuf dixièmes des lignes.

      Le sens est celui de la chance qu'il reste : celui qu'on a tenté une
      fois décroche encore, celui qu'on a tenté huit fois demande une décision
      plutôt qu'un neuvième appel. À niveau égal, le plus ancien d'abord.
    */
    const pileNrp = niveaux.size > 0 || (statuses.length === 1 && statuses[0] === "nrp");
    const parNiveau = (a: LeadListe, b: LeadListe) => {
      const ecart = (a.nrp_count ?? 0) - (b.nrp_count ?? 0);
      if (ecart !== 0) return ecart;
      return a.status_changed_at < b.status_changed_at ? -1 : a.status_changed_at > b.status_changed_at ? 1 : 0;
    };

    if (view === "lecture") {
      const liste = pileNrp ? [...base].sort(parNiveau) : base;
      return liste.map((lead) => ({ lead, groupId: null, candidats: [lead] }));
    }

    // Mode prospection : la file d'appel. Les retards d'abord, puis le jour
    // même, puis les relances orphelines, puis les fiches jamais appelées.
    const queue = base
      .filter((lead) => {
        if (SORTIS_DE_PROSPECTION.includes(lead.status)) return false;
        // Sans responsable, c'est de la prospection libre : elle attend le plan.
        if (!lead.owner_id && !libre) return false;
        if (lead.follow_up_on) {
          if (lead.follow_up_on > today) return false;
          if (!showOverdue && lead.follow_up_on < today) return false;
          return true;
        }
        // Les jamais-appelés, c'est la prospection libre : elle attend le plan.
        return RELANCE_SANS_DATE.includes(lead.status) || (libre && JAMAIS_APPELE.includes(lead.status));
      })
      .sort((a, b) => {
        // Dans la pile NRP, le compteur passe avant la file d'appel : c'est
        // lui qu'on est venu suivre.
        if (pileNrp) {
          const ecart = parNiveau(a, b);
          if (ecart !== 0) return ecart;
        }
        const rankA = prospectionRank(a, today);
        const rankB = prospectionRank(b, today);
        if (rankA !== rankB) return rankA - rankB;
        // À rang égal : la relance la plus ancienne, sinon le lead le plus vieux.
        const keyA = a.follow_up_on ?? a.created_at;
        const keyB = b.follow_up_on ?? b.created_at;
        return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
      });

    // Un interlocuteur par organisation. Les autres restent à un clic, sur la
    // même ligne — c'est là, en descendant la file sans réfléchir, qu'on
    // rappelait la même boîte deux fois.
    return collapseByOrg(queue, orgIndex, rotation);
  }, [rows, search, statuses, nrpNiveaux, region, segment, owner, currentUserId, view, showOverdue, today, onlyGrouped, phoneFilter, orgIndex, rotation, seulementEndormis, endormis, libre]);

  // Les lignes, et ce qu'il faut pour en changer l'occupant. Deux vues d'une
  // même liste : le rendu ne connaît que des leads, le bouton que des groupes.
  const page = entrees.slice(0, visible);
  const pageLeads = useMemo(() => page.map((entree) => entree.lead), [page]);
  const alternatives = useMemo(
    () => new Map(page.map((entree) => [entree.lead.id, entree])),
    [page],
  );

  const replies = useMemo(
    () => entrees.reduce((total, entree) => total + entree.candidats.length - 1, 0),
    [entrees],
  );

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
  const hasMore = visible < entrees.length;

  /*
    L'incrément, optimiste puis confirmé.

    La file d'appel se descend vite : attendre l'aller-retour serveur avant de
    voir le compteur bouger donnerait l'impression d'un clic perdu, et on
    cliquerait deux fois. La base reste l'arbitre — c'est elle qui plafonne et
    qui date — mais l'écran n'attend pas pour le dire.
  */
  const compterNrp = useCallback(
    async (lead: LeadListe) => {
      const vise = lead.status === "nrp" ? Math.min(NRP_MAX, (lead.nrp_count ?? 0) + 1) : 1;
      applyLocal([lead.id], { status: "nrp", nrp_count: vise });

      const resultat = await incrementerNrp(lead.id);
      if (!resultat.ok) {
        setOverrides({});
        return toast(resultat.error, "error");
      }
      // Le serveur a pu trancher autrement — un autre onglet, le plafond.
      applyLocal([lead.id], { status: "nrp", nrp_count: resultat.data!.nrp_count });
      refresh();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const filtresActifs =
    statuses.length +
    nrpNiveaux.length +
    (region !== "toutes" ? 1 : 0) +
    (segment !== "tous" ? 1 : 0) +
    (owner !== "tous" ? 1 : 0) +
    (phoneFilter !== "tous" ? 1 : 0) +
    (onlyGrouped ? 1 : 0) +
    (seulementEndormis ? 1 : 0);

  // La sélection ne porte que sur les lignes réellement affichées : coller sur
  // une ligne qu'on ne voit pas serait une modification à l'aveugle.
  const pageIds = useMemo(() => pageLeads.map((lead) => lead.id), [pageLeads]);
  const cells = useCellSelection(pageIds);

  /** Ce qu'une cellule contient, et comment le dire à l'écran. */
  const readCell = useCallback(
    (lead: LeadListe, field: BulkField): { value: string | null; label: string } => {
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
    applyLocal(targets, { [copied.field]: copied.value } as Partial<LeadListe>);
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
        const lead = pageLeads.find((entry) => entry.id === source.id);
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

  async function patch(lead: LeadListe, field: string, value: string | null, silent = false) {
    // L'écran change d'abord. Si le serveur refuse, on efface la correction
    // locale et les données du serveur reprennent la main — l'utilisateur voit
    // sa saisie revenir en arrière, ce qui est le bon signal.
    applyLocal([lead.id], { [field]: value } as Partial<LeadListe>);

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

  async function handleStatusChange(lead: LeadListe, next: LeadStatus) {
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

  async function prospecterQuandMeme() {
    await forcerProspection(verrou.affaires, verrou.relances);
    try {
      sessionStorage.setItem(cleForcage, "1");
    } catch {
      // Sans stockage, la dérogation vaut jusqu'au rechargement.
    }
    setForce(true);
  }

  return (
    <>
      {view === "prospection" && !verrou.ouvert ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-[12.5px] ring-1",
            libre
              ? "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-200"
              : "bg-[var(--surface-hover)] text-[var(--text-secondary)] ring-[var(--border-subtle)]",
          )}
        >
          <Lock className="size-3.5 shrink-0" />
          {libre ? (
            <span className="flex-1">
              Prospection libre ouverte par dérogation — {verrou.affaires} affaire{verrou.affaires > 1 ? "s" : ""} et{" "}
              {verrou.relances} relance{verrou.relances > 1 ? "s" : ""} attendent encore dans le plan du jour.
            </span>
          ) : (
            <>
              <span className="flex-1">
                <strong className="font-medium">Prospection libre fermée.</strong> D&apos;abord le plan du jour :{" "}
                {verrou.affaires} affaire{verrou.affaires > 1 ? "s" : ""} et {verrou.relances} relance
                {verrou.relances > 1 ? "s" : ""}. La file ne montre que les relances des leads assignés.
              </span>
              <Link href="/" className="font-medium text-brand-600 hover:underline dark:text-brand-300">
                Voir le plan
              </Link>
              <button
                type="button"
                onClick={() => void prospecterQuandMeme()}
                className="text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
              >
                Prospecter quand même
              </button>
            </>
          )}
        </div>
      ) : null}

      <Card className="p-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Nom, entreprise, e-mail…"
            className="min-w-0 flex-1 sm:min-w-56"
          />

          {/*
            Cinq listes déroulantes empilées occupent l'écran entier d'un
            téléphone, et la liste de leads — la seule chose qu'on est venu
            voir — commence sous la ligne de flottaison. Elles se replient
            donc, avec le nombre de filtres actifs sur le bouton : replier
            sans dire ce qui est replié fait chercher pourquoi la liste est
            courte.
          */}
          <Button
            variant={filtresOuverts || filtresActifs > 0 ? "secondary" : "subtle"}
            size="icon"
            onClick={() => setFiltresOuverts((valeur) => !valeur)}
            aria-expanded={filtresOuverts}
            aria-label="Filtres"
            className="relative shrink-0 sm:hidden"
          >
            <SlidersHorizontal className="size-4" />
            {filtresActifs > 0 ? (
              <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-brand-500 text-[9.5px] font-semibold text-white">
                {filtresActifs}
              </span>
            ) : null}
          </Button>

          <div
            className={cn(
              "flex w-full flex-wrap items-center gap-2.5 sm:contents",
              filtresOuverts ? "flex" : "hidden sm:contents",
            )}
          >
          <StatusFilter
            selected={statuses}
            counts={counts}
            total={leads.length}
            onChange={setStatuses}
          />

          {/* Le filtre n'apparaît que s'il y a une pile à trier : neuf niveaux
              tous à zéro n'apprendraient rien et prendraient la place d'un
              filtre utile. */}
          {(counts.get("nrp") ?? 0) > 0 ? (
            <NrpFilter
              selected={nrpNiveaux}
              counts={comptesNrp}
              total={counts.get("nrp") ?? 0}
              onChange={setNrpNiveaux}
            />
          ) : null}

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

          </div>

          <span className="ml-auto flex items-center gap-2">
            {isAdmin ? (
              <Button variant="secondary" onClick={() => setImporting(true)} className="max-sm:size-10 max-sm:px-0">
                <Upload className="size-4" />
                <span className="max-sm:hidden">Importer</span>
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => setCreating(true)} className="max-sm:size-10 max-sm:px-0">
              <Plus className="size-4" />
              <span className="max-sm:hidden">Nouveau lead</span>
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

          {/* La densité règle la hauteur des lignes du tableau ; sur téléphone
              il n'y a pas de tableau, donc rien à régler. */}
          <span className="ml-auto hidden items-center gap-1 rounded-[10px] bg-[var(--surface-hover)] p-1 lg:flex">
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

          {/* Le filtre n'existe que si le seuil existe : proposer « 0 endormi »
              inviterait à chercher un réglage qu'on ne sait pas absent. */}
          {dormanceJours !== null && endormis.size > 0 ? (
            <Button
              variant={seulementEndormis ? "secondary" : "subtle"}
              size="sm"
              onClick={() => setSeulementEndormis((valeur) => !valeur)}
              title={`Sans changement de statut depuis plus de ${dormanceJours} jours`}
            >
              <MoonStar className="size-3.5" />
              {endormis.size} endormi{endormis.size > 1 ? "s" : ""}
            </Button>
          ) : null}

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
              <p className="order-first hidden w-full text-[11.5px] text-[var(--text-muted)] sm:block lg:order-none lg:w-auto">
                Retards, puis relances du jour, puis les NRP et « à recontacter » sans date.
              </p>
            </>
          ) : (
            <p className="hidden text-[11.5px] text-[var(--text-muted)] sm:block">
              Toute la base, dans l&apos;ordre d&apos;ajout.
            </p>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2.5">
          <p className="text-[12.5px] text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text-primary)]">{entrees.length}</span>{" "}
            {view === "prospection" ? "ligne" : "lead"}
            {entrees.length > 1 ? "s" : ""}
            {entrees.length !== leads.length ? ` sur ${leads.length}` : ""}
            {/* Dire combien de fiches sont derrière la rotation : sans cela, le
                compte semble avoir perdu des leads en cours de route. */}
            {replies > 0 ? (
              <span className="ml-1.5">
                · {replies} autre{replies > 1 ? "s" : ""} interlocuteur
                {replies > 1 ? "s" : ""} sous la rotation
              </span>
            ) : null}
          </p>
          <p className="hidden text-[11.5px] text-[var(--text-muted)] lg:block">
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
          <div ref={scroller} className="max-h-[calc(100dvh-17rem)] min-h-64 overflow-auto max-lg:max-h-none max-lg:overflow-visible">
            {/*
              Sur téléphone, une liste de cartes ; à partir de `lg`, la table.

              Onze colonnes et 1380 pixels de large ne se lisent pas sur un
              écran de six pouces : il faudrait défiler de côté pour voir le
              numéro, puis revenir pour savoir à qui il appartient. La carte
              montre d'un coup ce qu'il faut pour décider d'appeler — le nom,
              la boîte, le statut, la relance — et pose l'appel sous le pouce.
            */}
            <ul className="divide-y divide-[var(--border-subtle)] lg:hidden">
              {pageLeads.map((lead, index) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  rang={index + 1}
                  aujourdhui={today}
                  prospection={view === "prospection"}
                  endormi={endormis.has(lead.id)}
                  entree={alternatives.get(lead.id)}
                  lien={orgIndex.get(lead.id)}
                  onTourner={tourner}
                  onOuvrir={() => setSelected(lead)}
                  onStatut={handleStatusChange}
                  onNrp={compterNrp}
                  onRelance={(value) => patch(lead, "follow_up_on", value, true)}
                />
              ))}
            </ul>

            <table className={cn("hidden w-full min-w-[1380px] text-left lg:table", size.text)}>
              <thead className="sticky top-0 z-10 bg-[var(--surface-raised)] text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="w-12 px-2 py-1.5 text-right font-medium">#</th>
                  <th className="px-2.5 py-1.5 font-medium">Contact</th>
                  <th className="px-2.5 py-1.5 font-medium">Poste</th>
                  <th className="px-2.5 py-1.5 font-medium">Entreprise</th>
                  <th className="px-2.5 py-1.5 font-medium">Statut</th>
                  <th className="min-w-36 px-2.5 py-1.5 font-medium">Dernière action</th>
                  <th className="min-w-40 px-2.5 py-1.5 font-medium">Téléphone</th>
                  <th className="px-2.5 py-1.5 font-medium">Relance</th>
                  <th className="px-2.5 py-1.5 font-medium">Assigné</th>
                  <th className="px-2.5 py-1.5 font-medium">Commentaire</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">CA</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {pageLeads.map((lead, index) => (
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
                        {endormis.has(lead.id) ? (
                          <MoonStar
                            className="size-3 shrink-0 text-violet-500 dark:text-violet-300"
                            aria-label="Endormi"
                          />
                        ) : null}
                        <OrgChip
                          link={orgIndex.get(lead.id)}
                          entree={alternatives.get(lead.id)}
                          onTourner={tourner}
                        />
                      </p>
                    </td>

                    <CopyableCell
                      field="status"
                      lead={lead}
                      index={index}
                      cells={cells}
                      className={size.cell}
                    >
                      <StatusSelect lead={lead} onChange={handleStatusChange} onNrp={compterNrp} />
                    </CopyableCell>

                    <td className={cn("max-w-48 px-2.5", size.cell)}>
                      <DerniereAction lead={lead} members={members} dense={density === "compacte"} />
                    </td>

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
                Fin de la liste — {entrees.length} ligne{entrees.length > 1 ? "s" : ""}.
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
        members={members}
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
          // Le rendez-vous vient d'être pris : on le confirme avant d'ouvrir l'affaire.
          setAConfirmer(result.data!.dealId);
        }}
      />

      <ConfirmationModal
        dealId={aConfirmer}
        ouvert={aConfirmer !== null}
        onClose={() => {
          const dealId = aConfirmer;
          setAConfirmer(null);
          if (dealId) router.push(`/affaires?affaire=${dealId}`);
        }}
      />

      <NewLeadDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          toast("LeadListe ajouté.");
          refresh();
        }}
      />

      <ImportLeadsDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(inserted, skipped, updated) => {
          setImporting(false);
          toast(
            [
              `${inserted} lead(s) importé(s)`,
              updated ? `${updated} corrigé(s)` : null,
              skipped > 0 ? `${skipped} doublon(s) ignoré(s)` : null,
            ]
              .filter(Boolean)
              .join(", ") + ".",
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
 * Elle a deux vies. En lecture, elle informe : discrète tant que le voisin est
 * ancien, ambrée dès qu'il a été travaillé récemment. En prospection, elle
 * agit : un clic passe à l'interlocuteur suivant de la même organisation, et
 * le tour d'après revient au premier.
 *
 * C'est le même objet parce que c'est la même information — qui d'autre est
 * là — et qu'un second bouton à côté d'un badge qui dit déjà « 2 » aurait
 * demandé de comprendre lequel des deux fait quoi.
 */
function OrgChip({
  link,
  entree,
  onTourner,
}: {
  link?: OrgLink;
  entree?: FileEntry;
  onTourner?: (groupId: string) => void;
}) {
  const rotatif = Boolean(entree && entree.groupId && entree.candidats.length > 1 && onTourner);
  if (!link && !rotatif) return null;

  const alerte = link?.recent != null;
  const voisins = (link?.siblings ?? [])
    .map((sibling) => `${sibling.full_name ?? "sans nom"} — ${LEAD_STATUS[sibling.status].label}`)
    .join("\n");

  const total = entree ? entree.candidats.length : (link?.siblings.length ?? 0) + 1;

  const classe = cn(
    "flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ring-inset",
    alerte
      ? "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300"
      : "bg-[var(--surface-hover)] text-[var(--text-muted)] ring-[var(--border-subtle)]",
  );

  if (!rotatif) {
    return (
      <span
        title={
          (alerte
            ? `Contacté il y a ${link?.daysSince} j chez la même organisation.\n\n`
            : `Même organisation.\n\n`) + voisins
        }
        className={classe}
      >
        <Users2 className="size-2.5" />
        {(link?.siblings.length ?? 0) + 1}
      </span>
    );
  }

  const rang = entree!.candidats.findIndex((candidat) => candidat.id === entree!.lead.id) + 1;
  const suivant = entree!.candidats[rang % entree!.candidats.length];

  return (
    <button
      type="button"
      // La ligne entière ouvre le tiroir du lead : sans cela, changer
      // d'interlocuteur ouvrirait la fiche de celui qu'on vient de quitter.
      onClick={(event) => {
        event.stopPropagation();
        onTourner!(entree!.groupId!);
      }}
      title={
        `Interlocuteur ${rang} sur ${total} chez cette organisation.\n` +
        `Cliquer pour passer à ${suivant.full_name ?? "la fiche suivante"}` +
        `${suivant.phone ? " (portable)" : ""}.` +
        (alerte ? `\n\nQuelqu'un a été contacté il y a ${link?.daysSince} j chez eux.` : "") +
        (voisins ? `\n\n${voisins}` : "")
      }
      className={cn(
        classe,
        "cursor-pointer transition-colors hover:bg-brand-500/15 hover:text-brand-600 hover:ring-brand-500/30 dark:hover:text-brand-300",
      )}
    >
      <RotateCw className="size-2.5" />
      {rang}/{total}
    </button>
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
  lead: LeadListe;
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

/** Une valeur proposée par un filtre multiple, avec ce qu'elle pèse. */
type OptionMulti<T extends string | number> = {
  valeur: T;
  label: string;
  /** Classe de pastille colorée, quand la valeur en porte une. */
  pastille?: string;
  compte: number;
};

/**
 * Un filtre à cases, générique.
 *
 * La coquille est la même pour les statuts et pour le compteur NRP — même
 * bouton, même panneau, même « tout effacer », même fermeture au clic
 * extérieur. La recopier aurait fait deux dropdowns qui se seraient
 * lentement écartés l'un de l'autre, et dont l'un aurait fini par ne plus se
 * fermer pareil.
 */
function FiltreMulti<T extends string | number>({
  selected,
  options,
  onChange,
  resume,
  ariaLabel,
  className,
}: {
  selected: T[];
  options: OptionMulti<T>[];
  onChange: (value: T[]) => void;
  /** Ce qu'affiche le bouton, selon ce qui est retenu. */
  resume: (selected: T[]) => string;
  ariaLabel: string;
  className?: string;
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

  function toggle(valeur: T) {
    onChange(
      selected.includes(valeur)
        ? selected.filter((value) => value !== valeur)
        : [...selected, valeur],
    );
  }

  const pastilleDe = (valeur: T) => options.find((option) => option.valeur === valeur)?.pastille;

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          "flex h-9.5 min-w-48 items-center gap-2 rounded-[10px] px-3 text-sm transition-all",
          "bg-[var(--surface-input)] ring-1 ring-[var(--border-subtle)] hover:ring-[var(--border-strong)]",
          selected.length > 0 && "ring-brand-500/60",
        )}
      >
        {selected.length > 0 && pastilleDe(selected[0]) ? (
          <span className="flex -space-x-1">
            {selected.slice(0, 4).map((valeur) => (
              <span
                key={valeur}
                className={cn(
                  "size-2.5 rounded-full ring-2 ring-[var(--surface-input)]",
                  pastilleDe(valeur),
                )}
              />
            ))}
          </span>
        ) : null}
        <span className="truncate">{resume(selected)}</span>
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
            {options.map((option) => {
              const active = selected.includes(option.valeur);
              return (
                <li key={option.valeur}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => toggle(option.valeur)}
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
                    {option.pastille ? (
                      <span className={cn("size-2 shrink-0 rounded-full", option.pastille)} />
                    ) : null}
                    <span className="flex-1 truncate">{option.label}</span>
                    <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
                      {option.compte}
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
  return (
    <FiltreMulti
      selected={selected}
      onChange={onChange}
      ariaLabel="Filtrer par statut"
      options={LEAD_STATUS_ORDER.map((status) => ({
        valeur: status,
        label: LEAD_STATUS[status].label,
        pastille: TONE_DOT[LEAD_STATUS[status].tone],
        compte: counts.get(status) ?? 0,
      }))}
      resume={(retenus) =>
        retenus.length === 0
          ? `Tous les statuts (${total})`
          : retenus.length === 1
            ? LEAD_STATUS[retenus[0]].label
            : `${retenus.length} statuts`
      }
    />
  );
}

/**
 * Le compteur d'appels sans réponse, comme filtre.
 *
 * « NRP » sans le nombre mélange celui qu'on a tenté une fois et celui qu'on
 * a tenté huit : le premier vaut un rappel, le second vaut une décision. Les
 * neuf niveaux sont tous proposés, même vides — chercher le 7 et ne pas le
 * trouver ferait douter de l'endroit plutôt que de la donnée.
 */
function NrpFilter({
  selected,
  counts,
  total,
  onChange,
}: {
  selected: number[];
  counts: Map<number, number>;
  total: number;
  onChange: (value: number[]) => void;
}) {
  return (
    <FiltreMulti
      selected={selected}
      onChange={onChange}
      ariaLabel="Filtrer par nombre d'appels sans réponse"
      className="min-w-0"
      options={Array.from({ length: NRP_MAX }, (_, index) => index + 1).map((niveau) => ({
        valeur: niveau,
        label: `NRP ${niveau}`,
        compte: counts.get(niveau) ?? 0,
      }))}
      resume={(retenus) =>
        retenus.length === 0
          ? `Tous les NRP (${total})`
          : retenus.length === 1
            ? `NRP ${retenus[0]}`
            : `NRP ${[...retenus].sort((a, b) => a - b).join(", ")}`
      }
    />
  );
}


/**
 * Ce qu'on a fait en dernier sur ce lead, et quand.
 *
 * « Il y a deux jours » ne suffisait pas : on veut savoir si c'était un NRP,
 * une note après un vrai échange ou une relance posée. Le geste d'abord,
 * l'ancienneté ensuite, l'auteur quand on est deux à prospecter.
 */
function DerniereAction({
  lead,
  members,
  dense,
}: {
  lead: LeadListe;
  members?: MemberLite[];
  dense?: boolean;
}) {
  const action = libelleAction(lead.last_action, lead.last_action_detail);
  if (!action || !lead.last_action_at) {
    return <span className="text-[12px] text-[var(--text-muted)]">—</span>;
  }

  const auteur = lead.last_action_by
    ? members?.find((m) => m.id === lead.last_action_by)
    : undefined;
  const prenom = auteur?.full_name?.split(/\s+/)[0] ?? null;
  const quand = formatRelative(lead.last_action_at);
  const infobulle = [action.titre, action.precision, `${formatDateHeure(lead.last_action_at, { avecAnnee: true })}${auteur ? ` · ${auteur.full_name ?? auteur.email}` : ""}`]
    .filter(Boolean)
    .join("\n");

  if (dense) {
    return (
      <span title={infobulle} className="flex min-w-0 items-baseline gap-1.5 text-[12px]">
        <span className="truncate font-medium text-[var(--text-secondary)]">{action.titre}</span>
        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{quand}</span>
      </span>
    );
  }

  return (
    <span title={infobulle} className="block min-w-0">
      <span className="block truncate text-[12px] font-medium text-[var(--text-secondary)]">
        {action.titre}
        {action.precision ? (
          <span className="font-normal text-[var(--text-muted)]"> · {action.precision}</span>
        ) : null}
      </span>
      <span className="block text-[11px] text-[var(--text-muted)]">
        {quand}
        {prenom ? ` · ${prenom}` : ""}
      </span>
    </span>
  );
}

/* --------------------------------------------------- Cellules éditables */

/**
 * Un lead tel qu'il se lit sur un téléphone.
 *
 * Le tableau est fait pour comparer des lignes ; la carte, pour décider d'un
 * appel. Elle ne reprend donc pas les onze colonnes mais les cinq choses qui
 * précèdent le geste : à qui l'on parle, chez qui, où en est la relation,
 * quand on a promis de rappeler, et le numéro. Le reste — le CA, le poste, le
 * commentaire long, l'assignation — vit dans la fiche, à un doigt de là.
 *
 * L'appel est un lien `tel:` et non un bouton : sur un téléphone, c'est
 * l'unique geste qui compte, et il doit partir du premier coup.
 */
function LeadCard({
  lead,
  rang,
  aujourdhui,
  prospection,
  endormi,
  entree,
  lien,
  onTourner,
  onOuvrir,
  onStatut,
  onNrp,
  onRelance,
}: {
  lead: LeadListe;
  rang: number;
  aujourdhui: string;
  prospection: boolean;
  endormi: boolean;
  entree?: FileEntry;
  lien?: OrgLink;
  onTourner: (groupId: string) => void;
  onOuvrir: () => void;
  onStatut: (lead: LeadListe, status: LeadStatus) => void;
  onNrp: (lead: LeadListe) => void;
  onRelance: (value: string | null) => void;
}) {
  const numero = lead.phone ?? lead.phone_standard ?? null;
  const enRetard = Boolean(lead.follow_up_on && lead.follow_up_on < aujourdhui);
  const pourAujourdhui = lead.follow_up_on === aujourdhui;

  return (
    <li
      className={cn(
        "relative px-3 py-3 transition-colors active:bg-[var(--surface-hover)]/60",
        prospection && pourAujourdhui && "bg-brand-500/[0.07]",
        prospection && enRetard && "bg-rose-500/[0.07]",
      )}
    >
      {/* Le corps ouvre la fiche ; les commandes en dessous s'en détachent
          explicitement, sinon changer un statut ouvrirait le tiroir. */}
      <button type="button" onClick={onOuvrir} className="flex w-full items-start gap-2.5 text-left">
        <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
          {rang}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-medium">
              {lead.full_name ?? lead.email ?? "Sans nom"}
            </span>
            {lead.converted_deal_id ? (
              <ExternalLink className="size-3 shrink-0 text-emerald-500" />
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-[var(--text-muted)]">
            <span className="truncate">{lead.company_name ?? "—"}</span>
            {endormi ? (
              <MoonStar
                className="size-3 shrink-0 text-violet-500 dark:text-violet-300"
                aria-label="Endormi"
              />
            ) : null}
          </span>
          {lead.job_title ? (
            <span className="mt-0.5 block truncate text-[11.5px] text-[var(--text-muted)]">
              {lead.job_title}
            </span>
          ) : null}
          {lead.last_action ? (
            <span className="mt-1 block">
              <DerniereAction lead={lead} dense />
            </span>
          ) : null}
        </span>
      </button>

      {/*
        Deux rangs fixes plutôt qu'un enroulement libre.

        Laissée à elle-même, la ligne coupait à un endroit différent selon la
        longueur du statut : sur une liste de soixante fiches, aucune commande
        ne se trouvait deux fois au même endroit, et l'œil devait relire chaque
        carte au lieu de balayer une colonne. Le statut et la relance en haut,
        les repères et l'appel en bas — toujours.
      */}
      <div className="mt-2.5 flex items-center gap-2 pl-7.5">
        <StatusSelect lead={lead} onChange={onStatut} onNrp={onNrp} />

        <DateField
          value={lead.follow_up_on}
          placeholder="Planifier"
          onChange={onRelance}
          className="min-w-28"
        />
      </div>

      <div className="mt-1.5 flex items-center gap-2 pl-7.5">
        <OrgChip link={lien} entree={entree} onTourner={onTourner} />

        {lead.linkedin_url ? (
          <a
            href={lead.linkedin_url}
            target="_blank"
            rel="noreferrer"
            aria-label="Profil LinkedIn"
            className="grid size-9 place-items-center rounded-lg text-[var(--text-muted)] active:bg-[var(--surface-hover)]"
          >
            <Linkedin className="size-4" />
          </a>
        ) : null}

        {/*
          L'appel occupe le bord droit, là où le pouce tombe naturellement sur
          un téléphone tenu d'une main. Le numéro l'accompagne : composer sans
          savoir si c'est un portable ou un standard fait aborder la personne
          de travers.
        */}
        {numero ? (
          <a
            href={`tel:${numero.replace(/\s/g, "")}`}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-500/15 px-3 font-mono text-[12px] text-brand-600 active:bg-brand-500/25 dark:text-brand-300"
          >
            <Phone className="size-3.5 shrink-0" />
            {numero}
            {!lead.phone && lead.phone_standard ? (
              <span className="text-[9.5px] tracking-wide uppercase opacity-70">std</span>
            ) : null}
          </a>
        ) : (
          <span className="ml-auto text-[11.5px] text-[var(--text-muted)]">Aucun numéro</span>
        )}
      </div>
    </li>
  );
}

function StatusSelect({
  lead,
  onChange,
  onNrp,
}: {
  lead: LeadListe;
  onChange: (lead: LeadListe, status: LeadStatus) => void;
  onNrp?: (lead: LeadListe) => void;
}) {
  const nrp = lead.status === "nrp";
  const compte = lead.nrp_count ?? 0;

  return (
    <span className="inline-flex items-center gap-1">
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
            {/* Le compte dans l'étiquette de l'option courante : sans lui, la
                liste refermée dirait « NRP » quel que soit le nombre d'appels. */}
            {value === "nrp" && nrp && compte > 0
              ? `${LEAD_STATUS[value].label} ${compte}`
              : LEAD_STATUS[value].label}
          </option>
        ))}
      </select>

      {/*
        Le bouton qui remplace deux clics et une lecture.

        On sait qu'on n'a pas eu de réponse au moment où l'on raccroche ; le
        dire doit coûter un geste, pas la réouverture d'une liste. Il n'apparaît
        que sur un lead NRP : ailleurs, c'est le statut qu'il faut changer
        d'abord, et l'incrément n'aurait aucun sens.
      */}
      {nrp && onNrp ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onNrp(lead);
          }}
          disabled={compte >= NRP_MAX}
          title={
            compte >= NRP_MAX
              ? `Compteur au maximum (${NRP_MAX})`
              : `Un appel sans réponse de plus — passe à ${compte + 1}`
          }
          aria-label="Un appel sans réponse de plus"
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
            "ring-1 ring-inset transition-colors",
            compte >= NRP_MAX
              ? "cursor-not-allowed text-[var(--text-muted)] ring-[var(--border-subtle)] opacity-50"
              : "text-amber-700 ring-amber-500/40 hover:bg-amber-500/15 dark:text-amber-300",
          )}
        >
          +1
        </button>
      ) : null}
    </span>
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
  lead: LeadListe;
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
  const vide = {
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    job_title: "",
    company_name: "",
    region: "",
    comment: "",
  };
  const [form, setForm] = useState(vide);
  // L'entreprise reprise d'une fiche existante : ses champs partent avec le lead.
  const [reprise, setReprise] = useState<EntrepriseConnue | null>(null);

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
      job_title: form.job_title || null,
      company_name: form.company_name || null,
      region: form.region || null,
      comment: form.comment || null,
      entreprise: reprise && reprise.company_name === form.company_name ? reprise : null,
    });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    setForm(vide);
    setReprise(null);
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
        <Field label="Entreprise" className="sm:col-span-2">
          <ChoixEntreprise
            valeur={form.company_name}
            reprise={reprise}
            onSaisie={(nom) => {
              set("company_name", nom);
              if (reprise && nom !== reprise.company_name) setReprise(null);
            }}
            onChoix={(entreprise) => {
              setReprise(entreprise);
              setForm((f) => ({ ...f, company_name: entreprise.company_name, region: f.region || entreprise.region || "" }));
            }}
          />
        </Field>
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
        <Field label="Poste">
          <Input value={form.job_title} onChange={(event) => set("job_title", event.target.value)} />
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

/**
 * Le nom d'entreprise, avec les entreprises déjà connues en suggestion.
 *
 * On peut toujours taper un nom nouveau : la suggestion n'est qu'un raccourci.
 * Choisie, elle apporte ce qu'on sait déjà — site, SIRET, secteur, standard —
 * et le dit sous le champ, pour qu'on sache ce qui partira avec le lead.
 */
function ChoixEntreprise({
  valeur,
  reprise,
  onSaisie,
  onChoix,
}: {
  valeur: string;
  reprise: EntrepriseConnue | null;
  onSaisie: (nom: string) => void;
  onChoix: (entreprise: EntrepriseConnue) => void;
}) {
  const [suggestions, setSuggestions] = useState<EntrepriseConnue[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(0);

  useEffect(() => {
    if (reprise?.company_name === valeur || valeur.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    let annule = false;
    const minuteur = setTimeout(() => {
      void rechercherEntreprises(valeur).then((liste) => {
        if (annule) return;
        setSuggestions(liste);
        setActif(0);
      });
    }, 180);
    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [valeur, reprise]);

  function choisir(entreprise: EntrepriseConnue) {
    onChoix(entreprise);
    setOuvert(false);
    setSuggestions([]);
  }

  const visibles = ouvert ? suggestions : [];
  const details = reprise
    ? [reprise.company_activity || reprise.sector, reprise.siret ? `SIRET ${reprise.siret}` : reprise.siren ? `SIREN ${reprise.siren}` : null, reprise.company_website, reprise.phone_standard]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="relative">
      <Input
        value={valeur}
        placeholder="Tapez pour retrouver une entreprise, ou saisissez-en une nouvelle"
        autoComplete="off"
        role="combobox"
        aria-expanded={visibles.length > 0}
        onChange={(event) => {
          onSaisie(event.target.value);
          setOuvert(true);
        }}
        onFocus={() => setOuvert(true)}
        onBlur={() => setTimeout(() => setOuvert(false), 120)}
        onKeyDown={(event) => {
          if (!visibles.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActif((i) => (i + 1) % visibles.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActif((i) => (i - 1 + visibles.length) % visibles.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            choisir(visibles[actif]!);
          } else if (event.key === "Escape") {
            setOuvert(false);
          }
        }}
      />
      {visibles.length > 0 ? (
        <ul
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-overlay)] p-1 shadow-[var(--shadow-pop)]"
        >
          {visibles.map((entreprise, index) => (
            <li key={`${entreprise.source}-${entreprise.company_name}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === actif}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choisir(entreprise)}
                onMouseEnter={() => setActif(index)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px]",
                  index === actif && "bg-[var(--surface-hover)]",
                )}
              >
                <Building2 className="size-3.5 shrink-0 text-[var(--text-muted)]" />
                <span className="min-w-0 flex-1 truncate font-medium">{entreprise.company_name}</span>
                <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                  {entreprise.source === "crm"
                    ? "Entreprise CRM"
                    : `${entreprise.leads} lead${entreprise.leads > 1 ? "s" : ""}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {reprise ? (
        <p className="mt-1 truncate text-[11.5px] text-emerald-600 dark:text-emerald-400">
          ✓ Reprise de la fiche existante{details ? ` — ${details}` : ""}
        </p>
      ) : null}
    </div>
  );
}
