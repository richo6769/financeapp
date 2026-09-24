-- "Net off": link incoming money (credits) to expenses they reimburse.
-- An expense counts at its net amount (amount minus linked reimbursements) and
-- the linked part of the incoming payment is excluded from income totals.
-- One incoming payment can be split across several expenses and one expense
-- can be reimbursed by several payments.

create table public.reimbursement_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  expense_id uuid not null references public.transactions(id) on delete cascade,
  income_id uuid not null references public.transactions(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (expense_id, income_id),
  check (expense_id <> income_id)
);
create index reimbursement_links_user_idx on public.reimbursement_links(user_id);
create index reimbursement_links_expense_idx on public.reimbursement_links(expense_id);
create index reimbursement_links_income_idx on public.reimbursement_links(income_id);

-- Guard rails (also enforced in the app): the expense must be a debit, the
-- incoming a credit, both owned by the same user, and neither may be
-- over-allocated.
create or replace function public.check_reimbursement_link() returns trigger
language plpgsql as $$
declare
  exp_amount numeric;
  exp_user uuid;
  inc_amount numeric;
  inc_user uuid;
  exp_linked numeric;
  inc_linked numeric;
begin
  select amount, user_id into exp_amount, exp_user from public.transactions where id = new.expense_id;
  select amount, user_id into inc_amount, inc_user from public.transactions where id = new.income_id;
  if exp_amount is null or inc_amount is null then
    raise exception 'Linked transaction not found';
  end if;
  if exp_user <> new.user_id or inc_user <> new.user_id then
    raise exception 'Transactions belong to a different user';
  end if;
  if exp_amount >= 0 then
    raise exception 'Only an expense (debit) can be netted off';
  end if;
  if inc_amount <= 0 then
    raise exception 'Only incoming money (a credit) can be linked';
  end if;

  select coalesce(sum(amount), 0) into exp_linked from public.reimbursement_links
    where expense_id = new.expense_id and id <> new.id;
  select coalesce(sum(amount), 0) into inc_linked from public.reimbursement_links
    where income_id = new.income_id and id <> new.id;

  if exp_linked + new.amount > abs(exp_amount) then
    raise exception 'Links would exceed the expense amount (% already linked of %)', exp_linked, abs(exp_amount);
  end if;
  if inc_linked + new.amount > inc_amount then
    raise exception 'Links would exceed the incoming amount (% already linked of %)', inc_linked, inc_amount;
  end if;
  return new;
end $$;

create trigger reimbursement_links_check
  before insert or update on public.reimbursement_links
  for each row execute function public.check_reimbursement_link();

-- Same RLS as every other table (enabled, not forced).
alter table public.reimbursement_links enable row level security;
create policy "owner_select" on public.reimbursement_links for select to authenticated
  using (user_id = (select auth.uid()));
create policy "owner_insert" on public.reimbursement_links for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "owner_update" on public.reimbursement_links for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner_delete" on public.reimbursement_links for delete to authenticated
  using (user_id = (select auth.uid()));
