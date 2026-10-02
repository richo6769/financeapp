/** Emoji icon per category (by name, case-insensitive), with sensible fallbacks. Safe for client and server. */
const ICONS: [RegExp, string][] = [
  [/grocer/i, "🛒"],
  [/^food$/i, "🍽️"],
  [/food & drink|drinks?/i, "🍻"],
  [/lifestyle/i, "🎉"],
  [/eating out|restaurant|cafe|coffee|dining/i, "🍽️"],
  [/takeaway|fast food|delivery/i, "🥡"],
  [/\bbars?\b|pub/i, "🍺"],
  [/liquor|wine|alcohol/i, "🍷"],
  [/\bsports?\b|\bgym/i, "⚽"],
  [/travel|holiday|flight/i, "✈️"],
  [/entertain|movie|cinema|fun/i, "🎬"],
  [/health|wellness|medical|pharm/i, "💪"],
  [/home|household|furni/i, "🏠"],
  [/rent|mortgage|housing/i, "🔑"],
  [/transport|fuel|petrol|uber|taxi|car/i, "⛽"],
  [/subscri|stream/i, "🔁"],
  [/cloth|shopping|fashion/i, "🛍️"],
  [/bill|utilit|power|electric|water|internet|phone/i, "💡"],
  [/insur/i, "🛡️"],
  [/salary|wage|pay\b|income/i, "💼"],
  [/transfer/i, "🔄"],
  [/saving|invest|sharesies|kiwisaver/i, "🐷"],
  [/gift|donat/i, "🎁"],
  [/pet/i, "🐾"],
  [/edu|course|school/i, "📚"],
];

export function categoryIcon(name: string | null | undefined, kind?: string | null): string {
  if (!name || name === "Uncategorised") return "❔";
  for (const [re, icon] of ICONS) if (re.test(name)) return icon;
  if (kind === "income") return "💰";
  if (kind === "transfer") return "🔄";
  if (kind === "savings") return "🐷";
  return "🏷️";
}
