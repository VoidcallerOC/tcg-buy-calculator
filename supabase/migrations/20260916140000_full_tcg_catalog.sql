create table if not exists public.tcg_games (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_game_id text not null,
  name text not null,
  normalized_name text not null,
  provider_payload jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_game_id)
);
create index if not exists tcg_games_name_idx on public.tcg_games (normalized_name);

create table if not exists public.tcg_sets (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.tcg_games(id) on delete cascade,
  provider_set_id text not null,
  name text not null,
  normalized_name text not null,
  set_code text,
  release_date date,
  provider_payload jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, provider_set_id)
);
create index if not exists tcg_sets_game_name_idx on public.tcg_sets (game_id, normalized_name);
create index if not exists tcg_sets_code_idx on public.tcg_sets (set_code);

create table if not exists public.tcg_catalog_cards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.tcg_games(id) on delete cascade,
  set_id uuid references public.tcg_sets(id) on delete set null,
  provider_card_id text not null,
  provider_card_slug text,
  name text not null,
  normalized_name text not null,
  card_number text not null,
  image_url text,
  rarity text,
  provider_payload jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, provider_card_id)
);
create index if not exists tcg_cards_game_name_idx on public.tcg_catalog_cards (game_id, normalized_name);
create index if not exists tcg_cards_number_idx on public.tcg_catalog_cards (card_number);
create index if not exists tcg_cards_set_idx on public.tcg_catalog_cards (set_id);
create index if not exists tcg_cards_search_idx on public.tcg_catalog_cards using gin (to_tsvector('simple', normalized_name));

create table if not exists public.tcg_card_variants (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.tcg_catalog_cards(id) on delete cascade,
  provider_variant_id text,
  condition text,
  printing text,
  language text,
  provider_payload jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (card_id, provider_variant_id)
);
create index if not exists tcg_variants_card_idx on public.tcg_card_variants (card_id);

create table if not exists public.tcg_catalog_prices (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.tcg_card_variants(id) on delete cascade,
  condition_code text references public.tcg_conditions(code),
  reference_cents bigint check (reference_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  source_name text not null,
  source_updated_at timestamptz,
  fetched_at timestamptz not null default now(),
  active boolean not null default true,
  unique (variant_id, condition_code, source_updated_at)
);
create unique index if not exists tcg_catalog_one_active_price on public.tcg_catalog_prices (variant_id, condition_code) where active;
create index if not exists tcg_catalog_prices_lookup_idx on public.tcg_catalog_prices (condition_code, active, source_updated_at desc);

create table if not exists public.tcg_catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  kind text not null check (kind in ('catalog', 'pricing')),
  status text not null check (status in ('running', 'completed', 'failed')),
  games_processed integer not null default 0,
  sets_processed integer not null default 0,
  cards_processed integer not null default 0,
  variants_processed integer not null default 0,
  pages_processed integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists tcg_catalog_sync_runs_latest_idx on public.tcg_catalog_sync_runs (provider, kind, started_at desc);

alter table public.tcg_games enable row level security;
alter table public.tcg_sets enable row level security;
alter table public.tcg_catalog_cards enable row level security;
alter table public.tcg_card_variants enable row level security;
alter table public.tcg_catalog_prices enable row level security;
alter table public.tcg_catalog_sync_runs enable row level security;

drop policy if exists tcg_public_games on public.tcg_games;
create policy tcg_public_games on public.tcg_games for select using (active);
drop policy if exists tcg_public_sets on public.tcg_sets;
create policy tcg_public_sets on public.tcg_sets for select using (active);
drop policy if exists tcg_public_catalog_cards on public.tcg_catalog_cards;
create policy tcg_public_catalog_cards on public.tcg_catalog_cards for select using (active);
drop policy if exists tcg_public_variants on public.tcg_card_variants;
create policy tcg_public_variants on public.tcg_card_variants for select using (active);
drop policy if exists tcg_public_prices on public.tcg_catalog_prices;
create policy tcg_public_prices on public.tcg_catalog_prices for select using (active);

grant select on public.tcg_games, public.tcg_sets, public.tcg_catalog_cards, public.tcg_card_variants, public.tcg_catalog_prices to anon, authenticated;
grant select on public.tcg_catalog_sync_runs to authenticated;

create or replace function public.tcg_catalog_search(p_game_id uuid, p_query text, p_limit integer default 8)
returns table (id uuid, game_id uuid, name text, card_number text, set_name text, set_code text, image_url text, rarity text)
language sql stable security invoker set search_path = public
as $$
  select c.id, c.game_id, c.name, c.card_number, s.name, s.set_code, c.image_url, c.rarity
  from public.tcg_catalog_cards c left join public.tcg_sets s on s.id = c.set_id
  where c.active and (p_game_id is null or c.game_id = p_game_id)
    and (p_query is null or trim(p_query) = '' or c.normalized_name like '%' || lower(trim(p_query)) || '%' or lower(c.card_number) = lower(trim(p_query)) or lower(coalesce(s.set_code, '')) = lower(trim(p_query)) or lower(coalesce(s.name, '')) like '%' || lower(trim(p_query)) || '%')
  order by case when lower(c.name) = lower(trim(p_query)) then 0 when lower(c.card_number) = lower(trim(p_query)) then 1 else 2 end, c.name
  limit least(greatest(coalesce(p_limit, 8), 1), 20);
$$;
