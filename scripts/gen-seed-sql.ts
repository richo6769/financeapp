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
  (r, i) => `    (${(q(r.pattern) + ",").padEnd(pw)} ${(q(r.category) + ",").padEnd(cw)} ${100 + i})`,
).join(",\n");

const sql = `-- Seed default NZ categories + starter rules for every new user (runs on
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
${cats};

  insert into public.rules (user_id, pattern, field, match_type, category_id, priority)
  select uid, r.pattern, 'any', 'contains', c.id, r.priority
  from (values
${rules}
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
`;
fs.writeFileSync("supabase/migrations/20260924000100_seed_defaults.sql", sql);
console.log(`wrote ${DEFAULT_CATEGORIES.length} categories, ${DEFAULT_RULES.length} rules`);
