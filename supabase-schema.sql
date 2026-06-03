create extension if not exists pgcrypto;

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) <= 120),
  category text not null check (char_length(category) <= 40),
  content text not null check (char_length(content) <= 5000),
  tags text[] not null default '{}',
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.items enable row level security;

drop policy if exists "Users can read their own items" on public.items;
create policy "Users can read their own items"
on public.items
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own items" on public.items;
create policy "Users can create their own items"
on public.items
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own items" on public.items;
create policy "Users can update their own items"
on public.items
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own items" on public.items;
create policy "Users can delete their own items"
on public.items
for delete
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists items_user_id_updated_at_idx on public.items (user_id, updated_at desc);
create index if not exists items_user_id_category_idx on public.items (user_id, category);
