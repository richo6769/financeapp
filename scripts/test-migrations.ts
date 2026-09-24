/**
 * Runs every Supabase migration, in order, against PGlite (real Postgres in
 * WASM) with a minimal stand-in for Supabase's `auth` schema, then checks the
 * owner guard, seed trigger, RLS, constraints and the reimbursement trigger.
 *   npx tsx scripts/test-migrations.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = fs
  .readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();

const OWNER = "11111111-1111-1111-1111-111111111111";
const INTRUDER = "22222222-2222-2222-2222-222222222222";
let passed = 0;
const ok = (m: string) => {
  passed++;
  console.log(`  ✓ ${m}`);
};

async function rejects(db: PGlite, sql: string, re: RegExp, params: unknown[] = []) {
  await assert.rejects(db.query(sql, params), re);
}

async function main() {
  const db = new PGlite();
  // Minimal Supabase auth stand-in.
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
  `);
  for (const f of MIGRATIONS) {
    try {
      await db.exec(fs.readFileSync(path.join("supabase/migrations", f), "utf8"));
    } catch (err) {
      throw new Error(`${f} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    grant all on all tables in schema public to authenticated;
    grant execute on function auth.uid() to authenticated, anon;
  `);
  ok(`all ${MIGRATIONS.length} migrations run cleanly in order: ${MIGRATIONS.join(", ")}`);

  // Seed trigger on first sign-up.
  await db.query(`insert into auth.users (id, email) values ($1, 'me@example.nz')`, [OWNER]);
  const cats = await db.query<{ n: number }>(`select count(*)::int n from public.categories where user_id = $1`, [OWNER]);
  const rules = await db.query<{ pattern: string; match_type: string; exclude_words: string | null; priority: number }>(
    `select pattern, match_type, exclude_words, priority from public.rules where user_id = $1`,
    [OWNER],
  );
  assert.equal(cats.rows[0].n, 19);
  assert.equal(rules.rows.length, 71);
  const r = (p: string) => rules.rows.find((x) => x.pattern === p)!;
  assert.equal(r("bp").match_type, "word");
  assert.equal(r("tower").exclude_words, "sky");
  assert.equal(r("uber eats").match_type, "contains");
  assert.ok(r("uber eats").priority < r("uber").priority);
  ok("seed trigger: 19 categories + 71 rules on sign-up (bp=word, tower excludes 'sky', uber eats before uber)");

  // Owner guard: once registered, no other user can be created.
  await db.query(`insert into public.app_owner (email) values ('me@example.nz')`);
  await rejects(db, `insert into auth.users (id, email) values ($1, 'attacker@example.com')`, /Sign-ups are disabled/, [INTRUDER]);
  await rejects(db, `update auth.users set email = 'other@example.com' where id = $1`, /Sign-ups are disabled/, [OWNER]);
  await rejects(db, `insert into public.app_owner (email) values ('second@example.nz')`, /duplicate key|violates/);
  ok("owner guard: other sign-ups and email changes rejected by the database; only one owner row");

  // Constraints.
  const catId = (await db.query<{ id: string }>(`select id from public.categories where user_id = $1 limit 1`, [OWNER])).rows[0].id;
  await rejects(db, `insert into public.rules (user_id, pattern, match_type, category_id) values ($1, 'x', 'fuzzy', $2)`, /check constraint/, [OWNER, catId]);
  await rejects(db, `insert into public.rules (user_id, pattern, category_id) values ($1, repeat('a', 101), $2)`, /check constraint/, [OWNER, catId]);
  await rejects(db, `insert into public.trips (user_id, name, start_date, end_date) values ($1, 'x', '2026-12-26', '2026-12-01')`, /check constraint/, [OWNER]);
  await rejects(db, `insert into public.settings (user_id, pay_frequency) values ($1, 'daily') on conflict (user_id) do update set pay_frequency = excluded.pay_frequency`, /check constraint/, [OWNER]);
  ok("check constraints: match_type incl. 'word', pattern ≤100 chars, trip dates, pay frequency");

  // Reimbursement trigger (runs the SELECT … FOR UPDATE path).
  const tx = async (desc: string, amount: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.transactions (user_id, date, local_date, description, amount) values ($1, now(), current_date, $2, $3) returning id`,
        [OWNER, desc, amount],
      )
    ).rows[0].id;
  const snus = await tx("SNUS DIRECT", "-365.00");
  const sam = await tx("SAM WILSON", "100.00");
  const mia = await tx("MIA CHEN", "150.00");
  const link = (e: string, i: string, amt: string) =>
    db.query(`insert into public.reimbursement_links (user_id, expense_id, income_id, amount) values ($1, $2, $3, $4)`, [OWNER, e, i, amt]);
  await link(snus, sam, "100.00");
  await assert.rejects(link(snus, mia, "265.01"), /exceed the expense/);
  await link(snus, mia, "150.00");
  const other = await tx("OTHER", "-50.00");
  await assert.rejects(link(other, sam, "0.01"), /exceed the incoming/);
  await assert.rejects(link(sam, snus, "1.00"), /Only an expense/);
  await assert.rejects(link(snus, other, "1.00"), /Only incoming money/);
  await assert.rejects(
    db.query(`update public.reimbursement_links set amount = 101 where expense_id = $1 and income_id = $2`, [snus, sam]),
    /exceed the incoming/,
  );
  ok("reimbursement trigger (with row locks): blocks over-allocation of expense and payment, wrong directions, and over-allocating updates");

  // IOU constraint.
  await rejects(db, `insert into public.ious (user_id, expense_id, person_name, amount, settled_amount) values ($1, $2, 'Sam', 10, 11)`, /check constraint/, [OWNER, snus]);
  ok("ious: settled_amount can't exceed amount");

  // RLS: as the authenticated role, only your own rows are visible/writable.
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);
  const mine = await db.query<{ n: number }>(`select count(*)::int n from public.categories`);
  assert.equal(mine.rows[0].n, 19);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [INTRUDER]);
  const theirs = await db.query<{ n: number }>(`select count(*)::int n from public.transactions`);
  assert.equal(theirs.rows[0].n, 0, "another user sees nothing");
  await rejects(db, `insert into public.categories (user_id, name) values ($1, 'Hack')`, /row-level security/, [OWNER]);
  const upd = await db.query(`update public.transactions set amount = 0 where user_id = $1`, [OWNER]);
  assert.equal(upd.affectedRows ?? 0, 0);
  // RLS on with no policies: the owner row is invisible to clients (0 rows).
  const hidden = await db.query(`select * from public.app_owner`);
  assert.equal(hidden.rows.length, 0);
  await rejects(db, `insert into public.app_owner (email) values ('x@y.z')`, /row-level security|duplicate|violates/);
  await db.exec(`reset role`);
  const owner = await db.query<{ n: number }>(`select count(*)::int n from public.app_owner`);
  assert.equal(owner.rows[0].n, 1);
  ok("RLS: another user id can't read, insert as, or update the owner's rows; app_owner isn't readable by clients");

  console.log(`\nAll ${passed} migration checks passed.`);
}

main().catch((e) => {
  console.error("\n✗ FAILED:", e);
  process.exitCode = 1;
});
