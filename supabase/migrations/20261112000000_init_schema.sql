-- perfit initial schema (blueprint "Data model").
-- All lengths: centimetres, FULL circumference. Raw input kept in size_charts.raw_payload for audit/replay.
-- Groups: user-owned (RLS: own rows), catalog (read: signed-in; write: service role only), learning.

-- =====================================================================  catalog

create table public.retailers (
  id               text primary key,                       -- slug: myntra, snitch, ajio, amazon_in, flipkart
  domain           text not null unique,
  adapter_version  text not null default '0',
  created_at       timestamptz not null default now()
);

insert into public.retailers (id, domain) values
  ('myntra', 'myntra.com'),
  ('snitch', 'snitch.com'),
  ('ajio', 'ajio.com'),
  ('amazon_in', 'amazon.in'),
  ('flipkart', 'flipkart.com');

create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- "The Bear House" and "the-bear-house" collapse to the same key.
  name_key    text generated always as (lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g'))) stored unique,
  aliases     text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  retailer_id          text not null references public.retailers(id),
  retailer_product_id  text not null,
  brand_id             uuid references public.brands(id) on delete set null,
  title                text,
  category             text not null check (category in ('shirt', 'tshirt')),
  fit_type             text check (fit_type in ('slim', 'regular', 'relaxed', 'oversized')),
  fit_type_raw         text,
  fabric               text,
  has_stretch          boolean,
  url                  text,
  last_seen_at         timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  unique (retailer_id, retailer_product_id)
);
create index products_brand_id_idx on public.products (brand_id);

create table public.size_charts (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid references public.products(id) on delete cascade,  -- null for brand defaults
  brand_id           uuid references public.brands(id) on delete set null,
  category           text not null check (category in ('shirt', 'tshirt')),
  fit_type           text check (fit_type in ('slim', 'regular', 'relaxed', 'oversized')),
  basis              text not null check (basis in ('body', 'garment', 'unknown')),
  basis_certainty    text not null check (basis_certainty in ('stated', 'inferred', 'unknown')),
  basis_confidence   real not null check (basis_confidence between 0 and 1),
  source             text not null check (source in ('structured_json', 'html_table', 'llm_image', 'brand_default')),
  unit               text not null check (unit in ('in', 'cm')),
  extractor_version  text not null,                         -- engine/adapter version that produced it
  raw_hash           text not null,                         -- sha256 of canonical raw_payload (or image URL)
  raw_payload        jsonb not null,                        -- the RawSizeChart as received; replayable
  quality_flags      text[] not null default '{}',
  created_at         timestamptz not null default now(),
  unique (product_id, raw_hash)
);
create index size_charts_product_newest_idx on public.size_charts (product_id, created_at desc);
create index size_charts_brand_id_idx on public.size_charts (brand_id);

-- One row per size × measurement point (for analytics and brand defaults).
create table public.size_chart_entries (
  chart_id    uuid not null references public.size_charts(id) on delete cascade,
  size_label  text not null,
  size_order  int  not null,
  alt_labels  jsonb not null default '{}',                  -- {"brand": "S"}
  point       text not null check (point in ('chest', 'waist', 'shoulder', 'length', 'sleeve', 'neck')),
  basis       text not null check (basis in ('body', 'garment', 'unknown')),  -- per value: Myntra mixes them
  min_cm      numeric(6, 2) not null,
  max_cm      numeric(6, 2) not null,
  primary key (chart_id, size_label, point),
  check (max_cm >= min_cm)
);

-- =====================================================================  user-owned

create table public.profiles (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  display_name        text,
  unit_pref           text not null default 'in' check (unit_pref in ('in', 'cm')),
  default_fit_pref    text not null default 'regular' check (default_fit_pref in ('snug', 'regular', 'relaxed')),
  feedback_offset_cm  real not null default 0,               -- learned chest-ease offset (engine step 7)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.body_measurements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  version      int  not null,                                -- set by trigger: 1, 2, 3…
  source       text not null check (source in ('manual', 'photo', 'brand_size')),
  height_cm    real check (height_cm between 100 and 250),
  weight_kg    real check (weight_kg between 25 and 300),
  chest_cm     real check (chest_cm between 50 and 200),
  waist_cm     real check (waist_cm between 40 and 200),
  shoulder_cm  real check (shoulder_cm between 25 and 75),
  neck_cm      real check (neck_cm between 20 and 70),
  arm_cm       real check (arm_cm between 30 and 110),
  sigma        jsonb not null default '{}',                  -- uncertainty per point (photo, phase 2)
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (user_id, version)
);
create unique index body_measurements_one_active_idx on public.body_measurements (user_id) where is_active;

create table public.reference_garments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category     text not null check (category in ('shirt', 'tshirt')),
  fit_type     text not null check (fit_type in ('slim', 'regular', 'relaxed', 'oversized')),
  chest_cm     real not null check (chest_cm between 60 and 220),   -- full circumference (pit-to-pit × 2)
  shoulder_cm  real check (shoulder_cm between 25 and 80),
  length_cm    real check (length_cm between 40 and 120),
  sleeve_cm    real check (sleeve_cm between 10 and 100),
  brand_id     uuid references public.brands(id) on delete set null,
  brand_name   text,
  size_label   text,
  verdict      text not null check (verdict in ('perfect', 'slightly_tight', 'slightly_loose')),
  created_at   timestamptz not null default now()
);
create index reference_garments_user_id_idx on public.reference_garments (user_id);
create index reference_garments_brand_id_idx on public.reference_garments (brand_id);

