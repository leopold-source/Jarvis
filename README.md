# Antichaos

CRM et pilotage de projets pour Antichaos : prospection, pipeline commercial,
projets clients et portail client, dans une seule application.

- **Front** : Next.js 16 (App Router, React 19), Tailwind CSS v4, TypeScript.
- **Base de données & auth** : Supabase (Postgres 17, RLS, Storage).
- **Hébergement** : Vercel.

---

## Le parcours, de bout en bout

```
Lead  ──« call pris »──▶  Entreprise + Contact + Affaire
                                              │
                                     Kanban (9 étapes)
                                              │
                                        ──« gagné »──▶  Projet
                                                          │
                                              Jalons · Tâches · Documents
                                                          │
                                                   Portail client
```

1. **Leads** — la base de prospection amont (194 lignes importées depuis
   l'export CSV existant). Rien n'y est encore « client » : ce sont des gens à
   appeler.
2. **Conversion** — quand un lead accepte un rendez-vous, un clic crée d'un
   coup l'entreprise, le contact et l'affaire. La logique vit dans la fonction
   SQL `convert_lead_to_deal`, ce qui la rend atomique et rejouable.
3. **Affaires** — un Kanban en glisser-déposer, avec les neuf étapes du
   processus : demande de RDV envoyée (par défaut), R1, R2, propale envoyée,
   no show, nurturing, gagné, perdu, non qualifié.
4. **Projet** — dès qu'une affaire passe en « gagné », un trigger Postgres crée
   le projet correspondant, et l'application l'amorce avec un plan de démarrage
   (jalons + tâches de production).
5. **Portail client** — le client se connecte et suit son projet : avancement,
   jalons, documents partagés, fil d'échange.

## Tâches et jalons

Une tâche a une `nature` :

- **Jalon** (`jalon`) — un moment clé : kick-off, cadrage validé, livraison.
  Partagé avec le client par défaut, il sert de repère dans la timeline.
- **Production** (`production`) — le travail au quotidien. Rattachable à un
  jalon (`milestone_id`), ce qui découpe le projet en phases.

L'avancement affiché (`project_progress`) est calculé sur les seules tâches de
production terminées : les jalons mesurent les étapes, pas la charge.

Chaque tâche, document et commentaire porte un drapeau `is_client_visible` :
c'est lui, et lui seul, qui décide de ce qui remonte dans le portail client.

## Rôles

| Rôle | Accès |
| --- | --- |
| `admin` | Tout, y compris les suppressions et la gestion des utilisateurs. |
| `member` | Tout le CRM et les projets ; pas de suppression, pas de gestion d'accès. |
| `client` | Lecture seule des projets de **son** entreprise, limitée à ce qui a été partagé. Peut écrire dans le fil d'échange. |

Ces règles ne sont pas seulement appliquées dans l'interface : elles sont
inscrites dans les politiques RLS de Postgres. Un client qui forgerait une
requête ne verrait rien de plus.

---

## Mise en route

```bash
npm install
cp .env.example .env.local   # puis renseigner les valeurs
npm run dev
```

### Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé publique (publishable). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Serveur uniquement.** Nécessaire pour envoyer les invitations depuis « Équipe & accès ». |
| `ANTHROPIC_API_KEY` | **Serveur uniquement.** Active le nettoyage des imports CSV par Claude. |

La clé `service_role` ne doit jamais être préfixée `NEXT_PUBLIC_` : elle
contourne la RLS.

### Base de données

Les migrations sont dans `supabase/migrations/`, dans l'ordre :

| Fichier | Contenu |
| --- | --- |
| `…000001_init_core.sql` | Types, `profiles`, helpers RLS, création du profil à l'inscription. |
| `…000002_crm.sql` | `companies`, `contacts`, `leads`, `deals`. |
| `…000003_projects.sql` | `projects`, `tasks`, `documents`, `comments`, `activities`, socle e-mails. |
| `…000004_rls.sql` | Toutes les politiques RLS. |
| `…000005_rpc_views_storage.sql` | `convert_lead_to_deal`, vue `project_progress`, bucket `documents`. |
| `…000006_harden.sql` | Surface RPC minimale, extensions hors du schéma public, colonne `segment`. |
| `…000007_import_affaires_formation_ia.sql` | Reprise des affaires « Formation IA » depuis l'export CSV du pipeline. |

Avec la CLI Supabase :

```bash
supabase link --project-ref <ref>
supabase db push
```

### Importer des leads

Deux chemins, au choix :

- **Depuis l'application** — page Leads → « Importer » (administrateurs). Le CSV
  est analysé dans le navigateur, avec un aperçu avant insertion.
- **En ligne de commande** :

  ```bash
  SUPABASE_URL=… SUPABASE_KEY=… python3 scripts/import-leads.py export.csv
  ```

Colonnes reconnues : `Name`, `Prénom`, `Nom`, `E-mail`, `Tél`, `Entreprise`,
`Statut`, `Région`, `Relance`, `Valeur CA`, `Site entreprise`, `Url LinkedIn`,
`Commentaire`, `Activité`, `Secteur`, `Adresse`, `Owner`, `fullname`.

#### Anti-doublon

Avant toute écriture, chaque ligne est confrontée à l'existant — leads,
contacts, entreprises et affaires — sur trois clés tolérantes aux accents, à la
casse et aux formes juridiques : l'e-mail, le couple nom + entreprise, et le nom
d'entreprise seul.

| Verdict | Couleur | Comportement |
| --- | --- | --- |
| Doublon | rose | Même e-mail, ou même personne dans la même entreprise. La ligne est **ignorée**. |
| Entreprise connue | **vert** | L'entreprise a déjà un lead ou une affaire, mais cette personne est nouvelle. La ligne est **importée** et signalée : c'est un second interlocuteur chez un compte déjà travaillé. |
| Nouveau | neutre | Rien de connu. |

Les doublons internes au fichier sont attrapés au passage. Le contrôle est
rejoué côté serveur au moment de l'insertion : entre l'aperçu et la validation,
un autre import a pu passer.

#### Nettoyage par l'IA

Le bouton « Nettoyer » de la fenêtre d'import envoie les lignes à Claude
(`claude-opus-5`) pour normaliser la forme des données : région ramenée à l'une
des treize régions françaises et déduite du code postal quand elle manque
(« IDF » → « Île-de-France », « 44100 Nantes » → « Pays de la Loire »),
téléphones au format `+33 6 …`, casse des entreprises, sites préfixés `https://`.

La consigne est stricte : corriger la forme, jamais inventer le fond. Un champ
absent le reste, et le modèle ne peut pas vider un champ déjà rempli — le code
n'applique que les valeurs non nulles. Chaque correction est listée dans
l'aperçu avant validation. Un champ de consigne libre permet d'ajouter une règle
ponctuelle pour un fichier donné.

> À noter : dans l'export d'origine, la colonne `fullname` ne contient pas un
> nom mais le libellé de campagne (« 2026-03 - DG / Bureau d'ingénierie /
> Normandie / 20-99 »). Elle est donc importée dans `segment`, et le nom est lu
> depuis `Name`.

---

## Déploiement sur Vercel

1. Importer le dépôt dans Vercel (le framework est détecté automatiquement).
2. Renseigner les variables d'environnement ci-dessus. Les deux `NEXT_PUBLIC_*`
   doivent être de type **Config** (elles finissent dans le bundle navigateur) ;
   les deux autres de type **Secret**.
3. Dans Supabase → Authentication → URL Configuration, ajouter l'URL de
   production comme **Site URL**, et `https://<domaine>/auth/callback` dans les
   **Redirect URLs** (ainsi que l'URL de préproduction si nécessaire).

## Structure

```
src/
  app/
    (crm)/            Espace interne : tableau de bord, leads, affaires,
                      contacts, entreprises, projets, équipe
    portail/          Espace client (lecture seule + fil d'échange)
    connexion/        Authentification (mot de passe ou lien magique)
    auth/callback/    Échange du code de session
  components/
    ui/               Bibliothèque de composants (boutons, cartes, modales…)
    layout/           Barre latérale, en-têtes, thème
    crm/ projects/ portal/
  lib/
    supabase/         Clients navigateur, serveur et proxy
    constants.ts      Libellés et couleurs des énumérations métier
    database.types.ts Typage du schéma
```

## Synchronisation Gmail (V2)

Le socle est déjà en base : `email_messages` (rattachable à une affaire, un
projet ou un contact) et `google_accounts` (jetons OAuth, protégés par une RLS
stricte qui n'autorise que le propriétaire).

Reste à faire, dans l'ordre : créer un client OAuth Google (scope
`gmail.readonly`), stocker le `refresh_token` à l'issue du consentement, puis
une fonction planifiée qui interroge l'API Gmail et rattache chaque message à
l'affaire dont l'adresse du contact correspond. C'est faisable — le point
délicat n'est pas la synchronisation elle-même mais l'association fiable d'un
fil de discussion à la bonne affaire quand plusieurs personnes sont en copie.
