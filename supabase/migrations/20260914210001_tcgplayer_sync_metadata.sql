alter table public.tcg_pricing add column if not exists provider text not null default 'manual';
alter table public.tcg_pricing add column if not exists provider_version text;
alter table public.tcg_pricing add column if not exists source_product_id text;
alter table public.tcg_pricing add column if not exists source_category_id integer;
alter table public.tcg_pricing add column if not exists source_group_id integer;
alter table public.tcg_pricing add column if not exists source_condition text;
alter table public.tcg_pricing add column if not exists fetched_at timestamptz;
alter table public.tcg_pricing add column if not exists effective_at timestamptz;
alter table public.tcg_pricing add column if not exists freshness_status text not null default 'UNKNOWN' check (freshness_status in ('CURRENT','AGING','STALE','UNKNOWN','UNAVAILABLE'));
alter table public.tcg_pricing_history add column if not exists sync_id uuid;

create table if not exists public.tcg_sync_runs (
  sync_id uuid primary key,
  client_id text not null references public.tcg_clients(id),
  provider text not null,
  provider_version text,
  started_at timestamptz not null,
  completed_at timestamptz,
  requested_window text not null default 'weekly',
  status text not null check (status in ('RUNNING','READY_TO_PUBLISH','PUBLISHED','PARTIAL','FAILED','NOT_CONFIGURED')),
  categories_attempted integer not null default 0,
  categories_succeeded integer not null default 0,
  categories_failed integer not null default 0,
  products_seen integer not null default 0,
  prices_seen integer not null default 0,
  prices_changed integer not null default 0,
  prices_rejected integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.tcg_sync_categories (
  sync_id uuid not null references public.tcg_sync_runs(sync_id) on delete cascade,
  category_id integer not null,
  category_name text not null,
  status text not null check (status in ('DISCOVERED','AUTHORIZED','SYNCED','PARTIAL','FAILED','UNAVAILABLE')),
  groups_seen integer not null default 0,
  products_seen integer not null default 0,
  prices_seen integer not null default 0,
  current_count integer not null default 0,
  stale_count integer not null default 0,
  failed_count integer not null default 0,
  error text,
  primary key (sync_id, category_id)
);
create index if not exists tcg_sync_runs_client_started_idx on public.tcg_sync_runs (client_id, started_at desc);
create index if not exists tcg_pricing_provider_product_idx on public.tcg_pricing (provider, source_product_id);

alter table public.tcg_sync_runs enable row level security;
alter table public.tcg_sync_categories enable row level security;
drop policy if exists tcg_admin_sync_runs on public.tcg_sync_runs;
create policy tcg_admin_sync_runs on public.tcg_sync_runs for select using (public.tcg_is_admin(client_id));
drop policy if exists tcg_admin_sync_categories on public.tcg_sync_categories;
create policy tcg_admin_sync_categories on public.tcg_sync_categories for select using (exists (select 1 from public.tcg_sync_runs r where r.sync_id = tcg_sync_categories.sync_id and public.tcg_is_admin(r.client_id)));
grant select on public.tcg_sync_runs, public.tcg_sync_categories to authenticated;
