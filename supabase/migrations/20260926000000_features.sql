-- Suggested net offs, trips, subscriptions, weekly caps and weekly recaps.
-- Every table: user_id + the same owner-only RLS policies (enabled, not forced).

-- --------------------------------------------------- netoff_suggestions
-- Proposed links; only applied when the user taps Accept. Unique per
-- (income, expense) so a dismissed suggestion is never re-created.
create table public.netoff_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  income_id uuid not null references public.transactions(id) on delete cascade,
  expense_id uuid not null references public.transactions(id) on delete cascade,
  iou_id uuid references public.ious(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  score integer not null default 0,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  created_at timestamptz not null default now(),
  unique (user_id, income_id, expense_id)
);
create index netoff_suggestions_status_idx on public.netoff_suggestions(user_id, status);

-- ------------------------------------------------------------------ trips
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  start_date date not null,
  end_date date not null,
  budget numeric(14,2) check (budget >= 0),
  exclude_from_monthly boolean not null default true,
  include_all boolean not null default false,   -- count ALL spending in the range
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index trips_user_idx on public.trips(user_id, start_date);

-- Manual membership overrides ("include" anything, "exclude" an auto match).
create table public.trip_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  mode text not null check (mode in ('include','exclude')),
  created_at timestamptz not null default now(),
  unique (user_id, transaction_id)
);
create index trip_transactions_trip_idx on public.trip_transactions(trip_id);

-- -------------------------------------------------------- subscriptions
-- Detection is computed; this only remembers first detection and
-- "not a subscription".
create table public.subscription_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  merchant_key text not null check (char_length(merchant_key) between 1 and 120),
  status text not null default 'tracked' check (status in ('tracked','ignored')),
  first_detected_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (user_id, merchant_key)
);

-- ------------------------------------------------------------ weekly caps
create table public.weekly_caps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id)
);
create trigger weekly_caps_updated_at before update on public.weekly_caps
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------- weekly recaps
create table public.weekly_recaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,                   -- Monday (NZ)
  data jsonb not null,                        -- every number, computed in code
  summary text not null,
  generated_by text not null check (generated_by in ('claude','template')),
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

-- -------------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['netoff_suggestions','trips','trip_transactions','subscription_prefs','weekly_caps','weekly_recaps']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy "owner_select" on public.%I for select to authenticated using (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "owner_insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "owner_update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "owner_delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))$p$, t);
  end loop;
end $$;
