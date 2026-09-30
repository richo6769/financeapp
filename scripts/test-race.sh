#!/usr/bin/env bash
# Concurrency test for the reimbursement trigger against a REAL Postgres.
# Two sessions link $80 each to the same $100 expense at the same time.
#   PGHOST=/var/tmp/finpg PGPORT=54329 PGUSER=postgres bash scripts/test-race.sh
# Runs twice: with the shipped trigger (must reject the 2nd link) and with the
# FOR UPDATE lock stripped out (shows the race is real).
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
cd "$(dirname "$0")/.."
command -v psql >/dev/null || { echo "psql not found; skipping race test"; exit 0; }

setup() { # $1 = db name, $2 = 1 to strip the row lock
  psql -q -X -v ON_ERROR_STOP=1 -c "drop database if exists $1" -c "create database $1" >/dev/null
  psql -q -X -v ON_ERROR_STOP=1 -d "$1" >/dev/null <<'SQL'
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
SQL
  for f in supabase/migrations/*.sql; do
    if [ "$2" = "1" ] && [[ "$f" == *reimbursement_links* ]]; then
      sed '/perform 1 from public.transactions/,/for update;/d' "$f" | psql -q -X -v ON_ERROR_STOP=1 -d "$1" >/dev/null
    else
      psql -q -X -v ON_ERROR_STOP=1 -d "$1" -f "$f" >/dev/null
    fi
  done
  psql -q -X -v ON_ERROR_STOP=1 -d "$1" >/dev/null <<'SQL'
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'me@example.nz');
insert into public.transactions (id, user_id, date, local_date, description, amount) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', now(), current_date, 'DINNER', -100),
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', now(), current_date, 'SAM', 80),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', now(), current_date, 'JACK', 80);
SQL
}

race() { # $1 = db; prints total linked to the expense
  psql -q -X -d "$1" >/dev/null 2>&1 <<'SQL' &
begin;
insert into public.reimbursement_links (user_id, expense_id, income_id, amount)
  values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 80);
select pg_sleep(2);
commit;
SQL
  sleep 0.5
  psql -q -X -d "$1" >/dev/null 2>&1 <<'SQL' || true
insert into public.reimbursement_links (user_id, expense_id, income_id, amount)
  values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 80);
SQL
  wait
  psql -X -At -d "$1" -c "select coalesce(sum(amount),0) from public.reimbursement_links where expense_id = 'aaaaaaaa-0000-0000-0000-000000000001'"
}

setup finrace_locked 0
locked=$(race finrace_locked)
setup finrace_unlocked 1
unlocked=$(race finrace_unlocked)
echo "  with FOR UPDATE:    linked \$$locked of a \$100 expense"
echo "  without the lock:   linked \$$unlocked of a \$100 expense"
[ "$locked" = "80.00" ] || { echo "✗ race NOT prevented"; exit 1; }
[ "$unlocked" = "160.00" ] && echo "  (the unlocked trigger over-allocates, so the test really exercises the race)"
echo "  ✓ concurrent links can't over-allocate"
