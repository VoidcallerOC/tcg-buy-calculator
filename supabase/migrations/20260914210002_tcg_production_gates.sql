create table if not exists public.tcg_condition_policies (
  client_id text not null references public.tcg_clients(id) on delete cascade,
  condition_code text not null references public.tcg_conditions(code),
  multiplier_basis_points integer check (multiplier_basis_points between 0 and 10000),
  enabled boolean not null default false,
  status text not null default 'UNCONFIGURED' check (status in ('UNCONFIGURED', 'DRAFT', 'APPROVED')),
  display_name text not null,
  notes text not null default '',
  effective_date date,
  approved_by uuid references auth.users(id),
  policy_version text,
  updated_at timestamptz not null default now(),
  primary key (client_id, condition_code),
  check (status <> 'APPROVED' or (enabled and multiplier_basis_points is not null and effective_date is not null and approved_by is not null and policy_version is not null))
);

create table if not exists public.tcg_source_compliance (
  client_id text primary key references public.tcg_clients(id) on delete cascade,
  provider text not null,
  commercial_use_status text not null check (commercial_use_status in ('AUTHORIZED', 'UNCLEAR', 'DENIED')),
  derived_pricing_status text not null default 'UNCLEAR' check (derived_pricing_status in ('AUTHORIZED', 'UNCLEAR', 'DENIED')),
  attribution_status text not null check (attribution_status in ('REQUIRED', 'NOT_REQUIRED', 'UNCLEAR')),
  attribution_implemented boolean not null default false,
  permission_evidence text not null default '',
  authorization_source text not null default '',
  source_url text not null default '',
  response_url text not null default '',
  authorization_date date,
  maintainer_name text not null default '',
  permission_scope text not null default '',
  private_cache_permission text not null default '',
  restrictions text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.tcg_source_compliance add column if not exists attribution_implemented boolean not null default false;
alter table public.tcg_source_compliance drop constraint if exists tcg_source_compliance_commercial_use_status_check;
alter table public.tcg_source_compliance add constraint tcg_source_compliance_commercial_use_status_check check (commercial_use_status in ('AUTHORIZED', 'UNCLEAR', 'DENIED'));
alter table public.tcg_source_compliance drop constraint if exists tcg_source_compliance_derived_pricing_status_check;
alter table public.tcg_source_compliance add constraint tcg_source_compliance_derived_pricing_status_check check (derived_pricing_status in ('AUTHORIZED', 'UNCLEAR', 'DENIED'));
alter table public.tcg_source_compliance drop constraint if exists tcg_source_compliance_attribution_status_check;
alter table public.tcg_source_compliance add constraint tcg_source_compliance_attribution_status_check check (attribution_status in ('REQUIRED', 'NOT_REQUIRED', 'UNCLEAR'));
alter table public.tcg_source_compliance add column if not exists authorization_source text not null default '';
alter table public.tcg_source_compliance add column if not exists source_url text not null default '';
alter table public.tcg_source_compliance add column if not exists response_url text not null default '';
alter table public.tcg_source_compliance add column if not exists authorization_date date;
alter table public.tcg_source_compliance add column if not exists maintainer_name text not null default '';
alter table public.tcg_source_compliance add column if not exists permission_scope text not null default '';
alter table public.tcg_source_compliance add column if not exists private_cache_permission text not null default '';
alter table public.tcg_source_compliance add column if not exists restrictions text not null default '';

insert into public.tcg_condition_policies (client_id, condition_code, display_name)
select c.id, d.code, d.name
from public.tcg_clients c
cross join (values ('NM', 'Near Mint'), ('LP', 'Lightly Played'), ('MP', 'Moderately Played'), ('HP', 'Heavily Played'), ('DMG', 'Damaged')) as d(code, name)
on conflict (client_id, condition_code) do nothing;

insert into public.tcg_source_compliance (client_id, provider, commercial_use_status, derived_pricing_status, attribution_status, permission_evidence)
values ('hard-hittin', 'TCGCSV', 'UNCLEAR', 'UNCLEAR', 'UNCLEAR', 'Official documentation reviewed; no commercial-use or derived-price redistribution license identified.')
on conflict (client_id) do nothing;

alter table public.tcg_condition_policies enable row level security;
alter table public.tcg_source_compliance enable row level security;
create policy tcg_admin_condition_policies on public.tcg_condition_policies for all using (public.tcg_is_admin(client_id)) with check (public.tcg_is_admin(client_id));
create policy tcg_admin_source_compliance on public.tcg_source_compliance for all using (public.tcg_is_admin(client_id)) with check (public.tcg_is_admin(client_id));
grant select, insert, update on public.tcg_condition_policies, public.tcg_source_compliance to authenticated;

create or replace function public.tcg_assert_production_publish_allowed()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  compliance public.tcg_source_compliance;
  approved_conditions integer;
begin
  select * into compliance from public.tcg_source_compliance where client_id = new.client_id;
  if compliance.commercial_use_status is distinct from 'CONFIRMED'
    or compliance.derived_pricing_status is distinct from 'CONFIRMED'
    or (compliance.attribution_status = 'REQUIRED' and not compliance.attribution_implemented)
    or compliance.attribution_status = 'UNCLEAR' then
    raise exception using errcode = '42501', message = 'Production pricing blocked: provider authorization is incomplete.';
  end if;
  select count(*) into approved_conditions from public.tcg_condition_policies
    where client_id = new.client_id and status = 'APPROVED' and enabled and multiplier_basis_points is not null;
  if approved_conditions < 5 then
    raise exception using errcode = '42501', message = 'Production pricing blocked: condition policy is incomplete.';
  end if;
  return new;
end;
$$;

drop trigger if exists tcg_production_publish_gate on public.tcg_pricing;
create trigger tcg_production_publish_gate
before insert on public.tcg_pricing
for each row execute function public.tcg_assert_production_publish_allowed();
