/**
 * Les notes de rendez-vous : ce qui s'insère dedans, et ce qu'on en lit.
 *
 * Pur, pour être éprouvé sans navigateur ni base. L'éditeur écrit du HTML ; le
 * modèle, lui, lit du texte — des titres, des tirets, des cases — que
 * `htmlEnTexte` reconstitue sans dépendance.
 */

function echapper(texte: string): string {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Les trames proposées sur une note vide : le squelette d'une prise de notes. */
export const TRAMES = {
  r1: ["Contexte", "Besoins et irritants", "Outils actuels", "Décideurs et budget", "Calendrier", "Prochaines étapes"],
  r2: ["Retour sur la proposition", "Objections", "Périmètre validé", "Budget", "Planning", "Prochaines étapes"],
} as const;

export function trameHtml(quelle: keyof typeof TRAMES): string {
  return TRAMES[quelle].map((titre) => `<h3>${echapper(titre)}</h3><ul><li><p></p></li></ul>`).join("");
}

/**
 * Un résumé Claap — du texte avec des tirets — en HTML pour l'éditeur.
 * Les lignes à tiret deviennent une liste, les autres des paragraphes.
 */
export function resumeEnHtml(titre: string, resume: string): string {
  const parties: string[] = [`<h3>${echapper(titre)}</h3>`];
  let liste: string[] = [];
  const vider = () => {
    if (liste.length) parties.push(`<ul>${liste.map((l) => `<li><p>${echapper(l)}</p></li>`).join("")}</ul>`);
    liste = [];
  };
  for (const brute of resume.replace(/\r\n/g, "\n").split("\n")) {
    const ligne = brute.trim();
    if (/^[-•*]\s+/.test(ligne)) {
      liste.push(ligne.replace(/^[-•*]\s+/, ""));
      continue;
    }
    vider();
    if (!ligne) continue;
    // « ## Points clés » ou « Points clés : » : un intertitre du résumé.
    const intertitre = /^#{1,6}\s+(.*)$/.exec(ligne)?.[1];
    parties.push(intertitre ? `<p><strong>${echapper(intertitre)}</strong></p>` : `<p>${echapper(ligne)}</p>`);
  }
  vider();
  return parties.join("");
}

const ENTITES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Le texte d'une note, pour un modèle ou un aperçu : titres, tirets, cases. */
export function htmlEnTexte(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<h[1-6][^>]*>/gi, "\n\n## ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*data-checked="true"[^>]*>/gi, "\n- [x] ")
    .replace(/<li[^>]*data-checked="false"[^>]*>/gi, "\n- [ ] ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITES[e] ?? e)
    .replace(/(- (?:\[[ x]\] )?)\n+(?!## |- |\n)/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n+(?=- )/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Vrai si la note ne contient que des titres ou des puces vides. */
export function noteVide(html: string | null | undefined): boolean {
  return htmlEnTexte(html).replace(/^## .*$/gm, "").replace(/^-( \[[ x]\])?\s*$/gm, "").trim() === "";
}
