alter table public.tcg_source_compliance
  add column if not exists provider_plan text not null default '',
  add column if not exists terms_checked_at date,
  add column if not exists terms_url text not null default '';

update public.tcg_source_compliance
set provider = 'JustTCG',
    commercial_use_status = 'UNCLEAR',
    derived_pricing_status = 'UNCLEAR',
    attribution_status = 'UNCLEAR',
    attribution_implemented = false,
    permission_evidence = 'JustTCG paid tiers permit end-user display, derived analytics, and server-side caching; production remains pending until an active paid plan and deployment evidence are recorded.',
    authorization_source = 'Official JustTCG Terms and commercial-use guidelines',
    source_url = 'https://justtcg.com/docs/commercial-use',
    response_url = 'https://justtcg.com/terms',
    terms_checked_at = '2026-09-14',
    terms_url = 'https://justtcg.com/terms'
where client_id = 'hard-hittin';

create or replace function public.tcg_assert_production_publish_allowed()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  compliance public.tcg_source_compliance;
  approved_conditions integer;
begin
  select * into compliance from public.tcg_source_compliance where client_id = new.client_id;
  if compliance.commercial_use_status is distinct from 'AUTHORIZED'
    or compliance.derived_pricing_status is distinct from 'AUTHORIZED'
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
