// Shop intake export: serialize the in-visit card list ("Cards in this visit")
// as JSON for download or clipboard. Pure regarding list/pricing math — reuses
// offer-list summarize; does not recalculate buy rate or invent prices.

import { summarize } from "./offer-list.js";

export const SHOP_INTAKE_SCHEMA = "tcg-buy-calculator.shop-intake.v1";

/**
 * @param {unknown} list
 * @returns {{ ok: true } | { ok: false, reason: "empty" | "invalid" }}
 */
export function canExportList(list) {
  if (!Array.isArray(list)) return { ok: false, reason: "invalid" };
  if (list.length === 0) return { ok: false, reason: "empty" };
  return { ok: true };
}

/**
 * @param {{
 *   list: Array<{
 *     key: string,
 *     label: string,
 *     condition: string,
 *     offerCents?: number|null,
 *     referenceCents?: number|null,
 *     sourceUpdatedAt?: string|null,
 *     unavailable?: string|null,
 *   }>,
 *   client?: {
 *     clientId?: string|null,
 *     businessName?: string|null,
 *     currency?: string|null,
 *     buyRate?: string|null,
 *   },
 *   exportedAt?: string,
 * }} options
 */
export function buildShopIntakePayload({
  list,
  client = {},
  exportedAt = new Date().toISOString(),
}) {
  const gate = canExportList(list);
  if (!gate.ok) {
    const error = new Error(
      gate.reason === "empty"
        ? "Nothing to export: the visit list is empty."
        : "Nothing to export: the visit list is invalid.",
    );
    error.code = gate.reason;
    throw error;
  }

  const summary = summarize(list);
  return {
    schema: SHOP_INTAKE_SCHEMA,
    exportedAt: String(exportedAt),
    client: {
      clientId: client.clientId ?? null,
      businessName: client.businessName ?? null,
      currency: client.currency ?? null,
      buyRate: client.buyRate ?? null,
    },
    summary: {
      count: summary.count,
      priced: summary.priced,
      unpriced: summary.unpriced,
      offerCents: summary.offerCents,
      referenceCents: summary.referenceCents,
    },
    items: list.map((item) => ({
      key: String(item.key),
      label: String(item.label ?? ""),
      condition: String(item.condition ?? ""),
      offerCents: item.offerCents ?? null,
      referenceCents: item.referenceCents ?? null,
      sourceUpdatedAt: item.sourceUpdatedAt ?? null,
      unavailable: item.unavailable ?? null,
    })),
  };
}

export function formatShopIntakeJson(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * Stable, filesystem-safe name derived from the export timestamp.
 * @param {string} [exportedAt]
 */
export function shopIntakeFilename(exportedAt = new Date().toISOString()) {
  const stamp = String(exportedAt)
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[:.]/g, "-");
  return `shop-intake-${stamp}.json`;
}

/**
 * Copy text to the clipboard. Resolves `{ ok: true }` on success, or
 * `{ ok: false, reason }` when the Clipboard API is missing or denied.
 * @param {string} text
 * @param {{ clipboard?: { writeText: (value: string) => Promise<void> } }} [deps]
 */
export async function copyTextToClipboard(text, deps = {}) {
  const clipboard = deps.clipboard ?? globalThis.navigator?.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") {
    return { ok: false, reason: "unsupported" };
  }
  try {
    await clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false, reason: "denied" };
  }
}

/**
 * Trigger a .json file download in the browser via a temporary object URL.
 * @param {string} text
 * @param {string} filename
 * @param {{
 *   document?: Document,
 *   URL?: { createObjectURL: Function, revokeObjectURL: Function },
 *   Blob?: typeof Blob,
 * }} [deps]
 */
export function triggerJsonDownload(text, filename, deps = {}) {
  const doc = deps.document ?? globalThis.document;
  const URLApi = deps.URL ?? globalThis.URL;
  const BlobCtor = deps.Blob ?? globalThis.Blob;
  if (!doc?.createElement || !URLApi?.createObjectURL || !BlobCtor) {
    return { ok: false, reason: "unsupported" };
  }

  const blob = new BlobCtor([text], { type: "application/json" });
  const url = URLApi.createObjectURL(blob);
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  doc.body?.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next turn so the click navigation can start.
  globalThis.setTimeout?.(() => URLApi.revokeObjectURL(url), 0);
  return { ok: true };
}
