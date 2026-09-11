import type { LeadListe } from "@/lib/database.types";

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
  siblings: LeadListe[];
  /** Le plus récemment travaillé d'entre eux, s'il l'a été dans la fenêtre. */
  recent: LeadListe | null;
  /** Jours écoulés depuis ce dernier contact. */
  daysSince: number | null;
};

function touchedAt(lead: LeadListe): string {
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
  leads: LeadListe[],
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

  const keysOf = (lead: LeadListe): string[] => {
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

  const groups = new Map<string, LeadListe[]>();
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
      let recent: LeadListe | null = null;
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
 * L'identité d'un groupe : les identifiants de ses membres, triés.
 *
 * Stable d'un rendu à l'autre et indépendante de celui qu'on affiche, ce qui
 * en fait la clé sous laquelle retenir la rotation. Nulle pour un lead seul —
 * un groupe d'un n'en est pas un.
 */
export function groupIdOf(lead: LeadListe, index: Map<string, OrgLink>): string | null {
  const link = index.get(lead.id);
  if (!link) return null;
  return [lead.id, ...link.siblings.map((sibling) => sibling.id)].sort().join("|");
}

export type FileEntry = {
  /** Le lead à appeler, celui qui occupe la ligne. */
  lead: LeadListe;
  /** La clé du groupe, ou null si la fiche est seule. */
  groupId: string | null;
  /**
   * Les appelables du groupe, dans l'ordre où la rotation les propose. Un seul
   * élément — le lead lui-même — quand il n'y a personne d'autre à proposer.
   */
  candidats: LeadListe[];
};

/**
 * Une ligne par organisation, et de quoi changer d'interlocuteur.
 *
 * Montrer les trois dirigeants d'une même boîte dans la file d'appel était une
 * mauvaise idée honnêtement signalée : la pastille disait bien « contacté il y
 * a 10 jours chez la même organisation », mais il fallait la lire, la
 * comprendre, et décider — trois fois par groupe, en descendant une liste de
 * deux cents lignes. Ce n'est pas une décision qu'on veut prendre deux cents
 * fois par jour.
 *
 * La file n'affiche donc qu'un interlocuteur par organisation. Les autres ne
 * sont pas perdus : ils sont derrière le bouton de rotation, qui fait défiler
 * les membres du groupe sur la même ligne et revient au premier. Le choix par
 * défaut va à celui qui a un portable — un numéro direct décroche, un standard
 * filtre — puis, à égalité, à celui que la file avait déjà placé en tête.
 *
 * `rotation` compte les clics par groupe. Le modulo fait le cercle, et comme
 * l'ordre des candidats ne dépend pas de la rotation, revenir au point de
 * départ ramène exactement la fiche du début.
 */
export function collapseByOrg(
  queue: LeadListe[],
  index: Map<string, OrgLink>,
  rotation: Map<string, number> = new Map(),
): FileEntry[] {
  const parGroupe = new Map<string, LeadListe[]>();
  // L'ordre de sortie est celui de la file : un groupe prend le rang de son
  // premier membre, sinon collapser reviendrait à reclasser.
  const sortie: Array<{ groupId: string | null; lead: LeadListe }> = [];

  for (const lead of queue) {
    const groupId = groupIdOf(lead, index);
    if (groupId === null) {
      sortie.push({ groupId: null, lead });
      continue;
    }
    const membres = parGroupe.get(groupId);
    if (membres) {
      membres.push(lead);
      continue;
    }
    parGroupe.set(groupId, [lead]);
    sortie.push({ groupId, lead });
  }

  return sortie.map(({ groupId, lead }) => {
    if (groupId === null) return { lead, groupId, candidats: [lead] };

    // Le portable d'abord ; à défaut, l'ordre de la file, qui porte déjà le
    // retard des relances. `sort` étant stable, il suffit de ne comparer que
    // sur ce critère pour que le reste de l'ordre survive.
    const candidats = [...(parGroupe.get(groupId) ?? [lead])].sort(
      (a, b) => Number(Boolean(b.phone)) - Number(Boolean(a.phone)),
    );

    const tours = rotation.get(groupId) ?? 0;
    const choisi = candidats[((tours % candidats.length) + candidats.length) % candidats.length];
    return { lead: choisi, groupId, candidats };
  });
}
