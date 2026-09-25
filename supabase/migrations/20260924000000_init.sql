-- Kiwi Ledger schema. Single user, but every row carries user_id and every
-- table has RLS so only the signed-in owner can read/write their data.
-- The server-side cron uses the service-role key (bypasses RLS) and always
-- writes user_id explicitly.

-- gen_random_uuid() is built into Postgres 13+, so no extension is needed.

-- updated_at helper
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- accounts
create table public.accounts (
  id text primary key,                         -- Akahu account _id
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  institution text not null default 'Unknown',
  type text not null,                          -- CHECKING | SAVINGS | CREDITCARD ...
  formatted_account text,
  balance_current numeric(14,2),
  balance_available numeric(14,2),
  currency text not null default 'NZD',
  status text not null default 'ACTIVE',
  missing_since timestamptz,                   -- Akahu stopped returning it; history kept
  updated_at timestamptz not null default now()
);
create index accounts_user_idx on public.accounts(user_id);
create trigger accounts_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------- categories
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  parent_id uuid references public.categories(id) on delete cascade,
  kind text not null default 'expense' check (kind in ('expense','income','transfer')),
  color text,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index categories_unique_name on public.categories
  (user_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- ------------------------------------------------------------ transactions
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  akahu_id text unique,                        -- null for manual/cash entries
  account_id text references public.accounts(id) on delete cascade,
  date timestamptz not null,
  local_date date not null,                    -- Pacific/Auckland calendar date
  description text not null,
  merchant_name text,
  amount numeric(14,2) not null,               -- debits negative
  type text,
  akahu_category text,                         -- enrichment hint only
  category_id uuid references public.categories(id) on delete set null,
  category_source text check (category_source in ('manual','rule','transfer','akahu','merchant')),
  is_transfer boolean not null default false,
  is_manual boolean not null default false,
  notes text,
  foreign_amount numeric(18,2),                -- original amount when Akahu gives a conversion
  foreign_currency text check (foreign_currency ~ '^[A-Z]{3}$'),
  removed_at timestamptz,                      -- bank removed it after settling; excluded, never deleted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_user_date_idx on public.transactions(user_id, local_date desc);
create index transactions_user_category_idx on public.transactions(user_id, category_id);
create index transactions_account_idx on public.transactions(account_id);
create trigger transactions_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

-- Pending transactions have no stable id in Akahu; the whole set is replaced
-- on every sync and settled versions arrive in `transactions`.
create table public.pending_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id text not null references public.accounts(id) on delete cascade,
  date timestamptz not null,
  local_date date not null,
  description text not null,
  amount numeric(14,2) not null,
  type text,
  updated_at timestamptz not null default now()
);
create index pending_user_idx on public.pending_transactions(user_id);

-- ------------------------------------------------------------------- rules
create table public.rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pattern text not null check (char_length(pattern) between 1 and 100),
  field text not null default 'any' check (field in ('merchant','description','any')),
  -- word = whole-word match (used for short patterns like 'bp', 'ami')
  match_type text not null default 'contains' check (match_type in ('contains','word','exact','regex')),
  exclude_words text check (char_length(exclude_words) <= 200),  -- comma-separated veto words
  category_id uuid not null references public.categories(id) on delete cascade,
  priority integer not null default 100,       -- lower wins
  created_at timestamptz not null default now()
);
create index rules_user_idx on public.rules(user_id, priority);

-- ----------------------------------------------------------------- budgets
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  amount_monthly numeric(14,2) not null check (amount_monthly >= 0),
  period text not null default 'monthly' check (period in ('weekly','fortnightly','monthly','yearly')),
  period_amount numeric(14,2) not null,        -- what the user entered, e.g. 450/week
  updated_at timestamptz not null default now(),
  unique (user_id, category_id)
);
create trigger budgets_updated_at before update on public.budgets
  for each row execute function public.set_updated_at();

-- Overall monthly cap, pay cycle and other per-user settings.
create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  overall_monthly_cap numeric(14,2) check (overall_monthly_cap >= 0),
  pay_frequency text check (pay_frequency in ('weekly','fortnightly','monthly')),
  next_payday date,                            -- any payday; used as the cycle anchor
  updated_at timestamptz not null default now()
);
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------- chat_messages
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  tool_calls jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index chat_user_created_idx on public.chat_messages(user_id, created_at);

-- ---------------------------------------------------------------- sync_log
create table public.sync_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running','success','error')),
  trigger text not null check (trigger in ('manual','cron','test')),
  mode text not null check (mode in ('mock','live')),
  range_start date,
  range_end date,
  accounts_synced integer not null default 0,
  transactions_upserted integer not null default 0,
  transactions_new integer not null default 0,
  pending_count integer not null default 0,
  error text,
  warnings text
);
create index sync_log_user_started_idx on public.sync_log(user_id, started_at desc);

-- -------------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['accounts','categories','transactions','pending_transactions','rules','budgets','settings','chat_messages','sync_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy "owner_select" on public.%I for select to authenticated using (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "owner_insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "owner_update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "owner_delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))$p$, t);
  end loop;
end $$;
