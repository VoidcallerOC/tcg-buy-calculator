export function parseMoneyToCents(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[$,]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(
      "Price must be a non-negative currency amount with up to two decimals.",
    );
  }
  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function parsePercentageToBasisPoints(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/%$/, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Buy rate must be a percentage between 0% and 100%.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (basisPoints < 0 || basisPoints > 10000) {
    throw new Error("Buy rate must be between 0% and 100%.");
  }
  return basisPoints;
}

export function calculateOffer(referencePrice, buyRate) {
  const cents = Number.isInteger(referencePrice)
    ? referencePrice
    : parseMoneyToCents(referencePrice);
  const basisPoints = Number.isInteger(buyRate)
    ? buyRate
    : parsePercentageToBasisPoints(buyRate);
  if (cents < 0 || basisPoints < 0 || basisPoints > 10000)
    throw new Error("Invalid calculation inputs.");
  return {
    referenceCents: cents,
    rateBasisPoints: basisPoints,
    offerCents: Math.round((cents * basisPoints) / 10000),
  };
}

export function formatMoney(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
}

export function formatRate(basisPoints) {
  return `${(basisPoints / 100).toFixed(basisPoints % 100 === 0 ? 0 : 2)}%`;
}
