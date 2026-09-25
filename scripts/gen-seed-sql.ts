/**
 * Regenerates supabase/migrations/20260924000100_seed_defaults.sql from the
 * single source of truth in lib/seed.ts.   npx tsx --conditions=react-server scripts/gen-seed-sql.ts
 */
import fs from "node:fs";
import { DEFAULT_CATEGORIES, DEFAULT_RULES, SYSTEM_CATEGORIES } from "@/lib/seed";

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const w = Math.max(...DEFAULT_CATEGORIES.map((c) => c.name.length)) + 3;
const cats = DEFAULT_CATEGORIES.map(
  (c) =>
    `    (uid, ${(q(c.name) + ",").padEnd(w)} ${(q(c.kind) + ",").padEnd(11)} ${q(c.color)}, ${SYSTEM_CATEGORIES.includes(c.name)})`,
).join(",\n");
const pw = Math.max(...DEFAULT_RULES.map((r) => r.pattern.length)) + 3;
const cw = Math.max(...DEFAULT_RULES.map((r) => r.category.length)) + 3;
const rules = DEFAULT_RULES.map(
  (r, i) =>
    `    (${(q(r.pattern) + ",").padEnd(pw)} ${(q(r.match_type) + ",").padEnd(11)} ${((r.exclude_words ? q(r.exclude_words) : "null") + ",").padEnd(18)} ${(q(r.category) + ",").padEnd(cw)} ${100 + i})`,
).join(",\n");

const sql = `-- Single-owner guard + default NZ categories and starter rules.
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
${cats};

  insert into public.rules (user_id, pattern, match_type, exclude_words, field, category_id, priority)
  select uid, r.pattern, r.match_type, r.exclude_words, 'any', c.id, r.priority
  from (values
${rules}
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
`;
fs.writeFileSync("supabase/migrations/20260924000100_seed_defaults.sql", sql);
console.log(`wrote ${DEFAULT_CATEGORIES.length} categories, ${DEFAULT_RULES.length} rules`);
