export type Cat = { id: string; name: string; parent_id: string | null; kind: "expense" | "income" | "transfer" | "savings"; color: string | null; is_system: boolean };
export type Txn = {
  id: string;
  local_date: string;
  description: string;
  merchant_name: string | null;
  amount: number;
  account_id: string | null;
  category_id: string | null;
  category_label: string;
  category_kind?: Cat["kind"] | null;
  category_color?: string | null;
  /** Merchant logo URL from Akahu, when known. */
  logo?: string | null;
  category_source: string | null;
  is_transfer: boolean;
  is_manual: boolean;
  akahu_category: string | null;
  // Net off (reimbursements)
  net_amount: number;
  reimbursed_by: LinkView[];
  linked_to: LinkView[];
  unallocated: number | null;
  netted_off: boolean;
  netted_categories: string[];
  foreign_amount: number | null;
  foreign_currency: string | null;
  removed_at: string | null;
  trip: { id: string; name: string } | null;
  ious: { id: string; person_name: string; amount: number; balance: number; status: string }[];
};
export type LinkView = { link_id: string; other_id: string; other_name: string; other_date: string; other_category: string; amount: number };
export type Account = { id: string; name: string; institution: string };
