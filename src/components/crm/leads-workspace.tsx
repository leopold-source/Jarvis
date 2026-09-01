"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Building2,
  ExternalLink,
  Filter,
  Mail,
  Phone,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";

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
  Textarea,
  useToast,
} from "@/components/ui";
import { LEAD_STATUS, LEAD_STATUS_ORDER } from "@/lib/constants";
import type { Lead, LeadStatus } from "@/lib/database.types";
import { cn, daysUntil, formatDate, formatMoney, normalize } from "@/lib/utils";
import { convertLead, createLead, updateLead } from "@/app/(crm)/leads/actions";
import { ImportLeadsDialog } from "@/components/crm/import-leads-dialog";
import { LeadDrawer } from "@/components/crm/lead-drawer";

const PAGE_SIZE = 40;

export function LeadsWorkspace({ leads, isAdmin }: { leads: Lead[]; isAdmin: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LeadStatus | "tous">("tous");
  const [region, setRegion] = useState("toutes");
  const [segment, setSegment] = useState("tous");
  const [onlyFollowUp, setOnlyFollowUp] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const [selected, setSelected] = useState<Lead | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

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

  const filtered = useMemo(() => {
    const needle = normalize(search.trim());
    return leads.filter((lead) => {
      if (status !== "tous" && lead.status !== status) return false;
      if (region !== "toutes" && lead.region !== region) return false;
      if (segment !== "tous" && lead.segment !== segment) return false;
      if (onlyFollowUp && !lead.follow_up_on) return false;
      if (!needle) return true;
      const haystack = normalize(
        [lead.full_name, lead.company_name, lead.email, lead.phone, lead.company_activity]
          .filter(Boolean)
          .join(" "),
      );
      return haystack.includes(needle);
    });
  }, [leads, search, status, region, segment, onlyFollowUp]);

  const page = filtered.slice(0, visible);

  // Toute modification des filtres remet la pagination à zéro.
  useEffect(() => setVisible(PAGE_SIZE), [search, status, region, segment, onlyFollowUp]);

  const counts = useMemo(() => {
    const map = new Map<LeadStatus, number>();
    for (const lead of leads) map.set(lead.status, (map.get(lead.status) ?? 0) + 1);
    return map;
  }, [leads]);

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
    toast(`Statut mis à jour : ${LEAD_STATUS[next].label}`);
    startTransition(() => router.refresh());
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

          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as LeadStatus | "tous")}
            className="w-auto min-w-44"
            aria-label="Filtrer par statut"
          >
            <option value="tous">Tous les statuts ({leads.length})</option>
            {LEAD_STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {LEAD_STATUS[value].label} ({counts.get(value) ?? 0})
              </option>
            ))}
          </Select>

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

          <Button
            variant={onlyFollowUp ? "primary" : "secondary"}
            size="md"
            onClick={() => setOnlyFollowUp((value) => !value)}
          >
            <Filter className="size-3.5" />À relancer
          </Button>

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
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2.5">
          <p className="text-[12.5px] text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text-primary)]">{filtered.length}</span> lead
            {filtered.length > 1 ? "s" : ""}
            {filtered.length !== leads.length ? ` sur ${leads.length}` : ""}
          </p>
        </div>

        {page.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title="Aucun lead ne correspond"
            description="Ajustez les filtres ou ajoutez un nouveau lead."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13.5px]">
              <thead className="text-[11.5px] tracking-wide text-[var(--text-muted)] uppercase">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Entreprise</th>
                  <th className="px-4 py-2.5 font-medium">Statut</th>
                  <th className="px-4 py-2.5 font-medium">Région</th>
                  <th className="px-4 py-2.5 text-right font-medium">CA</th>
                  <th className="px-4 py-2.5 font-medium">Relance</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {page.map((lead, index) => {
                  const remaining = daysUntil(lead.follow_up_on);
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelected(lead)}
                      style={{ ["--i" as string]: index % PAGE_SIZE }}
                      className="stagger cursor-pointer transition-colors hover:bg-[var(--surface-hover)]/60"
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{lead.full_name ?? "Sans nom"}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-[var(--text-muted)]">
                          {lead.email ? (
                            <span className="inline-flex items-center gap-1 truncate">
                              <Mail className="size-3" />
                              {lead.email}
                            </span>
                          ) : null}
                          {lead.phone ? (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <Phone className="size-3" />
                              {lead.phone}
                            </span>
                          ) : null}
                        </p>
                      </td>
                      <td className="max-w-56 px-4 py-2.5">
                        <p className="truncate">{lead.company_name ?? "—"}</p>
                        {lead.company_activity ? (
                          <p className="truncate text-[11.5px] text-[var(--text-muted)]">
                            {lead.company_activity}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5" onClick={(event) => event.stopPropagation()}>
                        <select
                          value={lead.status}
                          onChange={(event) => handleStatusChange(lead, event.target.value as LeadStatus)}
                          aria-label={`Statut de ${lead.full_name ?? "ce lead"}`}
                          className={cn(
                            "cursor-pointer rounded-full border-0 py-0.5 pr-6 pl-2.5 text-[11.5px] font-medium",
                            "ring-1 ring-inset outline-none transition-colors appearance-none",
                            "bg-[image:none]",
                            statusPillClass(lead.status),
                          )}
                        >
                          {LEAD_STATUS_ORDER.map((value) => (
                            <option key={value} value={value} className="bg-[var(--surface-overlay)] text-[var(--text-primary)]">
                              {LEAD_STATUS[value].label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{lead.region ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">
                        {formatMoney(lead.revenue, true)}
                      </td>
                      <td className="px-4 py-2.5">
                        {lead.follow_up_on ? (
                          <Badge tone={remaining != null && remaining < 0 ? "rose" : "amber"}>
                            {formatDate(lead.follow_up_on)}
                          </Badge>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {lead.converted_deal_id ? (
                          <Badge tone="emerald">
                            <ExternalLink className="size-3" />
                            Converti
                          </Badge>
                        ) : (
                          <ArrowRight className="ml-auto size-4 text-[var(--text-muted)]" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {visible < filtered.length ? (
          <div className="flex justify-center border-t border-[var(--border-subtle)] py-3">
            <Button variant="ghost" size="sm" onClick={() => setVisible((value) => value + PAGE_SIZE)}>
              Afficher {Math.min(PAGE_SIZE, filtered.length - visible)} leads de plus
            </Button>
          </div>
        ) : null}
      </Card>

      <LeadDrawer
        lead={selected}
        onClose={() => setSelected(null)}
        onSaved={() => startTransition(() => router.refresh())}
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
          startTransition(() => router.refresh());
        }}
      />

      <ImportLeadsDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(count) => {
          setImporting(false);
          toast(`${count} lead(s) importé(s).`);
          startTransition(() => router.refresh());
        }}
      />
    </>
  );
}

function statusPillClass(status: LeadStatus) {
  const tone = LEAD_STATUS[status].tone;
  const map: Record<string, string> = {
    slate: "bg-slate-500/12 text-slate-600 ring-slate-500/25 dark:text-slate-300",
    sky: "bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300",
    amber: "bg-amber-500/14 text-amber-700 ring-amber-500/25 dark:text-amber-300",
    rose: "bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300",
    emerald: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
    indigo: "bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300",
    violet: "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300",
    cyan: "bg-cyan-500/12 text-cyan-700 ring-cyan-500/25 dark:text-cyan-300",
  };
  return map[tone];
}

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
