create or replace function public.tcg_catalog_publish_prices(p_prices jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  published integer := 0;
begin
  if p_prices is null or jsonb_typeof(p_prices) <> 'array' or jsonb_array_length(p_prices) = 0 then
    return 0;
  end if;

  update public.tcg_catalog_prices p
     set active = false
    from jsonb_to_recordset(p_prices) as incoming(
      variant_id uuid,
      condition_code text,
      reference_cents bigint,
      currency text,
      source_name text,
      source_updated_at timestamptz
    )
   where p.variant_id = incoming.variant_id
     and p.condition_code = incoming.condition_code
     and p.active = true
     and (
       p.source_updated_at is distinct from incoming.source_updated_at
       or p.reference_cents is distinct from incoming.reference_cents
     );

  insert into public.tcg_catalog_prices (
    variant_id, condition_code, reference_cents, currency, source_name, source_updated_at, active
  )
  select
    incoming.variant_id,
    incoming.condition_code,
    incoming.reference_cents,
    coalesce(nullif(incoming.currency, ''), 'USD'),
    coalesce(nullif(incoming.source_name, ''), 'JustTCG'),
    incoming.source_updated_at,
    true
  from jsonb_to_recordset(p_prices) as incoming(
    variant_id uuid,
    condition_code text,
    reference_cents bigint,
    currency text,
    source_name text,
    source_updated_at timestamptz
  )
  on conflict (variant_id, condition_code, source_updated_at)
  do update set
    reference_cents = excluded.reference_cents,
    currency = excluded.currency,
    source_name = excluded.source_name,
    active = true,
    fetched_at = now();

  get diagnostics published = row_count;
  return published;
end;
$$;

revoke all on function public.tcg_catalog_publish_prices(jsonb) from public;
grant execute on function public.tcg_catalog_publish_prices(jsonb) to service_role;
