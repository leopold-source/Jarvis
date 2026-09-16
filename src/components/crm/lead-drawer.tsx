"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, BriefcaseBusiness, Building2, CalendarClock, Globe, Hash, Linkedin, Loader2, Mail, MapPin, Pencil, Phone, Rocket, Users, Users2, X } from "lucide-react";

import { Badge, Button, Drawer, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { DateField } from "@/components/ui/date-field";
import { LEAD_STATUS, LEAD_STATUS_ORDER, NRP_MAX } from "@/lib/constants";
import type { Lead, LeadListe, LeadModifiable, LeadStatus } from "@/lib/database.types";
import { CHAMPS, nomAffiche, patchFiche, SECTIONS, texteDe } from "@/lib/lead-fiche";
import { cn, formatDate, formatDateHeure, formatMoney, formatRelative } from "@/lib/utils";
import type { OrgLink } from "@/lib/lead-orgs";
import { fetchLead, incrementerNrp, updateLead } from "@/app/(crm)/leads/actions";

type MemberLite = { id: string; full_name: string | null; email: string; role: string };

export function LeadDrawer({
  lead,
  org,
  members,
  onOpenLead,
  onClose,
  onSaved,
  onConvert,
}: {
  lead: LeadListe | null;
  org?: OrgLink;
  members: MemberLite[];
  onOpenLead?: (lead: LeadListe) => void;
  onClose: () => void;
  onSaved: () => void;
  onConvert: (lead: LeadListe, dealName: string, amount: number | null) => Promise<void>;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<LeadStatus>("a_contacter");
  const [comment, setComment] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [owner, setOwner] = useState("");
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [dealName, setDealName] = useState("");
  const [amount, setAmount] = useState("");
  // Le compteur vit en local le temps du tiroir : l'incrément doit se voir
  // avant que la liste derrière ne soit rechargée.
  const [nrp, setNrp] = useState(0);
  const [comptant, setComptant] = useState(false);

  /*
    La fiche complète, et non celle que la liste transporte.

    L'écran des leads ne charge qu'une vingtaine de colonnes — les envoyer
    toutes pour 432 lignes coûtait 233 ko à chaque ouverture. La raison sociale,
    le secteur, l'adresse ou la description n'y sont donc pas, et on ne modifie
    pas ce qu'on n'a pas reçu. Une ligne, cherchée à l'ouverture du tiroir, ne
    coûte rien et rend la fiche entière.
  */
  const [fiche, setFiche] = useState<Lead | null>(null);
  const [chargement, setChargement] = useState(false);
  const [edition, setEdition] = useState(false);
  const [brouillon, setBrouillon] = useState<Record<string, string>>({});

  const leadId = lead?.id ?? null;

  /**
   * Recopie une fiche dans le formulaire.
   *
   * `suivi` décide du sort des quatre champs que la liste transporte déjà —
   * statut, relance, notes, propriétaire. Au premier chargement ils sont
   * remplis avant la requête, et les réécrire à son retour effacerait ce qui
   * aurait été tapé entre-temps : deux cents millisecondes suffisent à perdre
   * le début d'un compte rendu d'appel.
   */
  const remplirBrouillon = useCallback((complet: Lead, { suivi = true } = {}) => {
    const valeurs: Record<string, string> = {};
    for (const champ of CHAMPS) valeurs[champ.cle] = texteDe(complet, champ.cle);
    setBrouillon(valeurs);
    setNrp(complet.nrp_count ?? 0);
    if (!suivi) return;
    setStatus(complet.status);
    setComment(complet.comment ?? "");
    setFollowUp(complet.follow_up_on ?? "");
    setOwner(complet.owner_id ?? "");
  }, []);

  useEffect(() => {
    if (!lead) return;
    // D'abord ce que la liste sait déjà : le tiroir s'ouvre rempli, la requête
    // ne fait que compléter. Attendre le réseau pour afficher un nom qu'on a
    // sous la main donnerait un tiroir vide un quart de seconde.
    setStatus(lead.status);
    setNrp(lead.nrp_count ?? 0);
    setComment(lead.comment ?? "");
    setFollowUp(lead.follow_up_on ?? "");
    setOwner(lead.owner_id ?? "");
    setDealName(lead.company_name ?? lead.full_name ?? "Nouvelle affaire");
    setAmount("");
    setConverting(false);
    setEdition(false);
    setFiche(null);
    setBrouillon({});
    /*
      Sur l'identifiant, pas sur l'objet.

      La liste se recharge après chaque enregistrement, et un lead ouvert par
      un lien — `?lead=…` — est alors réattribué depuis les données fraîches :
      même fiche, nouvel objet. Dépendre de l'objet remettrait le tiroir à zéro
      à ce moment-là, en plein milieu d'une saisie. L'identifiant ne change que
      lorsqu'on ouvre vraiment une autre fiche.
    */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => {
    if (!leadId) return;
    let vivant = true;
    setChargement(true);
    void fetchLead(leadId).then((resultat) => {
      if (!vivant) return;
      setChargement(false);
      if (!resultat.ok) return toast(resultat.error, "error");
      setFiche(resultat.data!);
      remplirBrouillon(resultat.data!, { suivi: false });
    });
    return () => {
      vivant = false;
    };
    // `toast` est stable, `remplirBrouillon` aussi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  function majBrouillon(cle: string, valeur: string) {
    setBrouillon((etat) => {
      const suivant = { ...etat, [cle]: valeur };
      if (cle !== "first_name" && cle !== "last_name") return suivant;

      // Le nom affiché suit le prénom et le nom tant qu'il n'a pas divergé.
      const nom = nomAffiche(etat, suivant);
      return nom === null ? suivant : { ...suivant, full_name: nom };
    });
  }

  if (!lead) return null;

  // La fiche complète prime dès qu'elle est là : après un enregistrement,
  // c'est elle qui porte les valeurs justes, la liste derrière ayant une
  // seconde de retard.
  const vue: LeadListe = fiche ?? lead;
  const alreadyConverted = Boolean(vue.converted_deal_id);
  const statutsOffrables = LEAD_STATUS_ORDER.filter(
    (value) => value !== "call_pris" || alreadyConverted,
  );

  async function save() {
    if (!lead) return;
    if (!fiche) return toast("La fiche n'est pas encore chargée.", "error");

    const resultat = patchFiche(fiche, brouillon);
    if ("erreur" in resultat) return toast(resultat.erreur, "error");

    // Les quatre champs de suivi ont leur propre contrôle et ne passent pas
    // par le brouillon : ils se comparent ici.
    const champs: Partial<LeadModifiable> = { ...resultat.patch };
    if (status !== fiche.status) champs.status = status;
    if ((comment || null) !== fiche.comment) champs.comment = comment || null;
    if ((followUp || null) !== fiche.follow_up_on) champs.follow_up_on = followUp || null;
    if ((owner || null) !== fiche.owner_id) champs.owner_id = owner || null;

    if (Object.keys(champs).length === 0) {
      setEdition(false);
      return toast("Rien n'a changé.");
    }

    setSaving(true);
    const result = await updateLead(lead.id, champs);
    setSaving(false);
    if (!result.ok) return toast(result.error, "error");

    /*
      On relit la fiche plutôt que de recoller le patch par-dessus l'ancienne.

      Un déclencheur décide de `status_changed_at`, `last_touched_at`,
      `touch_count` et `nrp_count` : un changement de statut en modifie quatre
      que le formulaire n'a pas envoyées. Les recalculer ici reviendrait à
      réécrire la règle une seconde fois, du mauvais côté — et à la voir
      diverger le jour où elle change. Une ligne relue coûte moins que cela.
    */
    const frais = await fetchLead(lead.id);
    if (frais.ok) {
      setFiche(frais.data!);
      remplirBrouillon(frais.data!);
    }
    setEdition(false);
    toast("Fiche enregistrée.");
    onSaved();
  }

  async function convert() {
    if (!lead) return;
    setSaving(true);
    const parsed = amount ? Number(amount.replace(",", ".")) : null;
    await onConvert(lead, dealName.trim() || vue.company_name || "Nouvelle affaire", Number.isFinite(parsed!) ? parsed : null);
    setSaving(false);
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={vue.full_name ?? "Lead sans nom"}
      subtitle={vue.company_name ?? undefined}
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
        ) : edition ? (
          <>
            {/* Abandonner doit repartir de la base, pas du brouillon : sans
                cela, « Annuler » garderait à l'écran ce qu'on vient de renier. */}
            <Button
              variant="ghost"
              onClick={() => {
                if (fiche) remplirBrouillon(fiche);
                setEdition(false);
              }}
            >
              <X className="size-4" />
              Annuler
            </Button>
            <Button variant="primary" loading={saving} disabled={!fiche} onClick={save}>
              Enregistrer
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
              <li>• L&apos;entreprise « {vue.company_name ?? "—"} » (réutilisée si elle existe déjà)</li>
              <li>• Le contact « {vue.full_name ?? "—"} », rattaché à cette entreprise</li>
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
              Ce lead a été converti le {formatDate(vue.converted_at, "long")}. L&apos;affaire est disponible
              dans le pipeline.
            </div>
          ) : null}

          {org ? <OrgBanner org={org} onOpenLead={onOpenLead} /> : null}

          {/* Le suivi reste au même endroit dans les deux modes : c'est le
              geste quotidien, et le déplacer obligerait à le rechercher. */}
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Statut">
              <span className="flex items-center gap-2">
                <Select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as LeadStatus)}
                  className="flex-1"
                >
                  {statutsOffrables.map((value) => (
                    <option key={value} value={value}>
                      {value === "nrp" && nrp > 0 ? `${LEAD_STATUS[value].label} ${nrp}` : LEAD_STATUS[value].label}
                    </option>
                  ))}
                </Select>

                {/* Le même geste que dans la liste : un appel de plus sans
                    réponse se note en un clic, pas en rouvrant une liste. */}
                {status === "nrp" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={comptant}
                    disabled={nrp >= NRP_MAX}
                    onClick={async () => {
                      setComptant(true);
                      const resultat = await incrementerNrp(lead!.id);
                      setComptant(false);
                      if (!resultat.ok) return toast(resultat.error, "error");
                      setNrp(resultat.data!.nrp_count);
                      onSaved();
                    }}
                    title={nrp >= NRP_MAX ? `Compteur au maximum (${NRP_MAX})` : "Un appel sans réponse de plus"}
                  >
                    +1
                  </Button>
                ) : null}
              </span>
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

          {edition ? (
            <FormulaireComplet
              brouillon={brouillon}
              onChange={majBrouillon}
              owner={owner}
              onOwner={setOwner}
              members={members}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[12.5px] font-medium text-[var(--text-secondary)]">
                  Coordonnées
                </h3>
                {/* Tant qu'on lit, les tuiles restent des liens : un numéro se
                    compose d'un doigt, et un champ de saisie ne compose rien. */}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!fiche}
                  onClick={() => setEdition(true)}
                  title={fiche ? "Modifier tous les champs" : "Chargement de la fiche…"}
                >
                  {chargement ? <Loader2 className="size-3.5 animate-spin" /> : <Pencil className="size-3.5" />}
                  Modifier
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Sur une demi-largeur de téléphone, une adresse professionnelle
                    est coupée au milieu du domaine — et la fiche est justement
                    l'endroit où l'on vient la lire. Elle prend donc la ligne. */}
                <InfoTile
                  icon={Mail}
                  label="E-mail"
                  value={vue.email}
                  href={vue.email ? `mailto:${vue.email}` : null}
                  className="col-span-2 sm:col-span-1"
                />
                <InfoTile icon={Phone} label="Téléphone" value={vue.phone} href={vue.phone ? `tel:${vue.phone.replace(/\s/g, "")}` : null} />
                <InfoTile icon={BriefcaseBusiness} label="Poste" value={vue.job_title} />
                <InfoTile
                  icon={Phone}
                  label="Standard"
                  value={vue.phone_standard}
                  href={vue.phone_standard ? `tel:${vue.phone_standard.replace(/\s/g, "")}` : null}
                />
                <InfoTile icon={Building2} label="Entreprise" value={vue.company_name} />
                <InfoTile icon={MapPin} label="Région" value={vue.region} />
                <InfoTile
                  icon={Users}
                  label="Effectif"
                  value={vue.headcount ? String(vue.headcount) : vue.headcount_range}
                />
                {/* Le SIRET n'est pas décoratif : c'est lui qui créera la fiche
                    client chez Pennylane le jour où l'affaire se gagne. */}
                <InfoTile icon={Hash} label="SIRET" value={vue.siret ?? vue.siren} />
                <InfoTile
                  icon={Globe}
                  label="Site web"
                  value={vue.company_website}
                  href={vue.company_website}
                />
                <InfoTile icon={Linkedin} label="LinkedIn" value={vue.linkedin_url ? "Profil" : null} href={vue.linkedin_url} />
              </div>

              <div className="flex flex-wrap gap-2">
                {vue.revenue ? <Badge tone="cyan">CA {formatMoney(vue.revenue, true)}</Badge> : null}
                {vue.company_activity ? <Badge tone="indigo">{vue.company_activity}</Badge> : null}
                {vue.segment ? <Badge tone="stone">{vue.segment}</Badge> : null}
                {vue.owner_name ? <Badge tone="violet">Owner · {vue.owner_name}</Badge> : null}
              </div>
            </>
          )}

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
                {vue.status_changed_at ? formatRelative(vue.status_changed_at) : "—"}
              </p>
              {/* La date exacte sous la formule relative : « il y a 12 jours »
                  situe, mais ne permet pas de recouper avec un agenda. */}
              {vue.status_changed_at ? (
                <p className="text-[11px] text-[var(--text-muted)] tabular-nums">
                  {formatDateHeure(vue.status_changed_at, { avecAnnee: true })}
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
                Dernier contact
              </p>
              <p className="mt-0.5 text-[12.5px]">
                {vue.last_touched_at ? formatRelative(vue.last_touched_at) : "jamais"}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
                Tentatives
              </p>
              <p className="mt-0.5 text-[12.5px] tabular-nums">{vue.touch_count ?? 0}</p>
            </div>
          </div>

          <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
            <CalendarClock className="size-3.5" />
            Créé le {formatDate(vue.created_at, "long")} · modifié le {formatDate(vue.updated_at, "long")}
          </p>
        </div>
      )}
    </Drawer>
  );
}

