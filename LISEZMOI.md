# Cookillardet : mise en ligne

Le site est fait de pages statiques (HTML/CSS/JS, rien à installer) et d'une base de données gratuite **Supabase** qui stocke les avis, les photos et les commentaires.

```
site/
├── index.html            ← le site public (avis + commentaires)
├── admin.html            ← l'espace auteur (lien discret en bas du site)
├── css/                  ← styles
├── js/config.js          ← LE SEUL fichier à remplir
├── js/anciens-avis.js    ← les 46 anciens avis récupérés
├── photos/anciennes/     ← les 97 photos du PDF (001.jpg → 097.jpg)
└── supabase/schema.sql   ← à coller dans Supabase
```

Tant que `config.js` est vide, le site tourne en **mode aperçu** : les anciens avis s'affichent, les commentaires sont désactivés, et l'espace auteur est en mode démo (rien n'est enregistré).

---

## 1. Créer la base Supabase (≈ 5 min)

1. Créer un compte sur <https://supabase.com>, puis **New project** (région : Paris / `eu-west-3`). Garder le mot de passe de la base quelque part.
2. Menu **SQL Editor** → **New query** → coller tout le contenu de `supabase/schema.sql` → **Run**.

## 2. Brancher le site

1. Menu **Project Settings → API** : copier **Project URL** et la clé **anon public**.
2. Les coller dans `js/config.js` :

```js
window.COOKILLARDET_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi..."
};
```

La clé « anon » est faite pour être publique. **Ne jamais mettre la clé `service_role`.**

## 3. Créer le compte de l'auteur

1. Menu **Authentication → Users → Add user → Create new user** : email + mot de passe du pote (cocher *Auto Confirm User*).
2. Menu **Authentication → Sign In / Providers** : **désactiver « Allow new users to sign up »** (personne d'autre ne pourra créer de compte).
3. Dans **SQL Editor**, exécuter (avec le bon email) :

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'email.du.pote@exemple.fr';
```

## 4. Mettre en ligne (gratuit)

Avec **GitHub Pages** :

1. Sur <https://github.com/new> : nom du dépôt `cookillardet`, **Public**, cocher *Add a README file* → **Create repository**.
2. Dans le dépôt : **Add file → Upload files**. GitHub accepte 100 fichiers par envoi, donc en deux fois :
   - **Envoi 1** : ouvrir le dossier `site`, sélectionner tout **sauf** le dossier `photos`, glisser dans la page → **Commit changes**.
   - **Envoi 2** : **Add file → Upload files** à nouveau, glisser le dossier `photos` → **Commit changes**.
   - Vérifier que `index.html` est bien à la racine du dépôt (pas dans un sous-dossier `site/`).
3. **Settings → Pages** : *Source* = **Deploy from a branch**, *Branch* = **main** / **(root)** → **Save**.
4. Après 1 à 2 minutes, le site est en ligne sur `https://<ton-pseudo>.github.io/cookillardet/` (adresse affichée en haut de *Settings → Pages*).

Pour une mise à jour du code : **Add file → Upload files** avec le fichier modifié (il remplace l'ancien). **Les avis et commentaires ne sont pas touchés** : ils vivent dans Supabase.

`config.js` sera visible publiquement dans le dépôt : c'est normal, la clé « anon / publishable » est faite pour ça.

## 5. Premier lancement

1. Aller sur `https://ton-site/admin.html`, se connecter.
2. Cliquer **« Importer les 46 anciens avis »** (une seule fois).
3. Onglet **Photos à trier** : 81 anciennes photos n'ont pas pu être associées automatiquement à un avis. Toucher une photo → choisir l'avis correspondant (ou créer un nouvel avis avec).

---

## Mise à jour : plusieurs cookies par enseigne

Chaque avis est maintenant une **enseigne** : une note globale + un avis sur l'enseigne, et la liste des **cookies goûtés**, chacun avec sa photo, sa note et son avis. Le site affiche le nombre d'enseignes testées et de cookies goûtés.

Pour l'activer sur une base déjà en place : **SQL Editor → New query** → recoller tout `supabase/schema.sql` → **Run** (rien n'est effacé, ça ajoute juste la colonne `cookies`). Les anciens avis continuent de s'afficher tels quels : leur photo compte comme un cookie goûté.

---

## Utilisation au quotidien (pour le pote)

Sur le téléphone, ouvrir `admin.html` (l'ajouter à l'écran d'accueil) → **+ Nouvelle enseigne** :

- nom de l'enseigne, lieu, **note globale** avec le curseur (ou « Pas de note »), avis sur l'enseigne ;
- pour chaque cookie goûté : **📷 Photo** (appareil photo ou galerie, réduite automatiquement avant l'envoi), nom du cookie, note et avis ; **＋ Ajouter un cookie** pour en mettre plusieurs ;
- **Publier l'avis**. C'est en ligne.

Tout se modifie ensuite via **Modifier** (texte, note, photo, brouillon/visible, suppression). L'onglet **Commentaires** permet de supprimer ceux qui dépassent les bornes.

## Notes

- **Notes ramenées sur 5** : les avis n°16 (« 3,5/10 ») et n°46 (« 4,5/10 ») ont été mis à 3,5/5 et 4,5/5 : à corriger si c'était vraiment sur 10.
- Les avis n°11 à 14 et 51 à 73 n'avaient pas de texte : ils ne sont pas importés, leurs photos sont dans « Photos à trier ».
- Les textes ont été légèrement corrigés (orthographe, ponctuation) sans changer le fond.
- Commentaires : n'importe qui peut commenter avec un pseudo (anti-robot basique + 15 s entre deux messages). Si un jour il y a du spam, on pourra ajouter une modération avant publication.
- Gratuit : Supabase (500 Mo de base, 1 Go de photos) et Netlify suffisent largement. Un projet Supabase gratuit **se met en pause après 7 jours sans aucune visite** ; il suffit de le relancer depuis le tableau de bord.
