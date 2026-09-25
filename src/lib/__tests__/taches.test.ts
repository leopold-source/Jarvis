/** `npx tsx src/lib/__tests__/taches.test.ts` — ajout rapide d'une tâche. */
import { lireDate, lireSaisie } from "@/lib/taches-saisie";

let pass = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`);
}

const vendredi = "2026-09-25";
const options = {
  membres: [
    { id: "L", nom: "Léopold Chrétien" },
    { id: "R", nom: "Romain Navet" },
  ],
  categories: ["Webapp AC", "Prospection", "Organisation"],
  aujourdhui: vendredi,
};

check("demain", lireDate("demain", vendredi), "2026-09-26");
check("lundi (prochain)", lireDate("lundi", vendredi), "2026-09-28");
check("vendredi un vendredi = le suivant", lireDate("vendredi", vendredi), "2026-10-02");
check("12/10", lireDate("12/10", vendredi), "2026-10-12");
check("date passée sans année = an prochain", lireDate("3/2", vendredi), "2027-02-03");
check("mot ordinaire", lireDate("Idra", vendredi), null);

check("ligne complète", lireSaisie("Relancer Idra @romain #prospection demain !", options), {
  titre: "Relancer Idra",
  assignees: ["R"],
  categorie: "Prospection",
  due_on: "2026-09-26",
  prio: true,
});
check("catégorie en plusieurs mots", lireSaisie("Favicon #webappac", options).categorie, "Webapp AC");
check("catégorie nouvelle", lireSaisie("Compta #finance", options).categorie, "Finance");
check("@tous", lireSaisie("Point hebdo @tous", options).assignees, ["L", "R"]);
check("@inconnu reste dans le titre", lireSaisie("Appeler @Paul", options).titre, "Appeler @Paul");
check("accents ignorés", lireSaisie("Mail @leo", options).assignees, ["L"]);
check("une seule date retenue", lireSaisie("Réunion lundi demain", options), {
  titre: "Réunion demain",
  assignees: [],
  categorie: null,
  due_on: "2026-09-28",
  prio: false,
});

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
