const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const configured = Boolean(Deno.env.get("JUSTTCG_API_KEY"));
  return new Response(
    JSON.stringify({
      provider: "JustTCG",
      configured,
      authorization_status: configured
        ? "PENDING_PAID_PLAN_VERIFICATION"
        : "UNCLEAR",
      commercial_use: "UNCLEAR",
      derived_pricing: "UNCLEAR",
      attribution: "UNCLEAR",
      status: configured
        ? "CONFIGURED_AUTHORIZATION_PENDING"
        : "NOT_CONFIGURED",
      message: configured
        ? "JustTCG key detected server-side; verify an active paid plan before production activation."
        : "Set JUSTTCG_API_KEY as a server-side secret; free-tier use is not commercial authorization.",
      documentation: {
        quickstart: "https://justtcg.com/docs/quickstart",
        commercial_use: "https://justtcg.com/docs/commercial-use",
        terms: "https://justtcg.com/terms",
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
