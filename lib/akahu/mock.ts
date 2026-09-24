import "server-only";
import { addDays, monthProgress, todayLocal, toLocalDate } from "@/lib/dates";
import type {
  AkahuAccount,
  AkahuClient,
  AkahuPage,
  AkahuPendingTransaction,
  AkahuTransaction,
} from "./types";

/**
 * Deterministic fake Akahu data: ANZ everyday + savings and an Amex card.
 * The same calendar day always produces the same transactions and _ids, so
 * repeated/overlapping syncs exercise the upsert path exactly like live data.
 * Today's and yesterday's activity is returned as *pending* (no _id) and
 * "settles" the day after, which exercises pending replacement.
 */

export const MOCK_ACCOUNTS = {
  everyday: "acc_mock_anz_everyday",
  savings: "acc_mock_anz_savings",
  amex: "acc_mock_amex",
} as const;

const ANZ_EVERYDAY_NO = "01-0123-0456789-00";
const ANZ_SAVINGS_NO = "01-0123-0456789-01";

type Cat = { name: string; group: string } | null;
const C = {
  supermarket: { name: "Supermarkets and grocery stores", group: "Food" },
  cafe: { name: "Cafes and restaurants", group: "Food" },
  takeaway: { name: "Takeaway food", group: "Food" },
  fuel: { name: "Fuel stations", group: "Transport" },
  transport: { name: "Public transport", group: "Transport" },
  taxi: { name: "Taxis and rideshare", group: "Transport" },
  power: { name: "Electricity", group: "Utilities" },
  telco: { name: "Telecommunications", group: "Utilities" },
  water: { name: "Water", group: "Utilities" },
  streaming: { name: "Streaming services", group: "Lifestyle" },
  gym: { name: "Gyms and fitness", group: "Health" },
  pharmacy: { name: "Pharmacies", group: "Health" },
  department: { name: "Department stores", group: "Household" },
  online: { name: "Online shopping", group: "Household" },
  cinema: { name: "Cinemas", group: "Lifestyle" },
  airline: { name: "Airlines", group: "Travel" },
} satisfies Record<string, Cat>;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: string) {
  let a = hashStr(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Draft {
  account: string;
  description: string;
  amount: number;
  type: string;
  merchant?: string;
  cat?: Cat;
  other_account?: string;
}

function weekday(ld: string): number {
  const [y, m, d] = ld.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
}

function daysSinceEpoch(ld: string): number {
  const [y, m, d] = ld.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

const money = (r: () => number, min: number, max: number) =>
  Math.round((min + r() * (max - min)) * 100) / 100;

const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];

/** Generate all activity for one NZ calendar day. */
export function mockDay(ld: string): Draft[] {
  const r = rng(ld);
  const dow = weekday(ld);
  const dom = Number(ld.slice(8, 10));
  const epochDay = daysSinceEpoch(ld);
  const out: Draft[] = [];
  const card = () => (r() < 0.7 ? MOCK_ACCOUNTS.amex : MOCK_ACCOUNTS.everyday);
  const eftpos = (a: string) => (a === MOCK_ACCOUNTS.amex ? "CREDIT CARD" : "EFTPOS");

  // Income: fortnightly salary on Thursdays.
  if (dow === 4 && Math.floor(epochDay / 7) % 2 === 0) {
    out.push({ account: MOCK_ACCOUNTS.everyday, description: "ACME LIMITED SALARY", amount: 3450, type: "CREDIT" });
    // Savings sweep on payday: two legs of an internal transfer.
    out.push({
      account: MOCK_ACCOUNTS.everyday,
      description: `TRANSFER TO ${ANZ_SAVINGS_NO}`,
      amount: -500,
      type: "TRANSFER",
      other_account: ANZ_SAVINGS_NO,
    });
    out.push({
      account: MOCK_ACCOUNTS.savings,
      description: `TRANSFER FROM ${ANZ_EVERYDAY_NO}`,
      amount: 500,
      type: "TRANSFER",
      other_account: ANZ_EVERYDAY_NO,
    });
  }

  // Rent: weekly automatic payment on Mondays.
  if (dow === 1) {
    out.push({
      account: MOCK_ACCOUNTS.everyday,
      description: "J SMITH PROPERTY RENT",
      amount: -450,
      type: "STANDING ORDER",
      other_account: "12-3140-0123456-00",
    });
  }

  // Amex repayment from ANZ on the 20th (+ matching credit on the card).
  if (dom === 20) {
    const amt = money(r, 1400, 2300);
    out.push({
      account: MOCK_ACCOUNTS.everyday,
      description: "AMERICAN EXPRESS NZ PAYMENT",
      amount: -amt,
      type: "PAYMENT",
    });
    out.push({
      account: MOCK_ACCOUNTS.amex,
      description: "PAYMENT RECEIVED - THANK YOU",
      amount: amt,
      type: "PAYMENT",
    });
  }

  // Savings interest at month end-ish.
  if (dom === 28) {
    out.push({ account: MOCK_ACCOUNTS.savings, description: "INTEREST CREDIT", amount: money(r, 18, 32), type: "INTEREST" });
  }

  // Utilities & subscriptions (monthly).
  if (dom === 15) out.push({ account: MOCK_ACCOUNTS.everyday, description: "MERCURY NZ LTD DIRECT DEBIT", merchant: "Mercury", amount: -money(r, 140, 230), type: "DIRECT DEBIT", cat: C.power });
  if (dom === 5) out.push({ account: MOCK_ACCOUNTS.everyday, description: "SPARK NEW ZEALAND", merchant: "Spark", amount: -89, type: "DIRECT DEBIT", cat: C.telco });
  if (dom === 12 && Number(ld.slice(5, 7)) % 2 === 0) out.push({ account: MOCK_ACCOUNTS.everyday, description: "WATERCARE SERVICES", merchant: "Watercare", amount: -money(r, 55, 80), type: "DIRECT DEBIT", cat: C.water });
  if (dom === 3) out.push({ account: MOCK_ACCOUNTS.amex, description: "NETFLIX.COM", merchant: "Netflix", amount: -20.99, type: "CREDIT CARD", cat: C.streaming });
  if (dom === 9) out.push({ account: MOCK_ACCOUNTS.amex, description: "SPOTIFY P2F3A1", merchant: "Spotify", amount: -16.99, type: "CREDIT CARD", cat: C.streaming });
  if (dom === 17) out.push({ account: MOCK_ACCOUNTS.amex, description: "NEON SUBSCRIPTION", merchant: "Neon", amount: -15.99, type: "CREDIT CARD", cat: C.streaming });
  if (dom === 22) out.push({ account: MOCK_ACCOUNTS.amex, description: "APPLE.COM/BILL", merchant: "Apple", amount: -4.99, type: "CREDIT CARD" });

  // Gym weekly (Wednesdays).
  if (dow === 3) out.push({ account: MOCK_ACCOUNTS.everyday, description: "LES MILLS AUCKLAND", merchant: "Les Mills", amount: -32.5, type: "DIRECT DEBIT", cat: C.gym });

  // Groceries ~2x per week.
  if (dow === 6 || (dow === 2 && r() < 0.8)) {
    const [desc, merchant] = pick(r, [
      ["WOOLWORTHS PONSONBY", "Woolworths"],
      ["NEW WORLD VICTORIA PARK", "New World"],
      ["PAK N SAVE MT ALBERT", "PAK'nSAVE"],
      ["COUNTDOWN GREY LYNN", "Woolworths"],
    ]);
    const a = card();
    out.push({ account: a, description: desc, merchant, amount: -money(r, 55, 210), type: eftpos(a), cat: C.supermarket });
  }

  // Uber Eats ~2x/week, cafes most weekdays.
  if (r() < 0.28) out.push({ account: MOCK_ACCOUNTS.amex, description: "UBER *EATS HELP.UBER.COM", merchant: "Uber Eats", amount: -money(r, 24, 62), type: "CREDIT CARD", cat: C.takeaway });
  if (dow >= 1 && dow <= 5 && r() < 0.55) {
    const [desc, merchant] = pick(r, [
      ["COFFEE SUPREME PONSONBY", "Coffee Supreme"],
      ["SQ *MAKER COFFEE", null],
      ["BURGER BURGER PONSONBY", "Burger Burger"],
      ["HELL PIZZA GREY LYNN", "Hell Pizza"],
      ["SUSHI SAMA", null],
    ] as [string, string | null][]);
    const a = card();
    out.push({ account: a, description: desc, merchant: merchant ?? undefined, amount: -money(r, 6, 38), type: eftpos(a), cat: merchant ? C.cafe : null });
  }

  // Fuel roughly every 9 days.
  if (epochDay % 9 === 0) {
    const [desc, merchant] = pick(r, [
      ["Z ENERGY KINGSLAND", "Z Energy"],
      ["BP CONNECT GREAT NORTH RD", "BP"],
      ["MOBIL WESTMERE", "Mobil"],
    ]);
    const a = card();
    out.push({ account: a, description: desc, merchant, amount: -money(r, 70, 115), type: eftpos(a), cat: C.fuel });
  }

  // Transport.
  if (dow === 1) out.push({ account: MOCK_ACCOUNTS.everyday, description: "AT HOP TOP UP", merchant: "Auckland Transport", amount: -money(r, 20, 40), type: "EFTPOS", cat: C.transport });
  if (r() < 0.12) out.push({ account: MOCK_ACCOUNTS.amex, description: "UBER *TRIP HELP.UBER.COM", merchant: "Uber", amount: -money(r, 14, 45), type: "CREDIT CARD", cat: C.taxi });

  // Shopping, health, entertainment, travel (occasional).
  if (r() < 0.12) {
    const [desc, merchant, cat] = pick(r, [
      ["THE WAREHOUSE ST LUKES", "The Warehouse", C.department],
      ["KMART ST LUKES", "Kmart", C.department],
      ["MIGHTY APE LTD", "Mighty Ape", C.online],
      ["COTTON ON PONSONBY", null, null],
    ] as [string, string | null, Cat][]);
    const a = card();
    out.push({ account: a, description: desc, merchant: merchant ?? undefined, amount: -money(r, 15, 180), type: eftpos(a), cat });
  }
  if (r() < 0.04) out.push({ account: MOCK_ACCOUNTS.everyday, description: "UNICHEM PONSONBY PHARMACY", merchant: "Unichem", amount: -money(r, 8, 45), type: "EFTPOS", cat: C.pharmacy });
  if (r() < 0.04) out.push({ account: MOCK_ACCOUNTS.amex, description: "EVENT CINEMAS WESTGATE", merchant: "Event Cinemas", amount: -money(r, 18, 42), type: "CREDIT CARD", cat: C.cinema });
  if (r() < 0.012) out.push({ account: MOCK_ACCOUNTS.amex, description: "AIR NEW ZEALAND", merchant: "Air New Zealand", amount: -money(r, 150, 480), type: "CREDIT CARD", cat: C.airline });

  // Occasional refund to the card (credit in the original merchant's category).
  if (r() < 0.02) out.push({ account: MOCK_ACCOUNTS.amex, description: "MIGHTY APE LTD REFUND", merchant: "Mighty Ape", amount: money(r, 20, 90), type: "CREDIT CARD", cat: C.online });

  // Random unknown payment so the inbox has something to triage.
  if (r() < 0.05) out.push({ account: MOCK_ACCOUNTS.everyday, description: "POLI PAYMENT TRADEME", amount: -money(r, 10, 120), type: "PAYMENT" });

  return out;
}

function toTimestamp(ld: string, i: number): string {
  // 00:00 UTC..09:59 UTC == midday..~10pm the same NZ day (NZST or NZDT).
  return `${ld}T${String(Math.min(9, i)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00.000Z`;
}

function toAkahu(ld: string, d: Draft, i: number): AkahuTransaction {
  const slug = hashStr(`${ld}|${i}|${d.description}`).toString(36);
  return {
    _id: `trans_mock_${ld.replaceAll("-", "")}_${i}_${slug}`,
    _account: d.account,
    _connection: d.account === MOCK_ACCOUNTS.amex ? "conn_mock_amex" : "conn_mock_anz",
    date: toTimestamp(ld, i),
    description: d.description,
    amount: d.amount,
    type: d.type,
    merchant: d.merchant ? { _id: `merchant_mock_${hashStr(d.merchant).toString(36)}`, name: d.merchant } : undefined,
    category: d.cat
      ? {
          _id: `nzfcc_mock_${hashStr(d.cat.name).toString(36)}`,
          name: d.cat.name,
          groups: { personal_finance: { _id: `group_${d.cat.group.toLowerCase()}`, name: d.cat.group } },
        }
      : undefined,
    meta: d.other_account ? { other_account: d.other_account } : undefined,
  };
}

export class MockAkahuClient implements AkahuClient {
  readonly mode = "mock" as const;
  /** Settled data goes up to (today - SETTLE_LAG); the rest is pending. */
  static SETTLE_LAG = 2;
  static PAGE_SIZE = 100;

  constructor(private now: () => Date = () => new Date()) {}

  private today() {
    return todayLocal(this.now());
  }

  async listAccounts(): Promise<AkahuAccount[]> {
    const { dayOfMonth } = monthProgress(this.today());
    return [
      {
        _id: MOCK_ACCOUNTS.everyday,
        name: "ANZ Go (Everyday)",
        status: "ACTIVE",
        type: "CHECKING",
        formatted_account: ANZ_EVERYDAY_NO,
        connection: { _id: "conn_mock_anz", name: "ANZ" },
        balance: { current: 2841.37 + dayOfMonth * 3.1, available: 2841.37 + dayOfMonth * 3.1, currency: "NZD" },
      },
      {
        _id: MOCK_ACCOUNTS.savings,
        name: "ANZ Online Call (Savings)",
        status: "ACTIVE",
        type: "SAVINGS",
        formatted_account: ANZ_SAVINGS_NO,
        connection: { _id: "conn_mock_anz", name: "ANZ" },
        balance: { current: 18250.12, available: 18250.12, currency: "NZD" },
      },
      {
        _id: MOCK_ACCOUNTS.amex,
        name: "American Express Airpoints Platinum",
        status: "ACTIVE",
        type: "CREDITCARD",
        formatted_account: "XXXX-XXXXXX-X1005",
        connection: { _id: "conn_mock_amex", name: "American Express" },
        balance: { current: -1287.44, available: 13712.56, currency: "NZD" },
      },
    ];
  }

  private settled(startLd: string, endLd: string): AkahuTransaction[] {
    const lastSettled = addDays(this.today(), -MockAkahuClient.SETTLE_LAG);
    const end = endLd < lastSettled ? endLd : lastSettled;
    const out: AkahuTransaction[] = [];
    for (let ld = startLd; ld <= end; ld = addDays(ld, 1)) {
      mockDay(ld).forEach((d, i) => out.push(toAkahu(ld, d, i)));
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  /** Mimics GET /transactions with cursor pagination. */
  async page(startIso: string, endIso: string, cursor?: string | null): Promise<AkahuPage<AkahuTransaction>> {
    const all = this.settled(toLocalDate(startIso), toLocalDate(endIso)).filter(
      (t) => t.date >= startIso && t.date <= endIso,
    );
    const offset = cursor ? Number(Buffer.from(cursor, "base64url").toString()) : 0;
    const items = all.slice(offset, offset + MockAkahuClient.PAGE_SIZE);
    const next = offset + items.length < all.length ? Buffer.from(String(offset + items.length)).toString("base64url") : null;
    return { success: true, items, cursor: { next } };
  }

  async listTransactions(startIso: string, endIso: string): Promise<AkahuTransaction[]> {
    const out: AkahuTransaction[] = [];
    let cursor: string | null | undefined;
    do {
      const p = await this.page(startIso, endIso, cursor);
      out.push(...p.items);
      cursor = p.cursor?.next;
    } while (cursor);
    return out;
  }

  async listPendingTransactions(): Promise<AkahuPendingTransaction[]> {
    const today = this.today();
    const out: AkahuPendingTransaction[] = [];
    for (let i = MockAkahuClient.SETTLE_LAG - 1; i >= 0; i--) {
      const ld = addDays(today, -i);
      mockDay(ld).forEach((d, j) =>
        out.push({
          _account: d.account,
          date: toTimestamp(ld, j),
          description: d.description,
          amount: d.amount,
          type: d.type,
          updated_at: this.now().toISOString(),
        }),
      );
    }
    return out;
  }
}
