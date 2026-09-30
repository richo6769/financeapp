/**
 * Bank text (descriptions, merchant and payer names) is third-party data.
 * Strip control characters and cap its length before it goes near the model.
 */
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f\\u2028\\u2029]", "g");

export function clip(s: string | null | undefined, n = 80): string {
  const clean = (s ?? "").replace(CONTROL, " ");
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}

/** Markers that start bank noise we don't want in a label. */
const CCY = "(?:USD|AUD|GBP|EUR|JPY|SGD|THB|VND|CAD|CHF|CNY|HKD|IDR|INR|KRW|MYR|PHP|FJD|NZD|TWD|AED|MXN|SEK|NOK|DKK|ZAR|WST|TOP|XPF)";
const NOISE_START = new RegExp(
  [
    `\\b${CCY}\\s*\\d`, // USD 12.50
    `\\b\\d[\\d,]*(?:\\.\\d+)?\\s*${CCY}\\b`, // 12.50 USD
    "\\bCONV(?:ERSION|ERTED)?\\b",
    "\\bF/?X\\b",
    "\\bRATE\\b",
    "\\bFOREIGN\\b",
    "\\bINCL(?:UDES|UDING)?\\b",
    "\\bFEE\\b",
    "@\\s*\\d",
    "\\bREF(?:ERENCE)?\\b[:#]?",
    "\\bCARD\\s*\\d",
  ].join("|"),
  "i",
);

/**
 * Short, readable label for a bank line: drops currency-conversion text,
 * rates, fees, references and card/account numbers, then title-cases.
 *   "EVERYDAY/KAK 25.00 USD CONVERTED AT 1.6852 INCL FEE" → "Everyday/Kak"
 */
export function cleanDescription(raw: string | null | undefined, max = 40): string {
  const original = clip(raw, 200).trim();
  let s = original;
  const cut = s.search(NOISE_START);
  if (cut > 0) s = s.slice(0, cut);
  s = s
    .replace(/\b\d{4}[-\s]?[\d*X]{4}[-\s]?[\d*X]{4}[-\s]?\d{2,4}\b/gi, " ") // card numbers
    .replace(/\b\d{2}-\d{4}-\d{7}-\d{2,3}\b/g, " ") // NZ account numbers
    .replace(/\*{2,}\d*/g, " ")
    .replace(/\b\d{5,}\b/g, " ") // long refs
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–:;,.*/]+|[\s\-–:;,./]+$/g, "")
    .trim();
  if (!s) s = original;
  const titled = s.toLowerCase().replace(/(^|[\s/(&*-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
  return titled.length > max ? `${titled.slice(0, max - 1).trimEnd()}…` : titled;
}
