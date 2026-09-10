import type { Lead } from "@/lib/database.types";

/**
 * Rattacher les leads qui désignent la même organisation — ou la même personne.
 *
 * Le nom d'entreprise ne suffit pas : « Auddice Seine Normandie » et « Auddice
 * Environnement » sont deux raisons sociales pour un même groupe. La base
 * calcule donc deux clés (`org_key`, domaine ; `phone_key`, les neuf derniers
 * chiffres) et ce module les fusionne : deux leads sont liés dès qu'ils
 * partagent l'une des deux.
 *
 * Ce qui suit ne fusionne rien et ne masque rien. Appeler deux dirigeants d'un
 * même groupe est parfois exactement ce qu'il faut faire ; ce qu'on veut
 * empêcher, c'est de le faire sans le savoir.
 */

/** Au-delà, un numéro est un standard ou une saisie par défaut, pas une personne. */
const MAX_PARTAGE_TELEPHONE = 4;

export type OrgLink = {
  /** Les autres leads rattachés à la même organisation. */
  siblings: Lead[];
  /** Le plus récemment travaillé d'entre eux, s'il l'a été dans la fenêtre. */
  recent: Lead | null;
  /** Jours écoulés depuis ce dernier contact. */
  daysSince: number | null;
};

function touchedAt(lead: Lead): string {
  return lead.last_touched_at ?? lead.status_changed_at;
}

function daysBetween(iso: string, now: number): number {
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

/**
 * Regroupe les leads par organisation, puis calcule pour chacun ce qu'il faut
 * savoir avant de décrocher : qui d'autre est rattaché, et quand on lui a parlé.
 */
export function buildOrgIndex(
  leads: Lead[],
  cooldownDays: number,
  now: number = Date.now(),
): Map<string, OrgLink> {
  // Un numéro partagé par toute une liste ne dit plus rien de personne.
  const phoneCount = new Map<string, number>();
  for (const lead of leads) {
    if (lead.phone_key) phoneCount.set(lead.phone_key, (phoneCount.get(lead.phone_key) ?? 0) + 1);
  }

  // Union-find : un lead porte jusqu'à deux clés, et deux leads se rejoignent
  // dès qu'ils en partagent une. C'est ce qui relie un dirigeant présent dans
  // deux sociétés — entreprises différentes, même ligne.
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const seen = parent.get(key);
    if (seen === undefined || seen === key) return key;
    const root = find(seen);
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  const keysOf = (lead: Lead): string[] => {
    const keys: string[] = [];
    if (lead.org_key) keys.push(`org:${lead.org_key}`);
    if (lead.phone_key && (phoneCount.get(lead.phone_key) ?? 0) <= MAX_PARTAGE_TELEPHONE) {
      keys.push(`tel:${lead.phone_key}`);
    }
    return keys;
  };

  for (const lead of leads) {
    const keys = keysOf(lead);
    for (const key of keys) {
      if (!parent.has(key)) parent.set(key, key);
    }
    for (let i = 1; i < keys.length; i += 1) union(keys[0], keys[i]);
  }

  const groups = new Map<string, Lead[]>();
  for (const lead of leads) {
    const keys = keysOf(lead);
    if (keys.length === 0) continue;
    const root = find(keys[0]);
    const list = groups.get(root) ?? [];
    list.push(lead);
    groups.set(root, list);
  }

  const index = new Map<string, OrgLink>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (const lead of members) {
      const siblings = members.filter((other) => other.id !== lead.id);

      // Le voisin travaillé le plus récemment : c'est lui qui peut faire de
      // cet appel un doublon.
      let recent: Lead | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (const sibling of siblings) {
        const days = daysBetween(touchedAt(sibling), now);
        if (days < best) {
          best = days;
          recent = sibling;
        }
      }

      const within = recent !== null && best <= cooldownDays;
      index.set(lead.id, {
        siblings,
        recent: within ? recent : null,
        daysSince: recent === null ? null : best,
      });
    }
  }

  return index;
}

/**
 * Éloigne les leads d'une même organisation dans la file d'appel.
 *
 * L'ordre de prospection reste celui qui a été calculé ; on se contente de
 * repousser un lead dont l'organisation vient d'être appelée quelques rangs
 * plus loin. Deux fiches du même groupe ne se suivent donc jamais, et le lead
 * repoussé n'est pas perdu pour autant.
 */
export function spreadByOrg(ordered: Lead[], index: Map<string, OrgLink>): Lead[] {
  // L'identité d'un groupe : les identifiants de ses membres, triés. Calculée
  // une fois — la recomposer à chaque comparaison coûterait plus cher que le
  // problème qu'elle règle.
  const groupOf = new Map<string, string>();
  for (const lead of ordered) {
    const link = index.get(lead.id);
    if (!link) continue;
    groupOf.set(
      lead.id,
      [lead.id, ...link.siblings.map((sibling) => sibling.id)].sort().join("|"),
    );
  }

  const remaining = [...ordered];
  const out: Lead[] = [];
  let lastGroup: string | undefined;

  while (remaining.length > 0) {
    let pick = 0;
    // Le prochain appartient au groupe qu'on vient d'appeler : on prend le
    // suivant qui n'en est pas, et celui-ci attend un rang. S'il n'y a rien
    // d'autre à appeler, il passe quand même — mieux vaut un enchaînement
    // visible qu'une file vide.
    if (lastGroup !== undefined && groupOf.get(remaining[0].id) === lastGroup) {
      const alt = remaining.findIndex((lead) => groupOf.get(lead.id) !== lastGroup);
      if (alt > 0) pick = alt;
    }
    const [lead] = remaining.splice(pick, 1);
    out.push(lead);
    lastGroup = groupOf.get(lead.id);
  }

  return out;
}
