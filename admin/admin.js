import { parsePricingCsv } from "../lib/csv-import.js";
const fileInput = document.querySelector("#csv-file");
const message = document.querySelector("#import-message");
const summary = document.querySelector("#import-summary");
const errors = document.querySelector("#import-errors");
const conditions = await fetch("../data/sample-pricing.json")
  .then((response) => response.json())
  .then((data) => data.conditions);
fileInput.addEventListener("change", async () => {
  const [file] = fileInput.files;
  if (!file) return;
  try {
    const result = parsePricingCsv(await file.text(), conditions);
    message.textContent = result.counts.errors
      ? "Fix the errors below before requesting a production import."
      : "Validation passed. Production import still requires authenticated confirmation.";
    summary.hidden = false;
    summary.innerHTML = `<strong>Preview counts</strong><span>Total rows ${result.counts.total}</span><span>Valid rows ${result.counts.valid}</span><span>Errors ${result.counts.errors}</span>`;
    errors.hidden = !result.errors.length;
    errors.innerHTML = result.errors
      .map((error) => `<div>Row ${error.row}: ${error.message}</div>`)
      .join("");
  } catch (error) {
    summary.hidden = true;
    errors.hidden = false;
    errors.textContent = error.message;
    message.textContent =
      "Upload rejected. Existing pricing remains unchanged.";
  }
});
