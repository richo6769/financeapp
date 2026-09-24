# Kiwi Ledger

A single-user personal finance tracker for New Zealand (NZD, Pacific/Auckland).
It pulls ANZ + American Express data from **Akahu**, categorises it with your
own rules, tracks monthly budgets, and has a **Claude-powered chat** that
updates the app from plain English.

**It runs with zero keys.** Without keys you get realistic mock ANZ + Amex data,
a local JSON data store and an offline chat that uses the same tools. Add keys
one at a time to switch each piece to live.

| Piece | No key (default) | With key |
|---|---|---|
| Bank data | Mock ANZ everyday/savings + Amex (13 months, deterministic) | Akahu API |
| Database/auth | `.data/db.json`, no login | Supabase Postgres + magic link, RLS on every table |
| Chat | Offline pattern-matcher (handles the example phrases) | Claude (`claude-sonnet-5`) with tool use |

---

## Quick start (local, no keys)

```bash
npm install
npm run dev          # http://localhost:3000 → "Run first sync"
npm test             # mock-data suite + features + Claude loop (fake API) + migrations in PGlite
npm run test:race    # optional: concurrency test against a real Postgres (PGHOST/PGPORT/PGUSER)
npm run build        # production build + type check
npm run check-env    # shows which integrations are live vs mock
npm run gen:seed     # regenerate the seed migration after editing lib/seed.ts
```

---

## Architecture

```
app/                       Next.js App Router (mobile-first UI + route handlers)
  page.tsx                 Dashboard: budgets, totals, days left, top merchants, 6-month trend, pending, accounts
  transactions/            Search + filters (account/category/date) + inline recategorise + add cash
  inbox/                   Uncategorised triage
  budgets/  rules/         Category/subcategory CRUD, budgets, overall cap, rules
  chat/                    Chat UI (history persisted)
  api/…                    JSON endpoints (all server-side; tokens never reach the browser)
  api/cron/sync            Daily Vercel cron (Bearer CRON_SECRET)
proxy.ts                   Refreshes Supabase session, redirects to /login (Next 16 "proxy" = middleware)
lib/
  env.ts                   Every env check lives here (mock vs live decisions)
  store/                   Store interface → SupabaseStore (RLS) | LocalStore (JSON, demo)
  akahu/                   LiveAkahuClient (cursor pagination, retries) | MockAkahuClient
  sync.ts                  Incremental sync, upsert on Akahu _id, pending replacement, transfer pairing
  categorise.ts            Rules engine, transfer detection, Akahu hint mapping, merchant memory
  services.ts              Budgets, categories, rules, spending analytics (shared by UI + chat)
  reimburse.ts             "Net off": link incoming money to expenses; net amounts for all totals
  chat/tools.ts            10 Claude tools (zod-validated) + server-enforced confirmation tokens
  chat/agent.ts            Claude tool-use loop + per-turn app context
  chat/mock.ts             Offline planner used when ANTHROPIC_API_KEY is missing
supabase/migrations/       Schema + RLS + default-category seed trigger
scripts/test-*.ts          End-to-end tests against mock data (incl. a fake Claude API server)
```

**Data model:** `accounts`, `transactions`, `pending_transactions`, `categories`
(with `parent_id` for subcategories), `rules`, `budgets`, `settings` (overall
cap, pay cycle), `chat_messages`, `sync_log`, `reimbursement_links` (Net off),
`ious`, `netoff_suggestions`, `trips`, `trip_transactions`, `subscription_prefs`,
`weekly_caps`, `weekly_recaps`, and `app_owner` (single-owner guard). Every table has `user_id` + RLS policies
`user_id = auth.uid()` (enabled, not forced).

### How sync works
Everything is fetched and validated **before anything is written**, so a failed or
partial sync never changes existing data. Akahu 429/5xx/network errors back off
(Retry-After honoured, 5 attempts); token errors show a clear message on
Settings → Bank sync.
1. Upsert accounts (`GET /accounts`); accounts Akahu stops returning are flagged
   *missing* (history kept).
2. Range: first sync backfills **12 months**; later syncs start 7 days before the
   newest stored transaction (overlap catches late-settling items).
3. `GET /transactions?start&end`, following `cursor.next` until exhausted.
4. Upsert on Akahu `_id` (unique) → re-running never duplicates.
5. New/uncategorised rows are categorised; existing decisions are kept.
6. Internal transfers are paired (equal & opposite amounts on two of your accounts within 3 days).
7. `GET /transactions/pending` replaces the pending table wholesale (pending items have no stable id; they reappear with an `_id` once settled).
8. Settled transactions the bank later removes are flagged `removed_at` (excluded,
   never deleted; restored if they reappear). Amounts the bank edits are updated,
   and any net-off link that no longer fits is removed.
