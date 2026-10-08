-- Migrate legacy hard-hittin client row to generic default client branding.
-- Child tables reference tcg_clients(id) without ON UPDATE CASCADE, so data is
-- copied onto id='default' then the obsolete row is removed.

do $$
begin
  if exists (select 1 from public.tcg_clients where id = 'hard-hittin')
     and not exists (select 1 from public.tcg_clients where id = 'default') then
    insert into public.tcg_clients (
      id, business_name, logo_text, primary_color, secondary_color,
      buy_rate_basis_points, currency, disclaimer, contact, data_status,
      stale_threshold_days, allow_stale_pricing, active
    )
    select
      'default',
      'TCG Buy Calculator',
      'TCG BUY CALC',
      '#0f766e',
      '#94a3b8',
      buy_rate_basis_points,
      currency,
      'This is an estimated offer based on the current market reference and the configured 60% buying rate. Final offers are subject to physical inspection, authenticity verification, edition/printing, and shop policy.',
      contact,
      data_status,
      stale_threshold_days,
      allow_stale_pricing,
      active
    from public.tcg_clients
    where id = 'hard-hittin';
  end if;

  if exists (select 1 from public.tcg_clients where id = 'default')
     and exists (select 1 from public.tcg_clients where id = 'hard-hittin') then
    -- Prefer existing default rows; drop obsolete hard-hittin dependents that would collide.
    delete from public.tcg_condition_policies hh
      where hh.client_id = 'hard-hittin'
        and exists (
          select 1 from public.tcg_condition_policies d
          where d.client_id = 'default' and d.condition_code = hh.condition_code
        );
    delete from public.tcg_source_compliance where client_id = 'hard-hittin'
      and exists (select 1 from public.tcg_source_compliance where client_id = 'default');
    delete from public.tcg_client_admins hh
      where hh.client_id = 'hard-hittin'
        and exists (
          select 1 from public.tcg_client_admins d
          where d.client_id = 'default' and d.user_id = hh.user_id
        );

    update public.tcg_condition_policies set client_id = 'default' where client_id = 'hard-hittin';
    update public.tcg_source_compliance set client_id = 'default' where client_id = 'hard-hittin';
    update public.tcg_client_admins set client_id = 'default' where client_id = 'hard-hittin';
    update public.tcg_imports set client_id = 'default' where client_id = 'hard-hittin';
    update public.tcg_pricing_history set client_id = 'default' where client_id = 'hard-hittin';
    update public.tcg_pricing set client_id = 'default' where client_id = 'hard-hittin';
    update public.tcg_sync_runs set client_id = 'default' where client_id = 'hard-hittin';
    delete from public.tcg_clients where id = 'hard-hittin';
  end if;

  update public.tcg_clients
  set business_name = 'TCG Buy Calculator',
      logo_text = 'TCG BUY CALC',
      primary_color = '#0f766e',
      secondary_color = '#94a3b8',
      disclaimer = 'This is an estimated offer based on the current market reference and the configured 60% buying rate. Final offers are subject to physical inspection, authenticity verification, edition/printing, and shop policy.',
      updated_at = now()
  where id = 'default';
end $$;
