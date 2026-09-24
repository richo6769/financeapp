-- Seed default NZ categories + starter rules for every new user (runs on
-- first sign-up). The app also seeds lazily if categories are empty, so this
-- is idempotent and safe to re-run for an existing user:
--   select public.seed_user_defaults('<your auth.users id>');
--
-- Generated from lib/seed.ts by scripts/gen-seed-sql.ts — edit there.
-- Rules: contains-match; lower priority wins, so specific patterns come first
-- (e.g. 'uber eats' → Takeaways beats 'uber' → Transport/Fuel).

create or replace function public.seed_user_defaults(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
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
    (uid, 'Transfers',         'transfer', '#64748b', true);

  insert into public.rules (user_id, pattern, field, match_type, category_id, priority)
  select uid, r.pattern, 'any', 'contains', c.id, r.priority
  from (values
    ('uber eats',          'Takeaways',         100),
    ('doordash',           'Takeaways',         101),
    ('delivereasy',        'Takeaways',         102),
    ('mcdonalds',          'Takeaways',         103),
    ('kfc',                'Takeaways',         104),
    ('burger king',        'Takeaways',         105),
    ('dominos',            'Takeaways',         106),
    ('pizza hut',          'Takeaways',         107),
    ('subway',             'Takeaways',         108),
    ('woolworths',         'Groceries',         109),
    ('countdown',          'Groceries',         110),
    ('new world',          'Groceries',         111),
    ('pak n save',         'Groceries',         112),
    ('paknsave',           'Groceries',         113),
    ('four square',        'Groceries',         114),
    ('freshchoice',        'Groceries',         115),
    ('super liquor',       'Liquor Stores',     116),
    ('liquorland',         'Liquor Stores',     117),
    ('liquor king',        'Liquor Stores',     118),
    ('bottle-o',           'Liquor Stores',     119),
    ('glengarry',          'Liquor Stores',     120),
    ('auckland transport', 'Transport/Fuel',    121),
    ('at hop',             'Transport/Fuel',    122),
    ('z energy',           'Transport/Fuel',    123),
    ('bp',                 'Transport/Fuel',    124),
    ('mobil',              'Transport/Fuel',    125),
    ('gull',               'Transport/Fuel',    126),
    ('waitomo',            'Transport/Fuel',    127),
    ('uber',               'Transport/Fuel',    128),
    ('netflix',            'Subscriptions',     129),
    ('spotify',            'Subscriptions',     130),
    ('disney',             'Subscriptions',     131),
    ('neon',               'Subscriptions',     132),
    ('amazon prime',       'Subscriptions',     133),
    ('apple.com',          'Subscriptions',     134),
    ('chemist warehouse',  'Health & Wellness', 135),
    ('unichem',            'Health & Wellness', 136),
    ('life pharmacy',      'Health & Wellness', 137),
    ('les mills',          'Health & Wellness', 138),
    ('cityfitness',        'Health & Wellness', 139),
    ('snap fitness',       'Health & Wellness', 140),
    ('anytime fitness',    'Health & Wellness', 141),
    ('bunnings',           'Home Supplies',     142),
    ('mitre 10',           'Home Supplies',     143),
    ('briscoes',           'Home Supplies',     144),
    ('kmart',              'Clothes/Shopping',  145),
    ('the warehouse',      'Clothes/Shopping',  146),
    ('farmers',            'Clothes/Shopping',  147),
    ('hallenstein',        'Clothes/Shopping',  148),
    ('spark',              'Bills',             149),
    ('one nz',             'Bills',             150),
    ('2degrees',           'Bills',             151),
    ('mercury',            'Bills',             152),
    ('genesis',            'Bills',             153),
    ('contact energy',     'Bills',             154),
    ('watercare',          'Bills',             155),
    ('aa insurance',       'Insurance',         156),
    ('southern cross',     'Insurance',         157),
    ('state insurance',    'Insurance',         158),
    ('tower',              'Insurance',         159),
    ('ami',                'Insurance',         160),
    ('air new zealand',    'Travel',            161),
    ('jetstar',            'Travel',            162),
    ('booking.com',        'Travel',            163),
    ('airbnb',             'Travel',            164),
    ('agoda',              'Travel',            165),
    ('event cinemas',      'Entertainment',     166),
    ('hoyts',              'Entertainment',     167),
    ('ticketmaster',       'Entertainment',     168),
    ('deloitte',           'Salary',            169),
    ('zuru',               'Salary',            170)
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
