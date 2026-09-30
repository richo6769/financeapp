-- Category guesses for the Uncategorised inbox (one per merchant group).
-- Filled after each sync (and by "Guess categories"); only ever applied when
-- you tap Save all. "not this" marks one dismissed so it isn't guessed again.
-- Safe to re-run.
create table if not exists public.category_guesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_key text not null check (char_length(group_key) <= 300),
  category_id uuid references public.categories(id) on delete cascade,
  confidence text check (confidence in ('high','medium','low')),
  status text not null default 'pending' check (status in ('pending','dismissed')),
  source text not null default 'claude' check (source in ('claude','offline')),
  created_at timestamptz not null default now(),
  unique (user_id, group_key)
);

alter table public.category_guesses enable row level security;
drop policy if exists "owner_select" on public.category_guesses;
drop policy if exists "owner_insert" on public.category_guesses;
drop policy if exists "owner_update" on public.category_guesses;
drop policy if exists "owner_delete" on public.category_guesses;
create policy "owner_select" on public.category_guesses for select to authenticated using (user_id = (select auth.uid()));
create policy "owner_insert" on public.category_guesses for insert to authenticated with check (user_id = (select auth.uid()));
create policy "owner_update" on public.category_guesses for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner_delete" on public.category_guesses for delete to authenticated using (user_id = (select auth.uid()));
