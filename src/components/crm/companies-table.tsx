"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, ExternalLink, Globe, MapPin } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  Field,
  Input,
  SearchInput,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { DEAL_STAGE, PROJECT_STATUS } from "@/lib/constants";
import type { Company, DealStage, ProjectStatus } from "@/lib/database.types";
import { formatMoney, normalize } from "@/lib/utils";
import { updateCompany } from "@/app/(crm)/contacts/actions";

type ContactLite = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  company_id: string | null;
};
type DealLite = { id: string; name: string; stage: DealStage; amount: number | null; company_id: string | null };
type ProjectLite = { id: string; name: string; status: ProjectStatus; company_id: string | null };

export function CompaniesTable({
  companies,
  contacts,
  deals,
  projects,
}: {
  companies: Company[];
  contacts: ContactLite[];
  deals: DealLite[];
  projects: ProjectLite[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("toutes");
  const [selected, setSelected] = useState<Company | null>(null);

  useEffect(() => {
    const id = params.get("entreprise");
    if (!id) return;
    const match = companies.find((company) => company.id === id);
    if (match) setSelected(match);
  }, [params, companies]);

  const regions = useMemo(
    () => [...new Set(companies.map((company) => company.region).filter(Boolean))].sort() as string[],
    [companies],
  );

  const byCompany = useMemo(() => {
    const map = new Map<
      string,
      { contacts: ContactLite[]; deals: DealLite[]; projects: ProjectLite[] }
    >();
    const ensure = (id: string) =>
      map.get(id) ?? map.set(id, { contacts: [], deals: [], projects: [] }).get(id)!;

    for (const contact of contacts) if (contact.company_id) ensure(contact.company_id).contacts.push(contact);
    for (const deal of deals) if (deal.company_id) ensure(deal.company_id).deals.push(deal);
    for (const project of projects) if (project.company_id) ensure(project.company_id).projects.push(project);
    return map;
  }, [contacts, deals, projects]);

  const filtered = useMemo(() => {
    const needle = normalize(search.trim());
    return companies.filter((company) => {
      if (region !== "toutes" && company.region !== region) return false;
      if (!needle) return true;
      return normalize(
        [company.name, company.sector, company.activity, company.website].filter(Boolean).join(" "),
      ).includes(needle);
    });
  }, [companies, search, region]);

  const detail = selected ? byCompany.get(selected.id) : undefined;

  return (
    <>
      <Card className="flex flex-wrap items-center gap-2.5 p-3.5">
        <SearchInput value={search} onChange={setSearch} placeholder="Raison sociale, secteur…" className="min-w-56 flex-1" />
        {regions.length > 0 ? (
          <Select
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            className="w-auto min-w-40"
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
        <span className="ml-auto text-[12.5px] text-[var(--text-muted)]">
          {filtered.length} entreprise{filtered.length > 1 ? "s" : ""}
        </span>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="size-5" />}
            title="Aucune entreprise"
            description="Les comptes sont créés automatiquement lors de la conversion d'un lead."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((company, index) => {
            const stats = byCompany.get(company.id);
            return (
              <Card
                key={company.id}
                interactive
                onClick={() => setSelected(company)}
                style={{ ["--i" as string]: index % 30 }}
                className="stagger cursor-pointer p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium">{company.name}</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-[var(--text-muted)]">
                      {company.activity ?? company.sector ?? "—"}
                    </p>
                  </div>
                  {company.revenue ? <Badge tone="cyan">{formatMoney(company.revenue, true)}</Badge> : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
                  {company.region ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" />
                      {company.region}
                    </span>
                  ) : null}
                  {company.website ? (
                    <span className="inline-flex items-center gap-1 truncate">
                      <Globe className="size-3" />
                      {company.website.replace(/^https?:\/\/(www\.)?/, "")}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 flex gap-1.5">
                  <Badge tone="stone">{stats?.contacts.length ?? 0} contact(s)</Badge>
                  <Badge tone="indigo">{stats?.deals.length ?? 0} affaire(s)</Badge>
                  {(stats?.projects.length ?? 0) > 0 ? (
                    <Badge tone="emerald">{stats!.projects.length} projet(s)</Badge>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CompanyDrawer
        company={selected}
        detail={detail}
        onClose={() => setSelected(null)}
        onSaved={() => startTransition(() => router.refresh())}
      />
    </>
  );
}

function CompanyDrawer({
  company,
  detail,
  onClose,
  onSaved,
}: {
  company: Company | null;
  detail?: { contacts: ContactLite[]; deals: DealLite[]; projects: ProjectLite[] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    website: "",
    sector: "",
    activity: "",
    region: "",
    address: "",
    headcount: "",
    revenue: "",
    notes: "",
  });

  useEffect(() => {
    if (!company) return;
    setForm({
      name: company.name,
      website: company.website ?? "",
      sector: company.sector ?? "",
      activity: company.activity ?? "",
      region: company.region ?? "",
      address: company.address ?? "",
      headcount: company.headcount ?? "",
      revenue: company.revenue != null ? String(company.revenue) : "",
      notes: company.notes ?? "",
    });
  }, [company]);

  if (!company) return null;

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!company) return;
    setSaving(true);
    const parsed = form.revenue ? Number(form.revenue.replace(",", ".")) : null;
    const result = await updateCompany(company.id, {
      name: form.name.trim() || company.name,
      website: form.website || null,
      sector: form.sector || null,
      activity: form.activity || null,
      region: form.region || null,
      address: form.address || null,
      headcount: form.headcount || null,
      revenue: Number.isFinite(parsed!) ? parsed : null,
      notes: form.notes || null,
    });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Entreprise mise à jour.");
    onSaved();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={company.name}
      subtitle={company.activity ?? company.sector ?? undefined}
      footer={
        <>
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
        {detail && detail.projects.length > 0 ? (
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-[var(--text-secondary)]">Projets</p>
            <ul className="space-y-1.5">
              {detail.projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/projets/${project.id}`}
                    className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border-subtle)] px-3 py-2 text-[13px] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]/50"
                  >
                    <span className="truncate">{project.name}</span>
                    <Badge tone={PROJECT_STATUS[project.status].tone}>
                      {PROJECT_STATUS[project.status].label}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {detail && detail.deals.length > 0 ? (
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-[var(--text-secondary)]">Affaires</p>
            <ul className="space-y-1.5">
              {detail.deals.map((deal) => (
                <li key={deal.id}>
                  <Link
                    href={`/affaires?affaire=${deal.id}`}
                    className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border-subtle)] px-3 py-2 text-[13px] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]/50"
                  >
                    <span className="truncate">{deal.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {deal.amount ? (
                        <span className="text-[11.5px] tabular-nums text-[var(--text-muted)]">
                          {formatMoney(deal.amount, true)}
                        </span>
                      ) : null}
                      <Badge tone={DEAL_STAGE[deal.stage].tone}>{DEAL_STAGE[deal.stage].short}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {detail && detail.contacts.length > 0 ? (
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-[var(--text-secondary)]">Contacts</p>
            <ul className="space-y-1.5">
              {detail.contacts.map((contact) => (
                <li key={contact.id}>
                  <Link
                    href={`/contacts?contact=${contact.id}`}
                    className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border-subtle)] px-3 py-2 text-[13px] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{contact.full_name || "Sans nom"}</span>
                      <span className="block truncate text-[11px] text-[var(--text-muted)]">
                        {contact.email ?? contact.phone ?? "—"}
                      </span>
                    </span>
                    <ExternalLink className="size-3.5 shrink-0 text-[var(--text-muted)]" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Raison sociale" className="sm:col-span-2">
            <Input value={form.name} onChange={(event) => set("name", event.target.value)} />
          </Field>
          <Field label="Site web">
            <Input value={form.website} onChange={(event) => set("website", event.target.value)} />
          </Field>
          <Field label="Secteur">
            <Input value={form.sector} onChange={(event) => set("sector", event.target.value)} />
          </Field>
          <Field label="Activité" className="sm:col-span-2">
            <Input value={form.activity} onChange={(event) => set("activity", event.target.value)} />
          </Field>
          <Field label="Région">
            <Input value={form.region} onChange={(event) => set("region", event.target.value)} />
          </Field>
          <Field label="Effectif">
            <Input value={form.headcount} onChange={(event) => set("headcount", event.target.value)} placeholder="10-99" />
          </Field>
          <Field label="Chiffre d'affaires (€)">
            <Input inputMode="decimal" value={form.revenue} onChange={(event) => set("revenue", event.target.value)} />
          </Field>
          <Field label="Adresse" className="sm:col-span-2">
            <Input value={form.address} onChange={(event) => set("address", event.target.value)} />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea rows={5} value={form.notes} onChange={(event) => set("notes", event.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}
