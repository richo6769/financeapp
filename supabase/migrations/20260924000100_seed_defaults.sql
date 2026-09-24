-- Seed default NZ categories + starter rules for every new user (runs on
-- first sign-up). The app also seeds lazily if categories are empty, so this
-- is idempotent and safe to re-run for an existing user:
--   select public.seed_user_defaults('<your auth.users id>');

create or replace function public.seed_user_defaults(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.categories where user_id = uid) then
    return;
  end if;

  insert into public.categories (user_id, name, kind, color, is_system) values
    (uid, 'Groceries',      'expense',  '#16a34a', false),
    (uid, 'Eating Out',     'expense',  '#f97316', false),
    (uid, 'Transport',      'expense',  '#0ea5e9', false),
    (uid, 'Fuel',           'expense',  '#eab308', false),
    (uid, 'Rent/Housing',   'expense',  '#8b5cf6', false),
    (uid, 'Utilities',      'expense',  '#06b6d4', false),
    (uid, 'Subscriptions',  'expense',  '#ec4899', false),
    (uid, 'Shopping',       'expense',  '#f43f5e', false),
    (uid, 'Health/Fitness', 'expense',  '#10b981', false),
    (uid, 'Travel',         'expense',  '#3b82f6', false),
    (uid, 'Entertainment',  'expense',  '#a855f7', false),
    (uid, 'Income',         'income',   '#22c55e', true),
    (uid, 'Transfers',      'transfer', '#64748b', true),
    (uid, 'Other',          'expense',  '#94a3b8', false);

  insert into public.rules (user_id, pattern, field, match_type, category_id, priority)
  select uid, r.pattern, 'any', 'contains', c.id, r.priority
  from (values
    ('countdown',  'Groceries',     100),
    ('woolworths', 'Groceries',     101),
    ('new world',  'Groceries',     102),
    ('pak n save', 'Groceries',     103),
    ('paknsave',   'Groceries',     104),
    ('uber eats',  'Eating Out',    105),
    ('z energy',   'Fuel',          106),
    ('bp connect', 'Fuel',          107),
    ('netflix',    'Subscriptions', 108),
    ('spotify',    'Subscriptions', 109)
  ) as r(pattern, category, priority)
  join public.categories c on c.user_id = uid and c.name = r.category and c.parent_id is null;

  insert into public.settings (user_id) values (uid) on conflict do nothing;
end $$;

revoke all on function public.seed_user_defaults(uuid) from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_user_defaults(new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
