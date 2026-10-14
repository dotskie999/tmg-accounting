create table if not exists public.workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_json jsonb not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;

-- All accounting writes must pass through /api/workspace so the reducer,
-- audit history, recipe graph validation, and revision lock cannot be bypassed.
revoke all on table public.workspaces from anon, authenticated;
grant select, insert, update on table public.workspaces to service_role;

comment on table public.workspaces is
  'One versioned CostFlow state document per Supabase Auth user. Direct client access is intentionally denied.';
