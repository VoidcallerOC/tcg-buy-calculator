export function createSupabaseSyncPublisher({
  baseUrl,
  publishableKey,
  accessToken,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!baseUrl || !publishableKey || !accessToken) {
    throw new Error(
      "Supabase sync publisher requires a base URL, publishable key, and authenticated access token.",
    );
  }
  return {
    async publish({ clientId, normalizedPrices }) {
      const rows = normalizedPrices.map((price) => ({
        card_id: price.source_product_id,
        card_name: price.source_product_id,
        card_number: price.source_product_id,
        set_code: "PROVIDER",
        set_name: "TCGplayer",
        condition_code: price.condition_code,
        reference_cents: price.reference_cents,
        currency: "USD",
        source_name: "TCGplayer official API",
        source_updated_at: (price.source_updated_at ?? price.fetched_at).slice(
          0,
          10,
        ),
        provider: price.provider,
        provider_version: price.provider_version,
        source_product_id: price.source_product_id,
        fetched_at: price.fetched_at,
        effective_at: price.effective_at,
        freshness_status: price.freshness_status,
      }));
      const response = await fetchImpl(
        `${baseUrl}/rest/v1/rpc/tcg_publish_pricing_import`,
        {
          method: "POST",
          headers: {
            apikey: publishableKey,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ p_client_id: clientId, p_rows: rows }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          body.message || "Transactional pricing publish failed.",
        );
      return body;
    },
  };
}
