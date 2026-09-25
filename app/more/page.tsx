import Link from "next/link";

const ITEMS = [
  { href: "/budgets", title: "Budgets & weekly caps", sub: "Monthly budgets, overall cap, Mon–Sun caps, categories" },
  { href: "/owed", title: "Owed to me", sub: "IOUs grouped by person" },
  { href: "/trips", title: "Trips", sub: "Trip budgets, daily spend, foreign currency" },
  { href: "/subscriptions", title: "Subscriptions", sub: "Recurring charges, price rises, missed charges" },
  { href: "/recaps", title: "Weekly recaps", sub: "Every Monday: last week in a few sentences" },
  { href: "/rules", title: "Rules", sub: "Automatic categorisation" },
  { href: "/settings", title: "Sync & settings", sub: "Sync status, accounts, pay cycle" },
];

export default function More() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">More</h1>
      <ul className="card divide-y divide-border py-1">
        {ITEMS.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex items-center justify-between gap-2 py-3">
              <span>
                <span className="block font-medium">{i.title}</span>
                <span className="block text-xs text-muted">{i.sub}</span>
              </span>
              <span className="text-muted" aria-hidden>›</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
