create extension if not exists pgcrypto;

create table if not exists public.tcg_clients (
  id text primary key,
  business_name text not null,
  logo_text text not null,
  primary_color text not null,
  secondary_color text not null,
  buy_rate_basis_points integer not null check (buy_rate_basis_points between 0 and 10000),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  disclaimer text not null,
  contact text not null default '',
  data_status text not null,
  stale_threshold_days integer not null default 7 check (stale_threshold_days between 1 and 365),
  allow_stale_pricing boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tcg_conditions (
  code text primary key,
  name text not null unique,
  sort_order integer not null default 0
);

create table if not exists public.tcg_cards (
  id text primary key,
  name text not null,
  card_number text not null,
  set_code text not null,
  set_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (set_code, card_number)
);

create table if not exists public.tcg_pricing (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.tcg_clients(id),
  card_id text not null references public.tcg_cards(id),
  condition_code text not null references public.tcg_conditions(code),
  reference_cents bigint not null check (reference_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  source_name text not null,
  source_updated_at date not null,
  actor_id uuid references auth.users(id),
  imported_at timestamptz not null default now(),
  active boolean not null default true,
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, card_id, condition_code, source_updated_at)
);
create unique index if not exists tcg_one_active_price_per_client_card_condition
  on public.tcg_pricing (client_id, card_id, condition_code) where active;
create index if not exists tcg_pricing_lookup_idx
  on public.tcg_pricing (client_id, card_id, condition_code, active);

create table if not exists public.tcg_pricing_history (
  id uuid primary key default gen_random_uuid(),
  pricing_id uuid references public.tcg_pricing(id),
  client_id text not null references public.tcg_clients(id),
  card_id text not null references public.tcg_cards(id),
  condition_code text not null references public.tcg_conditions(code),
  previous_reference_cents bigint,
  new_reference_cents bigint not null check (new_reference_cents >= 0),
  source_name text not null,
  source_updated_at date not null,
  actor_id uuid references auth.users(id),
  imported_at timestamptz not null default now()
);
create index if not exists tcg_pricing_history_lookup_idx
  on public.tcg_pricing_history (client_id, card_id, condition_code, imported_at desc);

create table if not exists public.tcg_client_admins (
  client_id text not null references public.tcg_clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'owner')),
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);

