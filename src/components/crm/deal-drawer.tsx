"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ExternalLink, FolderKanban, Mail, Trash2, User } from "lucide-react";

import { Badge, Button, Drawer, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { DateField } from "@/components/ui/date-field";
import { DEAL_STAGE, DEAL_STAGE_ORDER } from "@/lib/constants";
import type { Deal, DealStage } from "@/lib/database.types";
import { formatDate, formatMoney } from "@/lib/utils";
import { deleteDeal, moveDeal, updateDeal } from "@/app/(crm)/affaires/actions";
import { DealEmails } from "@/components/crm/deal-emails";
import { DealCalls } from "@/components/crm/deal-calls";
import { DealDossier } from "@/components/crm/deal-dossier";

type CompanyLite = { id: string; name: string; sector: string | null; region: string | null };
type ContactLite = { id: string; full_name: string | null; email: string | null; company_id: string | null };
type MemberLite = { id: string; full_name: string | null; email: string; role: string };

export function DealDrawer({
  deal,
  company,
  contact,
  projectId,
  members,
  isAdmin,
  onClose,
  onSaved,
}: {
  deal: Deal | null;
  company?: CompanyLite;
  contact?: ContactLite;
  projectId?: string;
  members: MemberLite[];
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState({
    name: "",
    amount: "",
    stage: "demande_rdv_envoyee" as DealStage,
    owner_id: "",
    expected_close_on: "",
    next_step: "",
    next_step_on: "",
    description: "",
    lost_reason: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!deal) return;
    setForm({
      name: deal.name,
      amount: deal.amount != null ? String(deal.amount) : "",
      stage: deal.stage,
      owner_id: deal.owner_id ?? "",
      expected_close_on: deal.expected_close_on ?? "",
      next_step: deal.next_step ?? "",
      next_step_on: deal.next_step_on ?? "",
      description: deal.description ?? "",
      lost_reason: deal.lost_reason ?? "",
    });
  }, [deal]);

  if (!deal) return null;

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!deal) return;
    setSaving(true);

    const parsed = form.amount ? Number(form.amount.replace(",", ".")) : null;
    const result = await updateDeal(deal.id, {
      name: form.name.trim() || deal.name,
      amount: Number.isFinite(parsed!) ? parsed : null,
      owner_id: form.owner_id || null,
      expected_close_on: form.expected_close_on || null,
      next_step: form.next_step || null,
      next_step_on: form.next_step_on || null,
      description: form.description || null,
      lost_reason: form.lost_reason || null,
    });

    // L'étape passe par `moveDeal` : c'est elle qui amorce le projet en cas de gain.
    if (result.ok && form.stage !== deal.stage) {
      const moved = await moveDeal(deal.id, form.stage, deal.position);
      if (!moved.ok) {
        setSaving(false);
        toast(moved.error, "error");
        return;
      }
      if (form.stage === "gagne") toast("Affaire gagnée : projet créé.");
    }

    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Affaire enregistrée.");
    onSaved();
  }

  async function remove() {
    if (!deal) return;
    if (!window.confirm("Supprimer définitivement cette affaire ?")) return;
    const result = await deleteDeal(deal.id);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Affaire supprimée.");
    onClose();
    router.refresh();
  }

  const isLost = form.stage === "perdu" || form.stage === "non_qualifie";

  return (
    <Drawer
      open
      onClose={onClose}
      title={deal.name}
      subtitle={company?.name}
      footer={
        <>
          {isAdmin ? (
            <Button variant="ghost" onClick={remove} className="mr-auto text-rose-400 hover:text-rose-300">
              <Trash2 className="size-4" />
              Supprimer
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={DEAL_STAGE[deal.stage].tone}>{DEAL_STAGE[deal.stage].label}</Badge>
          {deal.amount ? <Badge tone="cyan">{formatMoney(deal.amount)}</Badge> : null}
          <span className="text-[11.5px] text-[var(--text-muted)]">
            Dans cette étape depuis le {formatDate(deal.stage_changed_at)}
          </span>
        </div>

        {projectId ? (
          <Link
            href={`/projets/${projectId}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3 transition-colors hover:bg-emerald-500/12"
          >
            <span className="flex items-center gap-2 text-[13px]">
              <FolderKanban className="size-4 text-emerald-400" />
              Le projet lié est ouvert
            </span>
            <ExternalLink className="size-3.5 text-emerald-400" />
          </Link>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <RelationTile
            icon={Building2}
            label="Entreprise"
            value={company?.name}
            href={company ? `/entreprises?entreprise=${company.id}` : undefined}
          />
          <RelationTile
            icon={User}
            label="Contact"
            value={contact?.full_name || contact?.email}
            href={contact ? `/contacts?contact=${contact.id}` : undefined}
          />
        </div>

        {contact?.email ? (
          <a
            href={`mailto:${contact.email}`}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-brand-400 hover:text-brand-300"
          >
            <Mail className="size-3.5" />
            {contact.email}
          </a>
        ) : null}

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Nom de l'affaire" className="sm:col-span-2">
            <Input value={form.name} onChange={(event) => set("name", event.target.value)} />
          </Field>
          <Field label="Étape">
            <Select value={form.stage} onChange={(event) => set("stage", event.target.value as DealStage)}>
              {DEAL_STAGE_ORDER.map((stage) => (
                <option key={stage} value={stage}>
                  {DEAL_STAGE[stage].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Montant (€)">
            <Input inputMode="decimal" value={form.amount} onChange={(event) => set("amount", event.target.value)} />
          </Field>
          <Field label="Responsable">
            <Select value={form.owner_id} onChange={(event) => set("owner_id", event.target.value)}>
              <option value="">Non assignée</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name ?? member.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Clôture prévue">
            <DateField
              value={form.expected_close_on || null}
              onChange={(value) => set("expected_close_on", value ?? "")}
              className="w-full"
            />
          </Field>
          <Field label="Prochaine étape">
            <Input
              value={form.next_step}
              onChange={(event) => set("next_step", event.target.value)}
              placeholder="Relancer après la propale"
            />
          </Field>
          <Field label="Date de la prochaine étape">
            <DateField
              value={form.next_step_on || null}
              onChange={(value) => set("next_step_on", value ?? "")}
              className="w-full"
            />
          </Field>
        </div>

        {isLost ? (
          <Field label="Raison de la perte">
            <Textarea
              rows={2}
              value={form.lost_reason}
              onChange={(event) => set("lost_reason", event.target.value)}
              placeholder="Budget, timing, concurrent…"
            />
          </Field>
        ) : null}

        <Field label="Notes">
          <Textarea
            rows={6}
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
            placeholder="Contexte, besoins exprimés, points de vigilance…"
          />
        </Field>

        {deal ? <DealDossier dealId={deal.id} /> : null}

        {deal ? <DealCalls target={{ kind: "affaire", id: deal.id }} /> : null}

        {deal ? <DealEmails dealId={deal.id} /> : null}
      </div>
    </Drawer>
  );
}

function RelationTile({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string | null;
  href?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <Icon className="size-3" />
        {label}
      </span>
      <span className="mt-1 block truncate text-[13px]">{value ?? "—"}</span>
    </>
  );
  const className =
    "block rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 px-3 py-2 transition-colors";

  return href && value ? (
    <Link href={href} className={`${className} hover:border-[var(--border-strong)] hover:text-brand-300`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