/**
 * Tous les champs de la fiche, ouverts à la saisie.
 *
 * Y compris ceux que la liste ne transporte pas — raison sociale, secteur,
 * adresse, description, années. Ils existaient en base depuis l'import et
 * n'avaient aucun endroit où être corrigés : une coquille dans un SIREN
 * imposait d'ouvrir Supabase.
 */
function FormulaireComplet({
  brouillon,
  onChange,
  owner,
  onOwner,
  members,
}: {
  brouillon: Record<string, string>;
  onChange: (cle: string, valeur: string) => void;
  owner: string;
  onOwner: (valeur: string) => void;
  members: MemberLite[];
}) {
  return (
    <div className="space-y-5">
      {/* Le propriétaire est le seul champ qui ne se tape pas : il se choisit
          dans l'équipe, et son nom d'affichage suit côté serveur. */}
      <Field label="Propriétaire" className="sm:max-w-xs">
        <Select value={owner} onChange={(event) => onOwner(event.target.value)}>
          <option value="">Non assigné</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.full_name ?? member.email}
            </option>
          ))}
        </Select>
      </Field>

      {SECTIONS.map((section) => (
        <section key={section.titre}>
          <h3 className="mb-2.5 text-[12.5px] font-medium text-[var(--text-secondary)]">
            {section.titre}
          </h3>
          <div className="grid gap-3.5 sm:grid-cols-2">
            {section.champs.map((champ) => (
              <Field
                key={champ.cle}
                label={champ.label}
                hint={champ.hint}
                className={champ.large ? "sm:col-span-2" : undefined}
              >
                {champ.lignes ? (
                  <Textarea
                    rows={champ.lignes}
                    value={brouillon[champ.cle] ?? ""}
                    onChange={(event) => onChange(champ.cle, event.target.value)}
                    placeholder={champ.placeholder}
                  />
                ) : (
                  <Input
                    type={champ.type === "number" ? "text" : (champ.type ?? "text")}
                    /* `type="number"` refuse les espaces des effectifs collés
                       depuis un export et masque la valeur au lieu de la
                       corriger. Le clavier numérique suffit à aider la saisie. */
                    inputMode={champ.type === "number" ? "numeric" : undefined}
                    value={brouillon[champ.cle] ?? ""}
                    onChange={(event) => onChange(champ.cle, event.target.value)}
                    placeholder={champ.placeholder}
                  />
                )}
              </Field>
            ))}
          </div>
        </section>
      ))}
    </div>
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
