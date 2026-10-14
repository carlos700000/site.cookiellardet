-- ============================================================
--  Cookillardet — base de données Supabase
--  À coller EN ENTIER dans Supabase > SQL Editor > New query > Run
--  (peut être relancé sans risque : rien n'est effacé)
-- ============================================================

-- ── Admins : seuls les comptes listés ici peuvent publier ──────
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

drop policy if exists "admin lit la liste" on public.admins;
create policy "admin lit la liste" on public.admins
  for select using (user_id = auth.uid());

-- ── Avis ──────────────────────────────────────────────────────
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  num         integer not null,                       -- n° du cookie (1, 2, 3…)
  title       text not null check (char_length(title) between 1 and 120),
  place       text check (char_length(place) <= 200), -- adresse / lieu
  rating      numeric(3,2) check (rating >= 0 and rating <= 5),
  body        text not null default '' check (char_length(body) <= 5000),
  photo_url   text,
  tasted_on   date,
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists reviews_num_idx on public.reviews (num desc);

-- Un avis = une enseigne. `rating` / `body` = note et avis global de l'enseigne,
-- `cookies` = les cookies testés là-bas : [{ photo_url, name, rating, body }, …].
-- `photo_url` reste la photo de couverture (= photo du 1er cookie).
alter table public.reviews add column if not exists cookies jsonb not null default '[]'::jsonb;
alter table public.reviews drop constraint if exists reviews_cookies_array;
alter table public.reviews add constraint reviews_cookies_array check (jsonb_typeof(cookies) = 'array');
alter table public.reviews enable row level security;

drop policy if exists "tout le monde lit les avis publiés" on public.reviews;
drop policy if exists "admin crée"     on public.reviews;
drop policy if exists "admin modifie"  on public.reviews;
drop policy if exists "admin supprime" on public.reviews;
create policy "tout le monde lit les avis publiés" on public.reviews
  for select using (published or public.is_admin());
create policy "admin crée"     on public.reviews for insert with check (public.is_admin());
create policy "admin modifie"  on public.reviews for update using (public.is_admin());
create policy "admin supprime" on public.reviews for delete using (public.is_admin());

-- ── Commentaires des visiteurs ────────────────────────────────
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews (id) on delete cascade,
  pseudo      text not null check (char_length(btrim(pseudo)) between 1 and 40),
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists comments_review_idx on public.comments (review_id, created_at);
alter table public.comments enable row level security;

drop policy if exists "tout le monde lit les commentaires" on public.comments;
drop policy if exists "tout le monde commente" on public.comments;
drop policy if exists "admin modère" on public.comments;
create policy "tout le monde lit les commentaires" on public.comments
  for select using (true);
-- n'importe qui peut commenter, mais seulement un avis publié
create policy "tout le monde commente" on public.comments
  for insert with check (
    exists (select 1 from public.reviews r where r.id = review_id and r.published)
  );
create policy "admin modère" on public.comments for delete using (public.is_admin());

-- ── Stockage des photos (bucket public : lisible par tous) ────
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "admin envoie des photos" on storage.objects;
drop policy if exists "admin supprime des photos" on storage.objects;
create policy "admin envoie des photos" on storage.objects
  for insert with check (bucket_id = 'photos' and public.is_admin());
create policy "admin supprime des photos" on storage.objects
  for delete using (bucket_id = 'photos' and public.is_admin());

-- ── Anciennes photos supprimées de « Photos à trier » ────────
create table if not exists public.photos_masquees (
  url        text primary key,
  created_at timestamptz not null default now()
);
alter table public.photos_masquees enable row level security;
drop policy if exists "admin gère les photos masquées" on public.photos_masquees;
create policy "admin gère les photos masquées" on public.photos_masquees
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
--  ÉTAPE SUIVANTE, dans une NOUVELLE requête (pas ici) :
--  après avoir créé le compte de ton pote (Authentication > Users > Add user),
--  remplace l'email puis exécute :
--
--  insert into public.admins (user_id)
--  select id from auth.users where email = 'email.de.ton.pote@exemple.fr';
-- ============================================================
