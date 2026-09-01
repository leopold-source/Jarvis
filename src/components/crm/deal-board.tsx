"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { CalendarDays, GripVertical, Handshake, Plus, Search } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  SearchInput,
  Select,
  useToast,
} from "@/components/ui";
import { DEAL_STAGE, DEAL_STAGE_ORDER, OPEN_STAGES, TONE_DOT } from "@/lib/constants";
import type { Deal, DealStage } from "@/lib/database.types";
import { cn, daysUntil, formatMoney, normalize, positionBetween } from "@/lib/utils";
import { createDeal, moveDeal } from "@/app/(crm)/affaires/actions";
import { DealDrawer } from "@/components/crm/deal-drawer";

type CompanyLite = { id: string; name: string; sector: string | null; region: string | null };
type ContactLite = { id: string; full_name: string | null; email: string | null; company_id: string | null };
type MemberLite = { id: string; full_name: string | null; email: string; role: string };
type ProjectLink = { id: string; deal_id: string | null };

export function DealBoard({
  deals,
  companies,
  contacts,
  members,
  projects,
  isAdmin,
}: {
  deals: Deal[];
  companies: CompanyLite[];
  contacts: ContactLite[];
  members: MemberLite[];
  projects: ProjectLink[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [, startTransition] = useTransition();

  // Copie locale pour un déplacement instantané, réconciliée au refresh.
  const [items, setItems] = useState(deals);
  const [dragging, setDragging] = useState<Deal | null>(null);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("tous");
  const [selected, setSelected] = useState<Deal | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => setItems(deals), [deals]);

  useEffect(() => {
    const id = params.get("affaire");
    if (!id) return;
    const match = deals.find((deal) => deal.id === id);
    if (match) setSelected(match);
  }, [params, deals]);

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies],
  );
  const contactById = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const projectByDeal = useMemo(
    () => new Map(projects.filter((p) => p.deal_id).map((p) => [p.deal_id!, p.id])),
    [projects],
  );

  const filtered = useMemo(() => {
    const needle = normalize(search.trim());
    return items.filter((deal) => {
      if (owner !== "tous" && deal.owner_id !== owner) return false;
      if (!needle) return true;
      const company = deal.company_id ? companyById.get(deal.company_id)?.name : "";
      return normalize([deal.name, company].filter(Boolean).join(" ")).includes(needle);
    });
  }, [items, search, owner, companyById]);

  const columns = useMemo(
    () =>
      DEAL_STAGE_ORDER.map((stage) => ({
        stage,
        deals: filtered
          .filter((deal) => deal.stage === stage)
          .sort((a, b) => a.position - b.position),
      })),
    [filtered],
  );

  const pipelineTotal = filtered
    .filter((deal) => OPEN_STAGES.includes(deal.stage))
    .reduce((sum, deal) => sum + (deal.amount ?? 0), 0);

  const sensors = useSensors(
    // Un petit seuil évite qu'un clic sur la carte soit interprété comme un glisser.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onDragStart(event: DragStartEvent) {
    setDragging(items.find((deal) => deal.id === event.active.id) ?? null);
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;

    const deal = items.find((item) => item.id === active.id);
    const targetStage = over.id as DealStage;
    if (!deal || !DEAL_STAGE_ORDER.includes(targetStage) || deal.stage === targetStage) return;

    const column = items
      .filter((item) => item.stage === targetStage)
      .sort((a, b) => a.position - b.position);
    const position = positionBetween(null, column[0]?.position ?? null);

    setItems((current) =>
      current.map((item) => (item.id === deal.id ? { ...item, stage: targetStage, position } : item)),
    );

    const result = await moveDeal(deal.id, targetStage, position);
    if (!result.ok) {
      setItems(deals);
      toast(result.error, "error");
      return;
    }

    if (targetStage === "gagne" && result.data?.projectId) {
      toast("Affaire gagnée : le projet a été créé avec son plan de démarrage.");
    } else {
      toast(`Déplacée vers « ${DEAL_STAGE[targetStage].label} »`);
    }
    startTransition(() => router.refresh());
  }

  return (
    <>
      <Card className="flex flex-wrap items-center gap-2.5 p-3.5">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Affaire ou entreprise…"
          className="min-w-56 flex-1"
        />
        <Select
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
          className="w-auto min-w-44"
          aria-label="Filtrer par responsable"
        >
          <option value="tous">Tous les responsables</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.full_name ?? member.email}
            </option>
          ))}
        </Select>
        <span className="rounded-full bg-[var(--surface-hover)] px-3 py-1.5 text-[12.5px] text-[var(--text-secondary)]">
          Pipeline ouvert&nbsp;: <span className="font-semibold tabular-nums">{formatMoney(pipelineTotal, true)}</span>
        </span>
        <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Nouvelle affaire
        </Button>
      </Card>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Handshake className="size-5" />}
            title="Le pipeline est vide"
            description="Convertissez un lead en « call pris » depuis la page Leads, ou créez une affaire à la main."
            action={
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                Nouvelle affaire
              </Button>
            }
          />
        </Card>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6">
            <div className="flex min-h-[60vh] gap-3">
              {columns.map(({ stage, deals: stageDeals }) => (
                <BoardColumn
                  key={stage}
                  stage={stage}
                  deals={stageDeals}
                  companyById={companyById}
                  memberById={memberById}
                  projectByDeal={projectByDeal}
                  onOpen={setSelected}
                />
              ))}
            </div>
          </div>

          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22,1,0.36,1)" }}>
            {dragging ? (
              <DealCard
                deal={dragging}
                company={dragging.company_id ? companyById.get(dragging.company_id) : undefined}
                owner={dragging.owner_id ? memberById.get(dragging.owner_id) : undefined}
                overlay
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <DealDrawer
        deal={selected}
        company={selected?.company_id ? companyById.get(selected.company_id) : undefined}
        contact={selected?.contact_id ? contactById.get(selected.contact_id) : undefined}
        projectId={selected ? projectByDeal.get(selected.id) : undefined}
        members={members}
        isAdmin={isAdmin}
        onClose={() => setSelected(null)}
        onSaved={() => startTransition(() => router.refresh())}
      />

      <NewDealDialog
        open={creating}
        companies={companies}
        contacts={contacts}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          toast("Affaire créée.");
          startTransition(() => router.refresh());
        }}
      />
    </>
  );
}

