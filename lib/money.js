const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function parseUnsignedDecimal(value, label) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[$,]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(
      `${label} must be a non-negative value with up to two decimals.`,
    );
  }
  const [whole, fraction = ""] = normalized.split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  if (amount > MAX_SAFE_CENTS) {
    throw new Error(`${label} is too large to represent safely.`);
  }
  return Number(amount);
}

export function parseMoneyToCents(value) {
  return parseUnsignedDecimal(value, "Price");
}

export function parsePercentageToBasisPoints(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/%$/, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Buy rate must be a percentage between 0% and 100%.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const basisPoints =
    BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  if (basisPoints > 10000n) {
    throw new Error("Buy rate must be between 0% and 100%.");
  }
  return Number(basisPoints);
}

export function calculateOffer(referencePrice, buyRate) {
  const cents = Number.isInteger(referencePrice)
    ? referencePrice
    : parseMoneyToCents(referencePrice);
  const basisPoints = Number.isInteger(buyRate)
    ? buyRate
    : parsePercentageToBasisPoints(buyRate);
  if (
    !Number.isSafeInteger(cents) ||
    cents < 0 ||
    basisPoints < 0 ||
    basisPoints > 10000
  ) {
    throw new Error("Invalid calculation inputs.");
  }
  const offerCents = (BigInt(cents) * BigInt(basisPoints) + 5000n) / 10000n;
  if (offerCents > MAX_SAFE_CENTS) {
    throw new Error("Calculation result is too large to represent safely.");
  }
  return {
    referenceCents: cents,
    rateBasisPoints: basisPoints,
    offerCents: Number(offerCents),
  };
}

export function formatMoney(cents, currency = "USD") {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error("Invalid money value.");
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
}

export function formatRate(basisPoints) {
  if (
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10000
  ) {
    throw new Error("Invalid rate value.");
  }
  return `${(basisPoints / 100).toFixed(basisPoints % 100 === 0 ? 0 : 2)}%`;
}
