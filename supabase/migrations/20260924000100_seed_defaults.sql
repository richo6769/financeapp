-- Single-owner guard + default NZ categories and starter rules.
--
-- 1) OWNER GUARD. After running this file, register your email ONCE:
--      insert into public.app_owner (email) values ('you@example.com');
--    From then on the database refuses to create any other auth user, even
--    if someone calls Supabase's sign-up API directly with the anon key.
--    (Also turn off "Allow new users to sign up" in Supabase after your first
--    login — see README.)
--
-- 2) SEED. Every new (owner) user gets the default categories + rules on
--    first sign-up. The app also seeds lazily if categories are empty, so
--    this is idempotent:  select public.seed_user_defaults('<auth.users id>');
--
-- Generated from lib/seed.ts by scripts/gen-seed-sql.ts — edit there.
-- Rules: lower priority wins, so specific patterns come first ('uber eats' →
-- Takeaways beats 'uber' → Transport/Fuel). 'word' = whole-word match (used
-- for patterns of ≤5 characters and ones like 'spark' or 'tower' that appear
-- inside other words); exclude_words vetoes a match ('tower' ⟂ 'sky').

-- ------------------------------------------------------------ owner guard
create table public.app_owner (
  id boolean primary key default true check (id),   -- at most one row
  email text not null check (email = lower(email) and position('@' in email) > 1)
);
alter table public.app_owner enable row level security;  -- no policies: invisible to anon/authenticated

create or replace function public.owner_email() returns text
language sql stable security definer set search_path = public as $$
  select email from public.app_owner where id
$$;
revoke all on function public.owner_email() from public, anon, authenticated;

create or replace function public.enforce_single_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner text := public.owner_email();
begin
  if owner is not null and lower(coalesce(new.email, '')) <> owner then
    raise exception 'Sign-ups are disabled for this app';
  end if;
  return new;
end $$;
revoke all on function public.enforce_single_owner() from public, anon, authenticated;

drop trigger if exists enforce_single_owner on auth.users;
create trigger enforce_single_owner
  before insert or update of email on auth.users
  for each row execute function public.enforce_single_owner();

