/**
 * L'ajout rapide d'une tâche : une ligne, comme on l'écrirait dans le Sheet.
 *
 * « Relancer Idra @Romain #Prospection demain ! » donne la tâche « Relancer
 * Idra », assignée à Romain, dans Prospection, pour demain, prioritaire. Ce qui
 * n'est pas reconnu reste dans le titre : rien ne disparaît en silence.
 */

export type Membre = { id: string; nom: string };

export type TacheSaisie = {
  titre: string;
  assignees: string[];
  categorie: string | null;
  due_on: string | null;
  prio: boolean;
};

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function sansAccents(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function decaler(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Un mot de date — « demain », « lundi », « 12/10 » — en jour `AAAA-MM-JJ`. */
export function lireDate(mot: string, aujourdhui: string): string | null {
  const m = sansAccents(mot);
  if (m === "aujourd'hui" || m === "aujourdhui" || m === "auj") return aujourdhui;
  if (m === "demain") return decaler(aujourdhui, 1);
  const jour = JOURS.indexOf(m);
  if (jour >= 0) {
    const actuel = new Date(`${aujourdhui}T12:00:00Z`).getUTCDay();
    // Le prochain, jamais aujourd'hui : « lundi » un lundi veut dire le suivant.
    return decaler(aujourdhui, ((jour - actuel + 7) % 7) || 7);
  }
  const date = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(m);
  if (date) {
    const [, j, mo, a] = date;
    let annee = a ? Number(a.length === 2 ? `20${a}` : a) : Number(aujourdhui.slice(0, 4));
    let iso = `${annee}-${mo!.padStart(2, "0")}-${j!.padStart(2, "0")}`;
    // Sans année, une date passée désigne l'an prochain.
    if (!a && iso < aujourdhui) {
      annee += 1;
      iso = `${annee}-${mo!.padStart(2, "0")}-${j!.padStart(2, "0")}`;
    }
    return Number.isNaN(Date.parse(`${iso}T12:00:00Z`)) ? null : iso;
  }
  return null;
}

export function lireSaisie(
  texte: string,
  options: { membres: Membre[]; categories: string[]; aujourdhui: string },
): TacheSaisie {
  const reste: string[] = [];
  const assignees: string[] = [];
  let categorie: string | null = null;
  let due_on: string | null = null;
  let prio = false;

  for (const mot of texte.trim().split(/\s+/).filter(Boolean)) {
    if (mot === "!" || mot === "!!" || /^!prio$/i.test(mot)) {
      prio = true;
      continue;
    }
    if (mot.startsWith("@") && mot.length > 1) {
      const cle = sansAccents(mot.slice(1));
      const membre = options.membres.find((m) => sansAccents(m.nom).split(/\s+/)[0]!.startsWith(cle));
      if (membre) {
        if (!assignees.includes(membre.id)) assignees.push(membre.id);
        continue;
      }
      if (cle === "tous" || cle === "equipe") {
        for (const m of options.membres) if (!assignees.includes(m.id)) assignees.push(m.id);
        continue;
      }
    }
    if (mot.startsWith("#") && mot.length > 1) {
      const brut = mot.slice(1).replace(/_/g, " ");
      categorie =
        options.categories.find((c) => sansAccents(c).replace(/\s+/g, "") === sansAccents(brut).replace(/\s+/g, "")) ??
        options.categories.find((c) => sansAccents(c).startsWith(sansAccents(brut))) ??
        brut.charAt(0).toUpperCase() + brut.slice(1);
      continue;
    }
    const date: string | null = due_on ? null : lireDate(mot, options.aujourdhui);
    if (date) {
      due_on = date;
      continue;
    }
    reste.push(mot);
  }

  return { titre: reste.join(" "), assignees, categorie, due_on, prio };
}
