import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const configured = Boolean(
    Deno.env.get("TCGPLAYER_PUBLIC_KEY") &&
      Deno.env.get("TCGPLAYER_PRIVATE_KEY"),
  );
  if (!configured) {
    return json(
      {
        provider: "TCGplayer",
        configured: false,
        status: "NOT_CONFIGURED",
        message: "TCGplayer provider not configured",
        required_secrets: ["TCGPLAYER_PUBLIC_KEY", "TCGPLAYER_PRIVATE_KEY"],
      },
      503,
    );
  }
  return json({
    provider: "TCGplayer",
    configured: true,
    status: "READY",
    message:
      "Authorized TCGplayer credentials are configured; invoke the server-side weekly sync pipeline.",
  });
});