9. Suggested net offs are generated for new incoming money.
10. A `sync_log` row records the result + warnings. Triggered by **Sync now** or the daily cron.

### Categorisation precedence
**Your manual choice › your rules › own-account transfer detection › merchant memory › Akahu enrichment hint › Uncategorised.**
- Transfers between your accounts and **Amex repayments from ANZ** (plus the
  matching "PAYMENT RECEIVED" credit on the card) are tagged **Transfers** and
  excluded from all spending totals.
- **Refunds** keep their merchant's category and count as negative spend.
- Recategorising a transaction offers **"Apply to all from this merchant"**,
  which updates past transactions and creates a rule.

### Default categories & starter rules
**Expense:** Groceries, Eating Out, Takeaways, Bars, Liquor Stores, Sports, Travel,
Entertainment, Health & Wellness, Home Supplies, Rent, Transport/Fuel,
Subscriptions, Clothes/Shopping, Bills, Insurance, Other.
**Income:** Salary. **Transfer:** Transfers.

71 starter rules (contains-match) cover common NZ merchants — see `DEFAULT_RULES`
in `lib/seed.ts`, the single source of truth. More specific patterns get a lower
priority number so they win (`uber eats` → Takeaways beats `uber` → Transport/Fuel).
After editing the list run `npx tsx --conditions=react-server scripts/gen-seed-sql.ts`
to regenerate the seed migration (the tests fail if the two drift apart).
Akahu hints map pubs/bars → Bars and fast food/takeaway → Takeaways.

### Net off (reimbursements)
When a mate pays you back, tap **Net off** on the expense, search incoming money
(name, amount, date — newest first) and link all or part of a payment. One
payment can be split across several expenses and one expense can take several
payments. The expense then counts at its **net** amount everywhere (category
spend, budgets, trend, chat answers): $365 at Snus Direct − $100 from Sam =
**$265**. The linked part of the incoming money is excluded from Salary/income so
it isn't counted twice; any remainder still counts. You can unlink at any time.
Links can't exceed the expense or the incoming amount (checked in the app and by
a database trigger).

### IOUs, suggested net offs, trips, pay cycle, subscriptions, caps, recaps
- **IOUs** — tap **IOU** on an expense ("Sam owes me $100") or tell the chat. When
  a payment whose bank line names that person is netted off against the expense,
  the IOU settles automatically; partial payments reduce the balance and
  unlinking re-opens it exactly. **Owed to me** groups open IOUs by person with age.
- **Suggested net offs** — after each sync, new incoming money that isn't Salary,
  a transfer or a merchant refund is matched to expenses from the previous 14
  days: an open IOU naming the payer scores highest, then amounts equal to the
  whole, half, a third or a quarter of an expense (±1c), then recency. They
  appear on the dashboard and at the top of the Inbox with **Accept / Dismiss**.
  Nothing is ever linked without Accept, and dismissed ones never come back.
- **Trips** — transactions in the trip dates that are foreign-currency or Travel
  are tagged automatically (or tick "include ALL spending"); add/remove any
  transaction by hand. Akahu's original currency/amount is shown beside the NZD.
  With *Keep out of monthly budgets* on (default), trip spending doesn't count
  toward monthly or weekly budgets. Trip page: total vs budget, spend per day,
  by category, daily average vs what you can spend per day.
