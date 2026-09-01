"use client";

import { useEffect, useState } from "react";
import { Building2, CalendarClock, Globe, Linkedin, Mail, MapPin, Phone, Rocket } from "lucide-react";

import { Badge, Button, Drawer, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { LEAD_STATUS, LEAD_STATUS_ORDER } from "@/lib/constants";
import type { Lead, LeadStatus } from "@/lib/database.types";
import { formatDate, formatMoney } from "@/lib/utils";
import { updateLead } from "@/app/(crm)/leads/actions";

export function LeadDrawer({
  lead,
  onClose,
  onSaved,
  onConvert,
}: {
  lead: Lead | null;
  onClose: () => void;
  onSaved: () => void;
  onConvert: (lead: Lead, dealName: string, amount: number | null) => Promise<void>;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<LeadStatus>("nouveau");
  const [comment, setComment] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [dealName, setDealName] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (!lead) return;
    setStatus(lead.status);
    setComment(lead.comment ?? "");
    setFollowUp(lead.follow_up_on ?? "");
    setDealName(lead.company_name ?? lead.full_name ?? "Nouvelle affaire");
    setAmount("");
    setConverting(false);
  }, [lead]);

  if (!lead) return null;

  const alreadyConverted = Boolean(lead.converted_deal_id);

  async function save() {
    if (!lead) return;
    setSaving(true);
    const result = await updateLead(lead.id, {
      status,
      comment: comment || null,
      follow_up_on: followUp || null,
    });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Lead mis à jour.");
    onSaved();
  }

  async function convert() {
    if (!lead) return;
    setSaving(true);
    const parsed = amount ? Number(amount.replace(",", ".")) : null;
    await onConvert(lead, dealName.trim() || lead.company_name || "Nouvelle affaire", Number.isFinite(parsed!) ? parsed : null);
    setSaving(false);
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={lead.full_name ?? "Lead sans nom"}
      subtitle={lead.company_name ?? undefined}
      footer={
        converting ? (
          <>
            <Button variant="ghost" onClick={() => setConverting(false)}>
              Retour
            </Button>
            <Button variant="primary" loading={saving} onClick={convert}>
              <Rocket className="size-4" />
              Créer l&apos;affaire
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Fermer
            </Button>
            {!alreadyConverted ? (
              <Button variant="primary" onClick={() => setConverting(true)}>
                <Rocket className="size-4" />
                Call pris → créer l&apos;affaire
              </Button>
            ) : null}
            <Button variant="secondary" loading={saving} onClick={save}>
              Enregistrer
            </Button>
          </>
        )
      }
    >
      {converting ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-linear-to-br from-brand-500/8 to-accent-500/5 p-4">
            <p className="text-[13px] font-medium">Ce que la conversion va créer</p>
            <ul className="mt-2 space-y-1 text-[12.5px] text-[var(--text-muted)]">
              <li>• L&apos;entreprise « {lead.company_name ?? "—"} » (réutilisée si elle existe déjà)</li>
              <li>• Le contact « {lead.full_name ?? "—"} », rattaché à cette entreprise</li>
              <li>• Une affaire à l&apos;étape « Demande de RDV envoyée »</li>
            </ul>
          </div>

          <Field label="Nom de l'affaire">
            <Input value={dealName} onChange={(event) => setDealName(event.target.value)} />
          </Field>
          <Field label="Montant estimé (€)" hint="Facultatif, modifiable à tout moment depuis l'affaire.">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="15000"
            />
          </Field>
        </div>
      ) : (
        <div className="space-y-5">
          {alreadyConverted ? (
            <div className="rounded-xl bg-emerald-500/10 px-4 py-3 text-[12.5px] text-emerald-400 ring-1 ring-emerald-500/25">
              Ce lead a été converti le {formatDate(lead.converted_at, "long")}. L&apos;affaire est disponible
              dans le pipeline.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <InfoTile icon={Mail} label="E-mail" value={lead.email} href={lead.email ? `mailto:${lead.email}` : null} />
            <InfoTile icon={Phone} label="Téléphone" value={lead.phone} href={lead.phone ? `tel:${lead.phone.replace(/\s/g, "")}` : null} />
            <InfoTile icon={Building2} label="Entreprise" value={lead.company_name} />
            <InfoTile icon={MapPin} label="Région" value={lead.region} />
            <InfoTile
              icon={Globe}
              label="Site web"
              value={lead.company_website}
              href={lead.company_website}
            />
            <InfoTile icon={Linkedin} label="LinkedIn" value={lead.linkedin_url ? "Profil" : null} href={lead.linkedin_url} />
          </div>

          <div className="flex flex-wrap gap-2">
            {lead.revenue ? <Badge tone="cyan">CA {formatMoney(lead.revenue, true)}</Badge> : null}
            {lead.company_activity ? <Badge tone="indigo">{lead.company_activity}</Badge> : null}
            {lead.segment ? <Badge tone="stone">{lead.segment}</Badge> : null}
            {lead.owner_name ? <Badge tone="violet">Owner · {lead.owner_name}</Badge> : null}
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Statut">
              <Select value={status} onChange={(event) => setStatus(event.target.value as LeadStatus)}>
                {LEAD_STATUS_ORDER.filter((value) => value !== "call_pris" || alreadyConverted).map((value) => (
                  <option key={value} value={value}>
                    {LEAD_STATUS[value].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date de relance">
              <Input type="date" value={followUp} onChange={(event) => setFollowUp(event.target.value)} />
            </Field>
          </div>

          <Field label="Notes d'échange">
            <Textarea
              rows={8}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Compte rendu d'appel, objections, prochaines étapes…"
            />
          </Field>

          <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
            <CalendarClock className="size-3.5" />
            Créé le {formatDate(lead.created_at, "long")} · modifié le {formatDate(lead.updated_at, "long")}
          </p>
        </div>
      )}
    </Drawer>
  );
}

function InfoTile({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null | undefined;
  href?: string | null;
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

  if (href && value) {
    return (
      <a
        href={href}
        target={href.startsWith("http") ? "_blank" : undefined}
        rel="noreferrer"
        className={`${className} hover:border-[var(--border-strong)] hover:text-brand-300`}
      >
        {body}
      </a>
    );
  }
  return <div className={className}>{body}</div>;
}