-- ------------------------------------------------------------------ seed
create or replace function public.seed_user_defaults(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare owner text := public.owner_email();
begin
  -- Never seed for anyone but the owner (once the owner is registered).
  if owner is not null and not exists (select 1 from auth.users where id = uid and lower(email) = owner) then
    return;
  end if;
  if exists (select 1 from public.categories where user_id = uid) then
    return;
  end if;

  insert into public.categories (user_id, name, kind, color, is_system) values
    (uid, 'Groceries',         'expense',  '#16a34a', false),
    (uid, 'Eating Out',        'expense',  '#f97316', false),
    (uid, 'Takeaways',         'expense',  '#fb923c', false),
    (uid, 'Bars',              'expense',  '#d97706', false),
    (uid, 'Liquor Stores',     'expense',  '#b45309', false),
    (uid, 'Sports',            'expense',  '#65a30d', false),
    (uid, 'Travel',            'expense',  '#3b82f6', false),
    (uid, 'Entertainment',     'expense',  '#a855f7', false),
    (uid, 'Health & Wellness', 'expense',  '#10b981', false),
    (uid, 'Home Supplies',     'expense',  '#78716c', false),
    (uid, 'Rent',              'expense',  '#8b5cf6', false),
    (uid, 'Transport/Fuel',    'expense',  '#0ea5e9', false),
    (uid, 'Subscriptions',     'expense',  '#ec4899', false),
    (uid, 'Clothes/Shopping',  'expense',  '#f43f5e', false),
    (uid, 'Bills',             'expense',  '#06b6d4', false),
    (uid, 'Insurance',         'expense',  '#6366f1', false),
    (uid, 'Other',             'expense',  '#94a3b8', false),
    (uid, 'Salary',            'income',   '#22c55e', true),
    (uid, 'Transfers',         'transfer', '#64748b', true),
    (uid, 'Savings',           'savings',  '#0d9488', true);

  insert into public.rules (user_id, pattern, match_type, exclude_words, field, category_id, priority)
  select uid, r.pattern, r.match_type, r.exclude_words, 'any', c.id, r.priority
  from (values
    ('sharesies',          'contains', null,              'Savings',           100),
    ('feijoa',             'contains', null,              'Savings',           101),
    ('uber eats',          'contains', null,              'Takeaways',         102),
    ('doordash',           'contains', null,              'Takeaways',         103),
    ('delivereasy',        'contains', null,              'Takeaways',         104),
    ('mcdonalds',          'contains', null,              'Takeaways',         105),
    ('kfc',                'word',     null,              'Takeaways',         106),
    ('burger king',        'contains', null,              'Takeaways',         107),
    ('dominos',            'contains', null,              'Takeaways',         108),
    ('pizza hut',          'contains', null,              'Takeaways',         109),
    ('subway',             'word',     null,              'Takeaways',         110),
    ('woolworths',         'contains', null,              'Groceries',         111),
    ('countdown',          'contains', null,              'Groceries',         112),
    ('new world',          'contains', null,              'Groceries',         113),
    ('pak n save',         'contains', null,              'Groceries',         114),
    ('paknsave',           'contains', null,              'Groceries',         115),
    ('four square',        'contains', null,              'Groceries',         116),
    ('freshchoice',        'contains', null,              'Groceries',         117),
    ('super liquor',       'contains', null,              'Liquor Stores',     118),
    ('liquorland',         'contains', null,              'Liquor Stores',     119),
    ('liquor king',        'contains', null,              'Liquor Stores',     120),
    ('bottle-o',           'contains', null,              'Liquor Stores',     121),
    ('glengarry',          'contains', null,              'Liquor Stores',     122),
    ('auckland transport', 'contains', null,              'Transport/Fuel',    123),
    ('at hop',             'contains', null,              'Transport/Fuel',    124),
    ('z energy',           'contains', null,              'Transport/Fuel',    125),
    ('bp',                 'word',     null,              'Transport/Fuel',    126),
    ('mobil',              'word',     null,              'Transport/Fuel',    127),
    ('gull',               'word',     null,              'Transport/Fuel',    128),
    ('waitomo',            'contains', null,              'Transport/Fuel',    129),
    ('uber',               'word',     null,              'Transport/Fuel',    130),
    ('netflix',            'contains', null,              'Subscriptions',     131),
    ('spotify',            'contains', null,              'Subscriptions',     132),
    ('disney',             'contains', null,              'Subscriptions',     133),
    ('neon',               'word',     null,              'Subscriptions',     134),
    ('amazon prime',       'contains', null,              'Subscriptions',     135),
    ('apple.com',          'contains', null,              'Subscriptions',     136),
    ('chemist warehouse',  'contains', null,              'Health & Wellness', 137),
    ('unichem',            'contains', null,              'Health & Wellness', 138),
    ('life pharmacy',      'contains', null,              'Health & Wellness', 139),
    ('les mills',          'contains', null,              'Health & Wellness', 140),
    ('cityfitness',        'contains', null,              'Health & Wellness', 141),
    ('snap fitness',       'contains', null,              'Health & Wellness', 142),
    ('anytime fitness',    'contains', null,              'Health & Wellness', 143),
    ('bunnings',           'contains', null,              'Home Supplies',     144),
    ('mitre 10',           'contains', null,              'Home Supplies',     145),
    ('briscoes',           'contains', null,              'Home Supplies',     146),
    ('kmart',              'word',     null,              'Clothes/Shopping',  147),
    ('the warehouse',      'contains', null,              'Clothes/Shopping',  148),
    ('farmers',            'word',     'market,markets',  'Clothes/Shopping',  149),
    ('hallenstein',        'contains', null,              'Clothes/Shopping',  150),
    ('spark',              'word',     null,              'Bills',             151),
    ('one nz',             'contains', null,              'Bills',             152),
    ('2degrees',           'contains', null,              'Bills',             153),
    ('mercury',            'word',     null,              'Bills',             154),
    ('genesis',            'word',     null,              'Bills',             155),
    ('contact energy',     'contains', null,              'Bills',             156),
    ('watercare',          'contains', null,              'Bills',             157),
    ('aa insurance',       'contains', null,              'Insurance',         158),
    ('southern cross',     'contains', null,              'Insurance',         159),
    ('state insurance',    'word',     null,              'Insurance',         160),
    ('tower',              'word',     'sky',             'Insurance',         161),
    ('ami',                'word',     null,              'Insurance',         162),
    ('air new zealand',    'contains', null,              'Travel',            163),
    ('jetstar',            'contains', null,              'Travel',            164),
    ('booking.com',        'contains', null,              'Travel',            165),
    ('airbnb',             'contains', null,              'Travel',            166),
    ('agoda',              'word',     null,              'Travel',            167),
    ('event cinemas',      'contains', null,              'Entertainment',     168),
    ('hoyts',              'word',     null,              'Entertainment',     169),
    ('ticketmaster',       'contains', null,              'Entertainment',     170),
    ('deloitte',           'contains', null,              'Salary',            171),
    ('zuru',               'word',     null,              'Salary',            172)
  ) as r(pattern, match_type, exclude_words, category, priority)
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
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
