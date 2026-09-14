import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  try {
    const response = await fetch("https://tcgcsv.com/last-updated.txt", {
      headers: { "User-Agent": "ForgeCT-TCG-Buy-Calculator/1.0" },
    });
    const sourceUpdatedAt = response.ok ? (await response.text()).trim() : null;
    return json({
      provider: "TCGCSV",
      configured: true,
      status: "READY",
      source_updated_at: sourceUpdatedAt,
      message:
        "TCGCSV is available as a server-side daily source; run preview before publishing.",
    });
  } catch (_error) {
    return json(
      {
        provider: "TCGCSV",
        configured: true,
        status: "UNAVAILABLE",
        message: "TCGCSV source is temporarily unavailable.",
      },
      503,
    );
  }
});
