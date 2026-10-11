-- tcg_catalog_publish_prices is SECURITY DEFINER and writes active catalog
-- prices past RLS. Supabase grants EXECUTE on new public functions to anon and
-- authenticated by default, so the earlier `revoke all ... from public` left it
-- callable with the browser's publishable key. Only the service-role catalog
-- sync may call it.
revoke execute on function public.tcg_catalog_publish_prices(jsonb) from anon, authenticated;