- **Pay cycle** — set weekly/fortnightly/monthly + a payday in Settings (or tap
  *Detect from Salary*, which reads Salary-category credits, so an employer
  change like Deloitte → ZURU doesn't matter). The dashboard toggles between
  calendar month and pay cycle; budgets pro-rate (×12/52 weekly, ×12/26 fortnightly).
- **Subscriptions** — same merchant, amounts within ±10%, a weekly/fortnightly/
  monthly/yearly rhythm, 3+ charges (2 for yearly). Flags price rises >5%, new
  subscriptions and expected charges that didn't arrive. "Not a subscription"
  hides it for good.
- **Weekly caps** — optional per category (Mon–Sun NZ time), set on Budgets or by
  chat ("cap bars at 80 a week"). Dashboard banners at 80% and 100%.
- **Weekly recap** — every Monday the daily cron also writes last week's recap
  (no second cron job). Every figure is computed in code; Claude only writes 3–5
  sentences from them, and if its text contains any number that isn't in the
  facts, the app uses the deterministic template instead.

### Chatbot
Tools: `create_category`, `update_category`, `delete_category`, `set_budget`,
`create_rule`, `recategorise_transactions`, `add_manual_transaction`,
`query_spending`, `get_budget_status`, `link_reimbursement`, `create_iou`,
`list_ious`, `cancel_iou`, `create_trip`, `trip_status`, `set_weekly_cap`,
`weekly_status`, `list_subscriptions`.
- Bank text (descriptions, merchant and payer names) is treated as untrusted data:
  it's clipped and stripped of control characters before reaching the model, and
  the system prompt tells Claude never to follow instructions inside it. Every
  tool validates its input with zod server-side; destructive/bulk tools still
  need a confirmation token from a previous turn.
- "The $100 from Sam was for Snus Direct" / "Jack paid me back half of dinner at Soul Bar"
  match by name, amount and date; if more than one transaction matches, it asks which one before linking.
- Each turn gets the current categories, budgets, rules and this month's summary as context.
- Weekly/fortnightly amounts are converted (×52/12, ×26/12) and the maths is shown.
- Spending answers always come from `query_spending` / `get_budget_status` (real DB numbers).
- **Confirmation is enforced server-side**, not just by prompt: deleting a category or
  changing 20+ transactions returns a preview + `confirmation_token`. The change only
  runs when a later request carries a token issued in a *previous* turn — i.e. after you
  replied. The model can't self-confirm.

---

## Setup for real data

### 1. Supabase
1. Create a project at <https://supabase.com> (region: Sydney is closest).
2. **SQL Editor** → run the files in `supabase/migrations/` in order:
   `20260924000000_init.sql`, `20260924000100_seed_defaults.sql`,
   `20260925000000_reimbursement_links.sql`, `20260926000000_features.sql`.
   (Or with the CLI: `supabase link --project-ref <ref> && supabase db push`.)
3. **Register yourself as the only owner** (SQL Editor, once, with your email in lower case):
   ```sql
   insert into public.app_owner (email) values ('you@example.com');
   ```
   From then on the database refuses to create any other user, even if someone
   calls Supabase's sign-up API directly with your public anon key.
4. **Authentication → Providers → Email**: enabled (magic link is the default).
5. **Authentication → URL Configuration**: set *Site URL* to your Vercel URL and add
   `http://localhost:3000/auth/callback` and `https://<your-app>.vercel.app/auth/callback`
   to *Redirect URLs*.
6. **Project Settings → API**: copy *Project URL*, *anon public* key and
   *service_role* key into your env (below).
7. **After your first login, turn off sign-ups:** Authentication → Sign In / Providers →
   untick **Allow new users to sign up**. This is the third layer: the app only
   accepts `OWNER_EMAIL` on every route, the proxy and the cron, and the database
   trigger above blocks other accounts.

Default categories + starter rules are seeded automatically on first sign-in.

### 2. Akahu tokens
1. Sign in at <https://my.akahu.nz> and connect ANZ and American Express.
2. Go to <https://my.akahu.nz/developers> → create a **Personal App**.
3. Copy the **App ID Token** (`app_token_…`) → `AKAHU_APP_TOKEN`
   and the **User Access Token** (`user_token_…`) → `AKAHU_USER_TOKEN`.
4. Tokens are only read in server code (`lib/env.ts`, `lib/akahu/live.ts`) and are
   never sent to the browser. Live mode also requires Supabase, so real bank data
   is always behind login.

### 3. Anthropic
Create a key at <https://console.anthropic.com> → `ANTHROPIC_API_KEY`.

### 4. Environment variables
Copy `.env.example` → `.env.local` and fill in. See the file for every variable.
Run `npm run check-env` to confirm what's live.

### 5. Deploy to Vercel
1. Push this repo to GitHub, then **Vercel → Add New Project → Import**.
2. Framework: Next.js (auto). Add all env vars from `.env.example` under
   **Settings → Environment Variables** (Production + Preview).
3. Deploy, then add the deployed URL to Supabase redirect URLs (step 1.4).

### 6. Cron
`vercel.json` schedules `GET /api/cron/sync` at **17:00 UTC daily** (5am NZST / 6am NZDT).
Set `CRON_SECRET` in Vercel; Vercel automatically sends it as
`Authorization: Bearer <CRON_SECRET>`. The cron needs `SUPABASE_SERVICE_ROLE_KEY`
and `OWNER_EMAIL` to find your user. Test manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/cron/sync
```

(Hobby plans allow one run per day, which is what this uses.)

### Switching from mock to live
Add the Akahu tokens (with Supabase configured) and redeploy / restart. On the
first live sync the app **automatically deletes the mock accounts and
transactions** (ids prefixed `acc_mock_` / `trans_mock_`) and backfills 12
months of real data. Your categories, rules, budgets and chat history are kept.
Set `AKAHU_MODE=mock` to force mock data even with tokens present.

### Install on your phone
Open the site in Safari (iOS) → Share → **Add to Home Screen**, or in Chrome
(Android) → **Install app**.

---

## Assumptions

- **Single user.** One Supabase user identified by `OWNER_EMAIL`; any other email is refused. `OWNER_EMAIL` is required once Supabase is configured.
- **Sign convention:** Akahu's — debits negative, credits positive. Budgets and spend are shown as positive numbers.
- **Money maths** is done in integer cents end to end (sums, splits, conversions, pro-rating); dollars only appear at the edges for JSON/display.
- **Time zone:** every date is a Pacific/Auckland calendar date; weeks are Monday–Sunday. DST changeovers (e.g. 27 Sep 2026 start, 5 Apr 2026 and 4 Apr 2027 end) are covered by tests.
- **Refunds** larger than a period's purchases show as "−$X refunds" with a 0% bar; totals keep the true figure.
- **Word-matched starter rules**: patterns of ≤5 characters (counting spaces) plus ami, bp, gull, tower, neon, spark, farmers, mercury, genesis, subway and state insurance match whole words only. "SKY TOWER" and "FARMERS MARKET" are whole-word hits, so those two rules also have exclude words (`tower` ⟂ sky, `farmers` ⟂ market).
- **User regex rules**: JavaScript can't time out a regex, so patterns are capped at 100 characters, nested/overlapping repetition and backreferences are rejected, and text is capped at 200 characters.
- **Subscriptions** include rent and bills if they're regular; hide what you don't want counted.
- **What counts as spending:** debits (net of refunds) in *expense* categories, plus uncategorised debits (so totals are honest before triage). Income and Transfers never count. Uncategorised credits are ignored until categorised. Pending transactions are shown but not counted until they settle.
- **Months** are NZ calendar months (Pacific/Auckland); "last 3 months" = the 3 months up to and including today.
- **Budgets** are stored monthly; weekly = ×52/12, fortnightly = ×26/12, yearly = ÷12. The originally entered amount/period is kept for display. A budget on a parent category covers its subcategories.
- **"On track"**: with an overall cap, total spend vs cap × fraction of month elapsed (5% leeway); without one, spend in budgeted categories vs the sum of their budgets, and no category over budget.
- **Transfer detection** uses description patterns (Amex/credit-card payments, "PAYMENT RECEIVED"), references to your own account numbers, and equal/opposite pairs of TRANSFER/PAYMENT rows across your accounts within 3 days. Anything missed can be fixed with a rule to *Transfers*.
- **Akahu categories are hints only.** They're mapped to your categories by keyword and never override your rules or manual choices.
- **Manual choices are sticky**: sync never changes a transaction you categorised by hand; new rules re-categorise past non-manual transactions (with confirmation if 20+).
- **Bulk threshold** for confirmation is 20 transactions (the same in the UI and chat).
- **Default rules** for common NZ merchants (71 patterns, see above) are seeded and editable.
- **System categories** *Salary* and *Transfers* can be renamed but not deleted, since detection depends on them.
- **Net off** applies by link, not by date: an expense in September reimbursed in October counts net in September, and the October payment's linked part is excluded. Linking is only allowed from a credit to a debit.
- **Category name matching** (chat/API) accepts parts of compound names: "fuel" → Transport/Fuel, "health" → Health & Wellness, "shopping" → Clothes/Shopping.
- **Deleting a category** also deletes its subcategories, rules and budgets; its transactions become uncategorised.
- **Cash transactions** have no account; only these can be deleted.
- **Chat history**: the last 30 messages are sent to Claude each turn; full history is stored.
- **Demo mode store** (no Supabase) is a JSON file for local testing only; on Vercel it lives in `/tmp` and is not durable.
- Uses **Next.js 16** (where `middleware.ts` is renamed `proxy.ts`), Tailwind v4, `@anthropic-ai/sdk` with adaptive thinking.
