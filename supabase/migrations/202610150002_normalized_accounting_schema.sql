create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'TMG Accounting' check (length(trim(name)) between 1 and 120),
  branch_name text not null default 'Main Branch' check (length(trim(branch_name)) between 1 and 120),
  currency text not null default 'PHP' check (currency = 'PHP'),
  revision integer not null default 1 check (revision > 0),
  last_impact jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  item_type text not null check (item_type in ('RM', 'CoRM', 'PM', 'OM', 'FB', 'MI')),
  base_unit text not null check (base_unit in ('pc', 'g', 'ml', 'serving')),
  on_hand numeric(18,6) not null default 0 check (on_hand >= 0),
  reorder_level numeric(18,6) not null default 0 check (reorder_level >= 0),
  current_unit_cost numeric(18,6) check (current_unit_cost is null or current_unit_cost >= 0),
  supplier text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name),
  unique (business_id, id)
);

create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name),
  unique (business_id, id)
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  output_item_id uuid not null references public.inventory_items(id) on delete cascade,
  output_quantity numeric(18,6) not null check (output_quantity > 0),
  version integer not null default 1 check (version > 0),
  status text not null default 'approved' check (status in ('draft', 'approved')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (output_item_id),
  unique (business_id, id)
);

create table if not exists public.recipe_lines (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  component_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric(18,6) not null check (quantity > 0),
  sort_order integer not null default 0,
  unique (recipe_id, component_item_id)
);

create table if not exists public.category_default_lines (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.menu_categories(id) on delete cascade,
  component_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric(18,6) not null check (quantity > 0),
  sort_order integer not null default 0,
  unique (category_id, component_item_id)
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  inventory_item_id uuid not null unique references public.inventory_items(id) on delete cascade,
  category_id uuid references public.menu_categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create table if not exists public.price_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  source text not null check (source in ('opening', 'restock', 'market')),
  pack_price numeric(18,6) not null check (pack_price >= 0),
  pack_quantity numeric(18,6) not null check (pack_quantity > 0),
  unit_cost numeric(18,6) not null check (unit_cost >= 0),
  old_unit_cost numeric(18,6) check (old_unit_cost is null or old_unit_cost >= 0),
  received_quantity numeric(18,6) not null default 0 check (received_quantity >= 0),
  revaluation_delta numeric(18,6) not null default 0,
  supplier text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists price_events_item_created_idx
  on public.price_events (item_id, created_at desc);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  movement_type text not null check (movement_type in ('opening', 'receipt', 'adjustment')),
  quantity_change numeric(18,6) not null check (quantity_change <> 0),
  unit_cost_snapshot numeric(18,6) check (unit_cost_snapshot is null or unit_cost_snapshot >= 0),
  total_value numeric(18,6) not null default 0,
  reference text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_item_created_idx
  on public.stock_movements (item_id, created_at desc);

create table if not exists public.menu_pricing (
  menu_item_id uuid primary key references public.menu_items(id) on delete cascade,
  pricing_method text not null check (pricing_method in ('markup', 'margin')),
  target_percent numeric(9,4) not null check (target_percent >= 0 and (pricing_method <> 'margin' or target_percent < 100)),
  rounding_increment integer not null default 1 check (rounding_increment in (1, 5, 10)),
  approved_price numeric(18,2) check (approved_price is null or approved_price >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  title text not null,
  detail text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_business_created_idx
  on public.audit_events (business_id, created_at desc);

create or replace view public.item_price_slots
with (security_invoker = true)
as
with ranked as (
  select
    item_id,
    unit_cost,
    row_number() over (partition by item_id order by created_at desc, id desc) as price_rank
  from public.price_events
)
select
  item.id as item_id,
  item.business_id,
  item.current_unit_cost as current_price,
  max(ranked.unit_cost) filter (where ranked.price_rank = 2) as recent_price,
  max(ranked.unit_cost) filter (where ranked.price_rank = 3) as previous_price
from public.inventory_items item
left join ranked on ranked.item_id = item.id and ranked.price_rank <= 3
group by item.id, item.business_id, item.current_unit_cost;

drop trigger if exists businesses_set_updated_at on public.businesses;
create trigger businesses_set_updated_at before update on public.businesses
for each row execute function public.set_updated_at();

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at before update on public.inventory_items
for each row execute function public.set_updated_at();

drop trigger if exists menu_categories_set_updated_at on public.menu_categories;
create trigger menu_categories_set_updated_at before update on public.menu_categories
for each row execute function public.set_updated_at();

drop trigger if exists recipes_set_updated_at on public.recipes;
create trigger recipes_set_updated_at before update on public.recipes
for each row execute function public.set_updated_at();

drop trigger if exists menu_items_set_updated_at on public.menu_items;
create trigger menu_items_set_updated_at before update on public.menu_items
for each row execute function public.set_updated_at();

alter table public.businesses enable row level security;
alter table public.inventory_items enable row level security;
alter table public.menu_categories enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_lines enable row level security;
alter table public.category_default_lines enable row level security;
alter table public.menu_items enable row level security;
alter table public.price_events enable row level security;
alter table public.stock_movements enable row level security;
alter table public.menu_pricing enable row level security;
alter table public.audit_events enable row level security;

revoke all on table
  public.businesses,
  public.inventory_items,
  public.menu_categories,
  public.recipes,
  public.recipe_lines,
  public.category_default_lines,
  public.menu_items,
  public.price_events,
  public.stock_movements,
  public.menu_pricing,
  public.audit_events
from anon, authenticated;

grant select, insert, update, delete on table
  public.businesses,
  public.inventory_items,
  public.menu_categories,
  public.recipes,
  public.recipe_lines,
  public.category_default_lines,
  public.menu_items,
  public.price_events,
  public.stock_movements,
  public.menu_pricing,
  public.audit_events
to service_role;

revoke all on public.item_price_slots from anon, authenticated;
grant select on public.item_price_slots to service_role;

comment on view public.item_price_slots is
  'Current, recent, and previous replacement-cost slots derived from price history.';
