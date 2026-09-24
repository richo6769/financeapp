/**
 * Bank text (descriptions, merchant and payer names) is third-party data.
 * Strip control characters and cap its length before it goes near the model.
 */
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f\\u2028\\u2029]", "g");

export function clip(s: string | null | undefined, n = 80): string {
  const clean = (s ?? "").replace(CONTROL, " ");
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}
