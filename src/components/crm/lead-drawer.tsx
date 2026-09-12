"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, BriefcaseBusiness, Building2, CalendarClock, Globe, Hash, Linkedin, Mail, MapPin, Phone, Rocket, Users, Users2 } from "lucide-react";

import { Badge, Button, Drawer, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { DateField } from "@/components/ui/date-field";
import { LEAD_STATUS, LEAD_STATUS_ORDER } from "@/lib/constants";
import type { LeadListe, LeadStatus } from "@/lib/database.types";
import { cn, formatDate, formatMoney, formatRelative } from "@/lib/utils";
import type { OrgLink } from "@/lib/lead-orgs";
import { updateLead } from "@/app/(crm)/leads/actions";

export function LeadDrawer({
  lead,
  org,
  onOpenLead,
  onClose,
  onSaved,
  onConvert,
}: {
  lead: LeadListe | null;
  org?: OrgLink;
  onOpenLead?: (lead: LeadListe) => void;
  onClose: () => void;
  onSaved: () => void;
  onConvert: (lead: LeadListe, dealName: string, amount: number | null) => Promise<void>;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<LeadStatus>("a_contacter");
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
    toast("LeadListe mis à jour.");
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
      title={lead.full_name ?? "LeadListe sans nom"}
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

          {org ? <OrgBanner org={org} onOpenLead={onOpenLead} /> : null}

          <div className="grid grid-cols-2 gap-3">
            {/* Sur une demi-largeur de téléphone, une adresse professionnelle
                est coupée au milieu du domaine — et la fiche est justement
                l'endroit où l'on vient la lire. Elle prend donc la ligne. */}
            <InfoTile
              icon={Mail}
              label="E-mail"
              value={lead.email}
              href={lead.email ? `mailto:${lead.email}` : null}
              className="col-span-2 sm:col-span-1"
            />
            <InfoTile icon={Phone} label="Téléphone" value={lead.phone} href={lead.phone ? `tel:${lead.phone.replace(/\s/g, "")}` : null} />
            <InfoTile icon={BriefcaseBusiness} label="Poste" value={lead.job_title} />
            <InfoTile
              icon={Phone}
              label="Standard"
              value={lead.phone_standard}
              href={lead.phone_standard ? `tel:${lead.phone_standard.replace(/\s/g, "")}` : null}
            />
            <InfoTile icon={Building2} label="Entreprise" value={lead.company_name} />
            <InfoTile icon={MapPin} label="Région" value={lead.region} />
            <InfoTile
              icon={Users}
              label="Effectif"
              value={lead.headcount ? String(lead.headcount) : lead.headcount_range}
            />
            {/* Le SIRET n'est pas décoratif : c'est lui qui créera la fiche
                client chez Pennylane le jour où l'affaire se gagne. */}
            <InfoTile icon={Hash} label="SIRET" value={lead.siret ?? lead.siren} />
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
              <DateField
                value={followUp || null}
                onChange={(value) => setFollowUp(value ?? "")}
                placeholder="Planifier une relance"
                className="w-full"
              />
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

          {/* Le suivi d'activité répond à la question qu'on se pose vraiment
              avant de décrocher : « ça fait combien de temps ? » */}
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 p-3">
            <div>
              <p className="text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
                Dernier statut
              </p>
              <p className="mt-0.5 text-[12.5px]">
                {lead.status_changed_at ? formatRelative(lead.status_changed_at) : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
                Dernier contact
              </p>
              <p className="mt-0.5 text-[12.5px]">
                {lead.last_touched_at ? formatRelative(lead.last_touched_at) : "jamais"}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
                Tentatives
              </p>
              <p className="mt-0.5 text-[12.5px] tabular-nums">{lead.touch_count ?? 0}</p>
            </div>
          </div>

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
  className: extra,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null | undefined;
  href?: string | null;
  className?: string;
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

  const className = cn(
    "block rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 px-3 py-2 transition-colors",
    extra,
  );

  if (href && value) {
    return (
      <a
        href={href}
        target={href.startsWith("http") ? "_blank" : undefined}
        rel="noreferrer"
        className={cn(className, "hover:border-[var(--border-strong)] hover:text-brand-300")}
      >
        {body}
      </a>
    );
  }
  return <div className={className}>{body}</div>;
}

/**
 * Qui d'autre, chez cette organisation, est déjà dans la base.
 *
 * Le bandeau ne bloque pas l'appel et ne le déconseille pas : deux agences
 * d'un même groupe ont deux dirigeants, et les appeler tous les deux est
 * légitime. Il rend seulement impossible de le faire sans le savoir — et
 * affiche donc ce dont la décision a besoin : qui, quel statut, quand.
 */
function OrgBanner({ org, onOpenLead }: { org: OrgLink; onOpenLead?: (lead: LeadListe) => void }) {
  const alerte = org.recent !== null;

  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        alerte
          ? "border-amber-500/30 bg-amber-500/10"
          : "border-[var(--border-subtle)] bg-[var(--surface-base)]/50",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 text-[12.5px] font-medium",
          alerte ? "text-amber-700 dark:text-amber-300" : "text-[var(--text-secondary)]",
        )}
      >
        {alerte ? <AlertTriangle className="size-3.5" /> : <Users2 className="size-3.5" />}
        {alerte
          ? `${org.recent?.full_name ?? "Un contact"} a été travaillé il y a ${org.daysSince} j chez la même organisation`
          : `${org.siblings.length + 1} contacts rattachés à la même organisation`}
      </p>

      <ul className="mt-2.5 space-y-1">
        {org.siblings.map((sibling) => (
          <li key={sibling.id}>
            <button
              type="button"
              onClick={() => onOpenLead?.(sibling)}
              className="group flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">
                  {sibling.full_name ?? "Sans nom"}
                </span>
                <span className="block truncate text-[11px] text-[var(--text-muted)]">
                  {sibling.company_name ?? "—"} · {formatRelative(sibling.last_touched_at ?? sibling.status_changed_at)}
                </span>
              </span>
              <Badge tone={LEAD_STATUS[sibling.status].tone}>{LEAD_STATUS[sibling.status].label}</Badge>
              <ArrowRight className="size-3.5 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-1.5 px-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Rien ne vous empêche d&apos;appeler : deux entités d&apos;un même groupe ont deux
        décideurs. C&apos;est de le faire sans le savoir qui coûte cher.
      </p>
    </div>
  );
}