function BoardColumn({
  stage,
  deals,
  companyById,
  memberById,
  projectByDeal,
  onOpen,
}: {
  stage: DealStage;
  deals: Deal[];
  companyById: Map<string, CompanyLite>;
  memberById: Map<string, MemberLite>;
  projectByDeal: Map<string, string>;
  onOpen: (deal: Deal) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const meta = DEAL_STAGE[stage];
  const total = deals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex w-[286px] shrink-0 flex-col rounded-xl border transition-colors duration-200",
        isOver
          ? "border-brand-500/60 bg-brand-500/5 shadow-[0_0_0_1px_var(--glow-brand)]"
          : "border-[var(--border-subtle)] bg-[var(--surface-raised)]/45",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[DEAL_STAGE[stage].tone])} aria-hidden />
          <span className="truncate text-[12.5px] font-medium">{meta.label}</span>
          <span className="rounded-full bg-[var(--surface-hover)] px-1.5 text-[11px] tabular-nums text-[var(--text-muted)]">
            {deals.length}
          </span>
        </span>
        {total > 0 ? (
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
            {formatMoney(total, true)}
          </span>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col gap-2 p-2">
        {deals.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11.5px] text-[var(--text-muted)]">
            Déposez une affaire ici
          </p>
        ) : (
          deals.map((deal, index) => (
            <DraggableDeal
              key={deal.id}
              deal={deal}
              index={index}
              company={deal.company_id ? companyById.get(deal.company_id) : undefined}
              owner={deal.owner_id ? memberById.get(deal.owner_id) : undefined}
              hasProject={projectByDeal.has(deal.id)}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </section>
  );
}

function DraggableDeal({
  deal,
  index,
  company,
  owner,
  hasProject,
  onOpen,
}: {
  deal: Deal;
  index: number;
  company?: CompanyLite;
  owner?: MemberLite;
  hasProject: boolean;
  onOpen: (deal: Deal) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });

  // La carte entière est saisissable : le seuil de 6 px du capteur distingue un
  // clic (qui ouvre le détail) d'un glisser.
  return (
    <div
      ref={setNodeRef}
      style={{ ["--i" as string]: index }}
      className={cn("stagger touch-none", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <DealCard
        deal={deal}
        company={company}
        owner={owner}
        hasProject={hasProject}
        onOpen={() => onOpen(deal)}
      />
    </div>
  );
}

function DealCard({
  deal,
  company,
  owner,
  hasProject,
  overlay,
  onOpen,
}: {
  deal: Deal;
  company?: CompanyLite;
  owner?: MemberLite;
  hasProject?: boolean;
  overlay?: boolean;
  onOpen?: () => void;
}) {
  const daysInStage = Math.abs(daysUntil(deal.stage_changed_at) ?? 0);

  return (
    <article
      onClick={onOpen}
      className={cn(
        "group rounded-[11px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-2.5",
        "shadow-[var(--shadow-card)] transition-all duration-200",
        !overlay && "cursor-grab hover:-translate-y-0.5 hover:border-[var(--border-strong)] active:cursor-grabbing",
        overlay && "rotate-2 scale-[1.02] shadow-[var(--shadow-pop)] ring-1 ring-brand-500/40",
      )}
    >
      <div className="flex items-start gap-1.5">
        {/* Affordance visuelle : le glisser est capté par la carte entière. */}
        <GripVertical
          className="mt-0.5 size-3.5 shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{deal.name}</p>
          {company ? (
            <p className="truncate text-[11.5px] text-[var(--text-muted)]">{company.name}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {deal.amount ? <Badge tone="cyan">{formatMoney(deal.amount, true)}</Badge> : null}
        {hasProject ? <Badge tone="emerald">Projet</Badge> : null}
        {deal.next_step_on ? (
          <Badge tone={(daysUntil(deal.next_step_on) ?? 0) < 0 ? "rose" : "amber"}>
            <CalendarDays className="size-3" />
            {new Date(deal.next_step_on).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
          </Badge>
        ) : null}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span className="truncate">{owner?.full_name ?? owner?.email ?? "Non assignée"}</span>
        {daysInStage > 0 ? <span className="shrink-0 tabular-nums">{daysInStage} j</span> : null}
      </div>
    </article>
  );
}


function NewDealDialog({
  open,
  companies,
  contacts,
  onClose,
  onCreated,
}: {
  open: boolean;
  companies: CompanyLite[];
  contacts: ContactLite[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [contactId, setContactId] = useState("");
  const [amount, setAmount] = useState("");

  const eligibleContacts = companyId
    ? contacts.filter((contact) => contact.company_id === companyId)
    : contacts;

  async function submit() {
    if (!name.trim()) {
      toast("Donnez un nom à l'affaire.", "error");
      return;
    }
    setSaving(true);
    const parsed = amount ? Number(amount.replace(",", ".")) : null;
    const result = await createDeal({
      name: name.trim(),
      company_id: companyId || null,
      contact_id: contactId || null,
      amount: Number.isFinite(parsed!) ? parsed : null,
    });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    setName("");
    setCompanyId("");
    setContactId("");
    setAmount("");
    onCreated();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvelle affaire"
      description="Elle démarre à l'étape « Demande de RDV envoyée »."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            Créer
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Nom de l'affaire">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Refonte process — Cylebat" />
        </Field>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Entreprise">
            <Select
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setContactId("");
              }}
            >
              <option value="">—</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contact">
            <Select value={contactId} onChange={(event) => setContactId(event.target.value)}>
              <option value="">—</option>
              {eligibleContacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.full_name || contact.email}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Montant estimé (€)">
          <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="15000" />
        </Field>
        {companies.length === 0 ? (
          <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
            <Search className="size-3.5" />
            Aucune entreprise encore : convertissez un lead pour en créer une.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