-- "I wear L in H&M regular shirts". brand_name is free text: users cannot write the brands catalog.
create table public.known_sizes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brand_id    uuid references public.brands(id) on delete set null,
  brand_name  text not null,
  category    text not null check (category in ('shirt', 'tshirt')),
  fit_type    text check (fit_type in ('slim', 'regular', 'relaxed', 'oversized')),
  size_label  text not null,
  verdict     text not null default 'perfect' check (verdict in ('perfect', 'slightly_tight', 'slightly_loose')),
  created_at  timestamptz not null default now()
);
create index known_sizes_user_id_idx on public.known_sizes (user_id);
create index known_sizes_brand_id_idx on public.known_sizes (brand_id);

-- =====================================================================  learning

create table public.recommendations (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id           uuid not null references public.products(id) on delete cascade,
  chart_id             uuid not null references public.size_charts(id) on delete cascade,
  measurement_version  int,                                  -- null when the profile came from the client
  engine_version       text not null,
  origin               text not null default 'server' check (origin in ('server', 'client')),
  recommended_size     text not null,
  runner_up_size       text,
  confidence           real not null check (confidence between 0 and 1),
  band                 text not null check (band in ('high', 'medium', 'low')),
  per_point            jsonb not null default '[]',
  profile_snapshot     jsonb not null default '{}',           -- exact FitProfile used, for replay
  shown_at             timestamptz not null default now()
);
create index recommendations_user_id_idx on public.recommendations (user_id, shown_at desc);
create index recommendations_product_id_idx on public.recommendations (product_id);
create index recommendations_chart_id_idx on public.recommendations (chart_id);

create table public.feedback (
  id                 uuid primary key default gen_random_uuid(),
  recommendation_id  uuid references public.recommendations(id) on delete set null,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id         uuid references public.products(id) on delete set null,
  bought_size        text not null,
  overall            text check (overall in ('perfect', 'tight', 'loose', 'returned')),  -- null until "How did it fit?"
  per_point          jsonb not null default '{}',              -- {"chest": "tight", "length": "ok"}
  created_at         timestamptz not null default now()
);
create index feedback_user_id_idx on public.feedback (user_id);
create index feedback_recommendation_id_idx on public.feedback (recommendation_id);
create index feedback_product_id_idx on public.feedback (product_id);

create table public.llm_extractions (
  id              uuid primary key default gen_random_uuid(),
  chart_id        uuid references public.size_charts(id) on delete set null,
  product_id      uuid references public.products(id) on delete set null,
  provider        text not null,
  model           text not null,
  prompt_version  text not null,
  input_hash      text not null,
  output          jsonb,
  status          text not null check (status in ('ok', 'error', 'skipped', 'rejected')),
  error           text,
  latency_ms      int,
  created_at      timestamptz not null default now()
);
create index llm_extractions_chart_id_idx on public.llm_extractions (chart_id);
create index llm_extractions_product_id_idx on public.llm_extractions (product_id);
create index llm_extractions_created_at_idx on public.llm_extractions (created_at);

-- =====================================================================  triggers

create function public.set_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Every edit is a new version; the newest active one wins. Runs as the inserting user (RLS applies).
create function public.body_measurements_versioning() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  select coalesce(max(version), 0) + 1 into new.version
    from public.body_measurements where user_id = new.user_id;
  if new.is_active then
    update public.body_measurements set is_active = false
      where user_id = new.user_id and is_active;
  end if;
  return new;
end $$;

create trigger body_measurements_versioning before insert on public.body_measurements
  for each row execute function public.body_measurements_versioning();

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.body_measurements_versioning() from public, anon, authenticated;

-- =====================================================================  grants + RLS

-- Start from nothing, then grant exactly what each group needs. anon gets no table access:
-- signed-out users go through Edge Functions only.
revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

alter table public.retailers           enable row level security;
alter table public.brands              enable row level security;
alter table public.products            enable row level security;
alter table public.size_charts         enable row level security;
alter table public.size_chart_entries  enable row level security;
alter table public.profiles            enable row level security;
alter table public.body_measurements   enable row level security;
alter table public.reference_garments  enable row level security;
alter table public.known_sizes         enable row level security;
alter table public.recommendations     enable row level security;
alter table public.feedback            enable row level security;
alter table public.llm_extractions     enable row level security;  -- no policies: service role only

-- Catalog: readable by signed-in users, writable only by service role (no write policies).
grant select on public.retailers, public.brands, public.products, public.size_charts, public.size_chart_entries
  to authenticated;
create policy "catalog readable" on public.retailers          for select to authenticated using (true);
create policy "catalog readable" on public.brands             for select to authenticated using (true);
create policy "catalog readable" on public.products           for select to authenticated using (true);
create policy "catalog readable" on public.size_charts        for select to authenticated using (true);
create policy "catalog readable" on public.size_chart_entries for select to authenticated using (true);

-- User tables: own rows only, full CRUD (delete-my-data works row by row; account deletion cascades).
grant select, insert, update, delete on public.profiles, public.body_measurements,
  public.reference_garments, public.known_sizes to authenticated;

create policy "own rows: select" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.profiles for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own rows: select" on public.body_measurements for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.body_measurements for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.body_measurements for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.body_measurements for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own rows: select" on public.reference_garments for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.reference_garments for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.reference_garments for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.reference_garments for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own rows: select" on public.known_sizes for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.known_sizes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.known_sizes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.known_sizes for delete to authenticated using ((select auth.uid()) = user_id);

-- Learning: users insert and read their own rows; feedback can also be completed later (update) or removed.
grant select, insert on public.recommendations to authenticated;
grant select, insert, update, delete on public.feedback to authenticated;

create policy "own rows: select" on public.recommendations for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.recommendations for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "own rows: select" on public.feedback for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.feedback for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.feedback for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.feedback for delete to authenticated using ((select auth.uid()) = user_id);
