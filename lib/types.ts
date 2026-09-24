// Row shapes shared by the Supabase and local stores. Money is NZD, stored as
// numbers with 2dp. Debits are negative, credits positive (Akahu convention).

export type CategoryKind = "expense" | "income" | "transfer";

export interface Account {
  id: string; // Akahu account _id (or mock id)
  user_id: string;
  name: string;
  institution: string;
  type: string; // CHECKING | SAVINGS | CREDITCARD | ...
  formatted_account: string | null;
  balance_current: number | null;
  balance_available: number | null;
  currency: string;
  status: string;
  /** Set when Akahu stopped returning this account; data is kept. */
  missing_since: string | null;
  updated_at: string;
}

export type CategorySource = "manual" | "rule" | "transfer" | "akahu" | "merchant" | null;

export interface Transaction {
  id: string;
  user_id: string;
  akahu_id: string | null; // null for manual/cash transactions
  account_id: string | null;
  date: string; // ISO timestamp
  local_date: string; // YYYY-MM-DD in Pacific/Auckland
  description: string;
  merchant_name: string | null;
  amount: number;
  type: string | null;
  akahu_category: string | null;
  category_id: string | null;
  category_source: CategorySource;
  is_transfer: boolean;
  is_manual: boolean;
  notes: string | null;
  /** Original foreign amount/currency when Akahu provides a conversion. */
  foreign_amount: number | null;
  foreign_currency: string | null;
  /** Set when the bank removed a settled transaction; excluded from totals, never deleted. */
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingTransaction {
  id: string;
  user_id: string;
  account_id: string;
  date: string;
  local_date: string;
  description: string;
  amount: number;
  type: string | null;
  updated_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  kind: CategoryKind;
  color: string | null;
  is_system: boolean;
  created_at: string;
}

export type RuleField = "merchant" | "description" | "any";
export type RuleMatch = "contains" | "word" | "exact" | "regex";

export interface Rule {
  id: string;
  user_id: string;
  pattern: string;
  field: RuleField;
  match_type: RuleMatch;
  /** Comma-separated words; if any appears as a whole word the rule doesn't match (e.g. tower ⟂ "sky"). */
  exclude_words: string | null;
  category_id: string;
  priority: number;
  created_at: string;
}

export type BudgetPeriod = "weekly" | "fortnightly" | "monthly" | "yearly";

export interface Budget {
  id: string;
  user_id: string;
  category_id: string;
  amount_monthly: number;
  period: BudgetPeriod;
  period_amount: number;
  updated_at: string;
}

export type PayFrequency = "weekly" | "fortnightly" | "monthly";

export interface Settings {
  user_id: string;
  overall_monthly_cap: number | null;
  pay_frequency: PayFrequency | null;
  next_payday: string | null; // YYYY-MM-DD, any payday works as the anchor
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls: ToolCallRecord[] | null;
  created_at: string;
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  result: unknown;
}

export interface SyncLog {
  id: string;
  user_id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "error";
  trigger: "manual" | "cron" | "test";
  mode: "mock" | "live";
  range_start: string | null;
  range_end: string | null;
  accounts_synced: number;
  transactions_upserted: number;
  transactions_new: number;
  pending_count: number;
  error: string | null;
  /** Non-fatal notes, e.g. "3 transactions removed by the bank". */
  warnings: string | null;
}

/**
 * "Net off": part or all of an incoming credit (income_id) reimburses an
 * expense (expense_id). The expense counts at its net amount and the linked
 * part of the credit is excluded from income/spend.
 */
export interface ReimbursementLink {
  id: string;
  user_id: string;
  expense_id: string;
  income_id: string;
  amount: number; // positive NZD
  /** IOU this payment settled (if any) and by how much, so unlinking can re-open it exactly. */
  iou_id: string | null;
  iou_amount: number;
  created_at: string;
}

/** "Sam owes me $100" on an expense. Balance = amount − settled_amount. */
export interface Iou {
  id: string;
  user_id: string;
  expense_id: string;
  person_name: string;
  amount: number;
  settled_amount: number;
  status: "open" | "settled" | "cancelled";
  created_at: string;
  settled_at: string | null;
}

/** A proposed Net off, only ever applied when the user taps Accept. */
export interface NetoffSuggestion {
  id: string;
  user_id: string;
  income_id: string;
  expense_id: string;
  iou_id: string | null;
  amount: number;
  score: number;
  reason: string;
  status: "pending" | "accepted" | "dismissed";
  created_at: string;
}

export interface Trip {
  id: string;
  user_id: string;
  name: string;
  start_date: string;
  end_date: string;
  budget: number | null;
  exclude_from_monthly: boolean;
  include_all: boolean;
  created_at: string;
}

/** Manual trip membership overrides. */
export interface TripTransaction {
  id: string;
  user_id: string;
  trip_id: string;
  transaction_id: string;
  mode: "include" | "exclude";
  created_at: string;
}

export interface SubscriptionPref {
  id: string;
  user_id: string;
  merchant_key: string;
  status: "tracked" | "ignored";
  first_detected_on: string;
  created_at: string;
}

export interface WeeklyCap {
  id: string;
  user_id: string;
  category_id: string;
  amount: number;
  updated_at: string;
}

export interface WeeklyRecap {
  id: string;
  user_id: string;
  week_start: string; // Monday (NZ)
  data: Record<string, unknown>;
  summary: string;
  generated_by: "claude" | "template";
  created_at: string;
}

export interface Tables {
  accounts: Account;
  transactions: Transaction;
  pending_transactions: PendingTransaction;
  categories: Category;
  rules: Rule;
  budgets: Budget;
  settings: Settings;
  chat_messages: ChatMessage;
  sync_log: SyncLog;
  reimbursement_links: ReimbursementLink;
  ious: Iou;
  netoff_suggestions: NetoffSuggestion;
  trips: Trip;
  trip_transactions: TripTransaction;
  subscription_prefs: SubscriptionPref;
  weekly_caps: WeeklyCap;
  weekly_recaps: WeeklyRecap;
}

export type TableName = keyof Tables;