create table if not exists public.tcg_imports (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.tcg_clients(id),
  actor_id uuid references auth.users(id),
  status text not null check (status in ('published', 'rejected', 'failed')),
  total_count integer not null default 0,
  imported_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  rejected_count integer not null default 0,
  conflict_count integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.tcg_conditions (code, name, sort_order) values
  ('NM', 'Near Mint', 1), ('LP', 'Lightly Played', 2), ('MP', 'Moderately Played', 3),
  ('HP', 'Heavily Played', 4), ('DMG', 'Damaged', 5)
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into public.tcg_clients (id, business_name, logo_text, primary_color, secondary_color, buy_rate_basis_points, currency, disclaimer, contact, data_status)
values ('hard-hittin', 'Hard Hittin', 'HARD HITTIN', '#e86a3c', '#f3c969', 6000, 'USD',
  'This is an estimated offer based on the current market reference and Hard Hittin''s 60% buying rate. Final offers are subject to physical inspection, authenticity verification, edition/printing, and shop policy.',
  'Bring your cards into the shop for a final assessment.', 'Production schema ready — pricing requires an authorized maintained dataset.')
on conflict (id) do update set business_name = excluded.business_name, buy_rate_basis_points = excluded.buy_rate_basis_points, updated_at = now();

create or replace function public.tcg_is_admin(p_client_id text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.tcg_client_admins where client_id = p_client_id and user_id = auth.uid()); $$;

create or replace function public.tcg_publish_pricing_import(p_client_id text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
  row_data jsonb;
  existing public.tcg_pricing;
  card_data public.tcg_cards;
  old_cents bigint;
  imported_count integer := 0;
  updated_count integer := 0;
  unchanged_count integer := 0;
  conflict_count integer := 0;
  total_count integer := jsonb_array_length(p_rows);
  import_id uuid;
begin
  if actor is null or not public.tcg_is_admin(p_client_id) then
    raise exception using errcode = '42501', message = 'Unauthorized pricing import.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or total_count > 10000 then
    raise exception using errcode = '22023', message = 'Import must be an array of at most 10000 rows.';
  end if;

  insert into public.tcg_imports (client_id, actor_id, status, total_count)
  values (p_client_id, actor, 'failed', total_count) returning id into import_id;

  for row_data in select value from jsonb_array_elements(p_rows) loop
    if nullif(trim(row_data->>'card_id'), '') is null
      or nullif(trim(row_data->>'card_name'), '') is null
      or nullif(trim(row_data->>'card_number'), '') is null
      or nullif(trim(row_data->>'set_code'), '') is null
      or nullif(trim(row_data->>'set_name'), '') is null
      or nullif(trim(row_data->>'condition_code'), '') is null
      or nullif(trim(row_data->>'source_name'), '') is null
      or nullif(trim(row_data->>'source_updated_at'), '') is null
      or nullif(trim(row_data->>'currency'), '') is null then
      raise exception using errcode = '22023', message = 'Import row is missing a required field.';
    end if;
    if (row_data->>'reference_cents')::bigint < 0 then
      raise exception using errcode = '22023', message = 'Reference price cannot be negative.';
    end if;
    if not exists (select 1 from public.tcg_conditions where code = row_data->>'condition_code') then
      raise exception using errcode = '22023', message = 'Unknown condition code.';
    end if;

    insert into public.tcg_cards (id, name, card_number, set_code, set_name)
    values (row_data->>'card_id', row_data->>'card_name', row_data->>'card_number', row_data->>'set_code', row_data->>'set_name')
    on conflict (id) do update set name = excluded.name, card_number = excluded.card_number, set_code = excluded.set_code, set_name = excluded.set_name;

    select * into existing from public.tcg_pricing
      where client_id = p_client_id and card_id = row_data->>'card_id' and condition_code = row_data->>'condition_code' and source_updated_at = (row_data->>'source_updated_at')::date
      limit 1;
    select reference_cents into old_cents from public.tcg_pricing
      where client_id = p_client_id and card_id = row_data->>'card_id' and condition_code = row_data->>'condition_code' and active
      limit 1;

    if existing.id is not null and existing.reference_cents = (row_data->>'reference_cents')::bigint and existing.source_name = row_data->>'source_name' then
      unchanged_count := unchanged_count + 1;
    else
      update public.tcg_pricing set active = false, updated_at = now()
        where client_id = p_client_id and card_id = row_data->>'card_id' and condition_code = row_data->>'condition_code' and active;
      insert into public.tcg_pricing (client_id, card_id, condition_code, reference_cents, currency, source_name, source_updated_at, actor_id)
        values (p_client_id, row_data->>'card_id', row_data->>'condition_code', (row_data->>'reference_cents')::bigint, row_data->>'currency', row_data->>'source_name', (row_data->>'source_updated_at')::date, actor);
      insert into public.tcg_pricing_history (client_id, card_id, condition_code, previous_reference_cents, new_reference_cents, source_name, source_updated_at, actor_id)
        values (p_client_id, row_data->>'card_id', row_data->>'condition_code', old_cents, (row_data->>'reference_cents')::bigint, row_data->>'source_name', (row_data->>'source_updated_at')::date, actor);
      if old_cents is null then imported_count := imported_count + 1; else updated_count := updated_count + 1; end if;
    end if;
  end loop;

  update public.tcg_imports set status = 'published', imported_count = imported_count, updated_count = updated_count, unchanged_count = unchanged_count, conflict_count = conflict_count where id = import_id;
  return jsonb_build_object('import_id', import_id, 'status', 'published', 'total', total_count, 'imported', imported_count, 'updated', updated_count, 'unchanged', unchanged_count, 'conflicts', conflict_count);
exception when others then
  update public.tcg_imports set status = 'failed', rejected_count = total_count where id = import_id;
  raise;
end;
$$;

alter table public.tcg_clients enable row level security;
alter table public.tcg_conditions enable row level security;
alter table public.tcg_cards enable row level security;
alter table public.tcg_pricing enable row level security;
alter table public.tcg_pricing_history enable row level security;
alter table public.tcg_client_admins enable row level security;
alter table public.tcg_imports enable row level security;

drop policy if exists tcg_public_clients on public.tcg_clients;
create policy tcg_public_clients on public.tcg_clients for select using (active);
drop policy if exists tcg_public_conditions on public.tcg_conditions;
create policy tcg_public_conditions on public.tcg_conditions for select using (true);
drop policy if exists tcg_public_cards on public.tcg_cards;
create policy tcg_public_cards on public.tcg_cards for select using (active);
drop policy if exists tcg_public_pricing on public.tcg_pricing;
create policy tcg_public_pricing on public.tcg_pricing for select using (active and exists (select 1 from public.tcg_clients c where c.id = client_id and c.active));
drop policy if exists tcg_admin_history on public.tcg_pricing_history;
create policy tcg_admin_history on public.tcg_pricing_history for select using (public.tcg_is_admin(client_id));
drop policy if exists tcg_admin_imports on public.tcg_imports;
create policy tcg_admin_imports on public.tcg_imports for select using (public.tcg_is_admin(client_id));

grant select on public.tcg_clients, public.tcg_conditions, public.tcg_cards, public.tcg_pricing to anon, authenticated;
grant select on public.tcg_pricing_history, public.tcg_imports to authenticated;
grant execute on function public.tcg_publish_pricing_import(text, jsonb) to authenticated;
