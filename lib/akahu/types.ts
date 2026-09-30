// Subset of the Akahu API shapes we use. https://developers.akahu.nz/reference

export interface AkahuAccount {
  _id: string;
  name: string;
  status: string; // ACTIVE | INACTIVE
  type: string; // CHECKING | SAVINGS | CREDITCARD | ...
  formatted_account?: string;
  connection: { _id: string; name: string; logo?: string };
  balance?: { current: number; available?: number; currency: string };
}

export interface AkahuTransaction {
  _id: string;
  _account: string;
  _connection?: string;
  date: string; // ISO timestamp
  description: string;
  amount: number;
  balance?: number;
  type: string; // EFTPOS | DEBIT | CREDIT | PAYMENT | TRANSFER | STANDING ORDER | ...
  merchant?: { _id: string; name: string };
  category?: {
    _id: string;
    name: string;
    groups?: { personal_finance?: { _id: string; name: string } };
  };
  meta?: {
    particulars?: string;
    code?: string;
    reference?: string;
    other_account?: string;
    /** Present for foreign-currency transactions. */
    conversion?: { amount: number; currency: string; rate?: number; fee?: number };
  };
}

export interface AkahuPendingTransaction {
  _account: string;
  date: string;
  description: string;
  amount: number;
  type: string;
  updated_at: string;
}

export interface AkahuPage<T> {
  success: boolean;
  items: T[];
  cursor?: { next: string | null };
}

export interface AkahuClient {
  readonly mode: "mock" | "live";
  listAccounts(): Promise<AkahuAccount[]>;
  /** All settled transactions in [start, end], following cursor pagination. */
  listTransactions(startIso: string, endIso: string): Promise<AkahuTransaction[]>;
  listPendingTransactions(): Promise<AkahuPendingTransaction[]>;
}
