-- Savings: a category kind for money moved to savings/investing (Sharesies,
-- Feijoa). Excluded from spending and budgets; shown as "Saved this month".
--
-- Idempotent: safe on a fresh install (where the init migration already has
-- these) and on a database that ran the earlier migrations before this change.
-- The app adds the Savings category + rules for an existing owner on next load.

alter table public.categories drop constraint if exists categories_kind_check;
alter table public.categories add constraint categories_kind_check
  check (kind in ('expense','income','transfer','savings'));

alter table public.settings add column if not exists monthly_savings_goal numeric(14,2);
alter table public.settings drop constraint if exists settings_monthly_savings_goal_check;
alter table public.settings add constraint settings_monthly_savings_goal_check
  check (monthly_savings_goal >= 0);
