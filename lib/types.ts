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
export type RuleMatch = "contains" | "exact" | "regex";

export interface Rule {
  id: string;
  user_id: string;
  pattern: string;
  field: RuleField;
  match_type: RuleMatch;
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

export interface Settings {
  user_id: string;
  overall_monthly_cap: number | null;
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
}

export type TableName = keyof Tables;
