import { test } from "node:test";
import assert from "node:assert/strict";
import { addEntry } from "./offer-list.js";
import { calculateOffer } from "./money.js";
import {
  SHOP_INTAKE_SCHEMA,
  buildShopIntakePayload,
  canExportList,
  copyTextToClipboard,
  formatShopIntakeJson,
  shopIntakeFilename,
  triggerJsonDownload,
} from "./shop-intake-export.js";

const priced = (key, referenceCents) => ({
  key,
  label: `Card ${key}`,
  condition: "Near Mint",
  referenceCents,
  offerCents: calculateOffer(referenceCents, 6000).offerCents,
  sourceUpdatedAt: "2026-10-10T00:00:00.000Z",
});

const client = {
  clientId: "default",
  businessName: "TCG Buy Calculator",
  currency: "USD",
  buyRate: "60%",
};

test("empty or invalid lists cannot be exported", () => {
  assert.deepEqual(canExportList([]), { ok: false, reason: "empty" });
  assert.deepEqual(canExportList(null), { ok: false, reason: "invalid" });
  assert.deepEqual(canExportList(undefined), { ok: false, reason: "invalid" });
  assert.equal(canExportList([priced("a", 1000)]).ok, true);
});

test("buildShopIntakePayload throws a clear empty-list error", () => {
  assert.throws(
    () => buildShopIntakePayload({ list: [], client }),
    (error) => error.code === "empty" && /empty/i.test(error.message),
  );
});

test("payload copies list offers and totals without recalculating buy rate", () => {
  let list = addEntry([], priced("a", 1499));
  list = addEntry(list, priced("b", 20000));
  list = addEntry(list, {
    key: "c",
    label: "Stale card",
    condition: "Near Mint",
    unavailable: "price out of date",
  });

  const payload = buildShopIntakePayload({
    list,
    client,
    exportedAt: "2026-10-17T12:00:00.000Z",
  });

  assert.equal(payload.schema, SHOP_INTAKE_SCHEMA);
  assert.equal(payload.exportedAt, "2026-10-17T12:00:00.000Z");
  assert.deepEqual(payload.client, {
    clientId: "default",
    businessName: "TCG Buy Calculator",
    currency: "USD",
    buyRate: "60%",
  });
  assert.deepEqual(payload.summary, {
    count: 3,
    priced: 2,
    unpriced: 1,
    offerCents: 899 + 12000,
    referenceCents: 21499,
  });
  assert.equal(payload.items.length, 3);
  assert.deepEqual(payload.items[0], {
    key: "a",
    label: "Card a",
    condition: "Near Mint",
    offerCents: 899,
    referenceCents: 1499,
    sourceUpdatedAt: "2026-10-10T00:00:00.000Z",
    unavailable: null,
  });
  assert.equal(payload.items[2].offerCents, null);
  assert.equal(payload.items[2].unavailable, "price out of date");
});

test("formatShopIntakeJson is pretty-printed and parseable", () => {
  const list = addEntry([], priced("a", 1000));
  const payload = buildShopIntakePayload({
    list,
    client,
    exportedAt: "2026-10-17T12:00:00.000Z",
  });
  const text = formatShopIntakeJson(payload);
  assert.match(text, /\n {2}"schema":/);
  assert.equal(text.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(text), payload);
});

test("shopIntakeFilename is filesystem-safe", () => {
  assert.equal(
    shopIntakeFilename("2026-10-17T12:34:56.789Z"),
    "shop-intake-2026-10-17T12-34-56Z.json",
  );
});

test("copyTextToClipboard reports unsupported and denied gracefully", async () => {
  assert.deepEqual(await copyTextToClipboard("x", { clipboard: null }), {
    ok: false,
    reason: "unsupported",
  });
  assert.deepEqual(
    await copyTextToClipboard("hello", {
      clipboard: {
        writeText: async () => {
          throw new Error("Permission denied");
        },
      },
    }),
    { ok: false, reason: "denied" },
  );

  let written = null;
  const ok = await copyTextToClipboard("hello", {
    clipboard: {
      writeText: async (value) => {
        written = value;
      },
    },
  });
  assert.deepEqual(ok, { ok: true });
  assert.equal(written, "hello");
});

test("triggerJsonDownload creates a JSON blob download", () => {
  const clicks = [];
  const revoked = [];
  const created = [];
  const children = [];
  const fakeDoc = {
    body: {
      appendChild(node) {
        children.push(node);
      },
    },
    createElement(tag) {
      assert.equal(tag, "a");
      return {
        href: "",
        download: "",
        rel: "",
        click() {
          clicks.push({ href: this.href, download: this.download });
        },
        remove() {
          children.pop();
        },
      };
    },
  };

  const result = triggerJsonDownload('{"a":1}\n', "shop-intake.json", {
    document: fakeDoc,
    Blob: class {
      constructor(parts, options) {
        this.parts = parts;
        this.type = options.type;
      }
    },
    URL: {
      createObjectURL(blob) {
        created.push(blob);
        return "blob:shop-intake";
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "application/json");
  assert.deepEqual(clicks, [
    { href: "blob:shop-intake", download: "shop-intake.json" },
  ]);
  assert.equal(children.length, 0);
});

test("triggerJsonDownload reports unsupported environments", () => {
  assert.deepEqual(
    triggerJsonDownload("{}", "x.json", {
      document: null,
      URL: null,
      Blob: null,
    }),
    { ok: false, reason: "unsupported" },
  );
});
