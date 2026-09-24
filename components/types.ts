export type Cat = { id: string; name: string; parent_id: string | null; kind: "expense" | "income" | "transfer"; color: string | null; is_system: boolean };
export type Txn = {
  id: string;
  local_date: string;
  description: string;
  merchant_name: string | null;
  amount: number;
  account_id: string | null;
  category_id: string | null;
  category_label: string;
  category_source: string | null;
  is_transfer: boolean;
  is_manual: boolean;
  akahu_category: string | null;
};
export type Account = { id: string; name: string; institution: string };
