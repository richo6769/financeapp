-- Merchant logos from Akahu (one per merchant), shown beside transactions.
-- Safe to re-run. The app works without it (initials are shown instead).
create table if not exists public.merchant_logos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  merchant_key text not null check (char_length(merchant_key) <= 200),
  url text not null check (url like 'https://%' and char_length(url) <= 500),
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_key)
);

alter table public.merchant_logos enable row level security;
drop policy if exists "owner_select" on public.merchant_logos;
drop policy if exists "owner_insert" on public.merchant_logos;
drop policy if exists "owner_update" on public.merchant_logos;
drop policy if exists "owner_delete" on public.merchant_logos;
create policy "owner_select" on public.merchant_logos for select to authenticated using (user_id = (select auth.uid()));
create policy "owner_insert" on public.merchant_logos for insert to authenticated with check (user_id = (select auth.uid()));
create policy "owner_update" on public.merchant_logos for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner_delete" on public.merchant_logos for delete to authenticated using (user_id = (select auth.uid()));
