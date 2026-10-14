-- Destructive reset requested for the TMG Accounting launch.
-- Supabase Auth users are preserved. All normalized accounting records are removed.
delete from public.businesses;

-- The application no longer uses the legacy JSONB workspace table after migration 003.
drop table if exists public.workspaces;
