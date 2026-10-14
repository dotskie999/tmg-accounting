alter table public.businesses
  add column if not exists revision integer not null default 1 check (revision > 0),
  add column if not exists last_impact jsonb;

-- Recipe-derived price events are retained alongside purchased-item price history.
alter table public.price_events drop constraint if exists price_events_source_check;
alter table public.price_events
  add constraint price_events_source_check
  check (source in ('opening', 'restock', 'market', 'calculated'));

create or replace function public.replace_accounting_state(
  p_owner_user_id uuid,
  p_expected_revision integer,
  p_state jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_business_id uuid;
  v_next_revision integer;
begin
  select id
  into v_business_id
  from public.businesses
  where owner_user_id = p_owner_user_id;

  if v_business_id is null then
    raise exception 'business_not_found' using errcode = 'P0002';
  end if;

  update public.businesses
  set
    name = coalesce(nullif(trim(p_state->>'businessName'), ''), 'TMG Accounting'),
    branch_name = coalesce(nullif(trim(p_state->>'branchName'), ''), 'Main Branch'),
    currency = 'PHP',
    revision = revision + 1,
    last_impact = p_state->'lastImpact'
  where id = v_business_id
    and revision = p_expected_revision
  returning revision into v_next_revision;

  if v_next_revision is null then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;

  delete from public.menu_pricing
  where menu_item_id in (
    select id from public.menu_items where business_id = v_business_id
  );
  delete from public.category_default_lines
  where category_id in (
    select id from public.menu_categories where business_id = v_business_id
  );
  delete from public.recipe_lines
  where recipe_id in (
    select id from public.recipes where business_id = v_business_id
  );
  delete from public.audit_events where business_id = v_business_id;
  delete from public.price_events where business_id = v_business_id;
  delete from public.stock_movements where business_id = v_business_id;
  delete from public.menu_items where business_id = v_business_id;
  delete from public.recipes where business_id = v_business_id;
  delete from public.menu_categories where business_id = v_business_id;
  delete from public.inventory_items where business_id = v_business_id;

  insert into public.inventory_items (
    id, business_id, name, item_type, base_unit, on_hand, reorder_level,
    current_unit_cost, supplier, active
  )
  select
    (entry->>'id')::uuid,
    v_business_id,
    entry->>'name',
    entry->>'type',
    entry->>'baseUnit',
    (entry->>'onHand')::numeric,
    (entry->>'reorderLevel')::numeric,
    case
      when entry->'currentCost' is null or entry->'currentCost' = 'null'::jsonb then null
      else (entry->>'currentCost')::numeric
    end,
    coalesce(entry->>'supplier', ''),
    coalesce((entry->>'active')::boolean, true)
  from jsonb_array_elements(coalesce(p_state->'items', '[]'::jsonb)) as source(entry);

  insert into public.menu_categories (id, business_id, name, created_at, updated_at)
  select
    (entry->>'id')::uuid,
    v_business_id,
    entry->>'name',
    (entry->>'createdAt')::timestamptz,
    (entry->>'updatedAt')::timestamptz
  from jsonb_array_elements(coalesce(p_state->'menuCategories', '[]'::jsonb)) as source(entry);

  insert into public.recipes (
    id, business_id, output_item_id, output_quantity, version, status, notes, updated_at
  )
  select
    (entry->>'id')::uuid,
    v_business_id,
    (entry->>'outputItemId')::uuid,
    (entry->>'outputQuantity')::numeric,
    (entry->>'version')::integer,
    entry->>'status',
    coalesce(entry->>'notes', ''),
    (entry->>'updatedAt')::timestamptz
  from jsonb_array_elements(coalesce(p_state->'recipes', '[]'::jsonb)) as source(entry);

  insert into public.recipe_lines (recipe_id, component_item_id, quantity, sort_order)
  select
    (recipe_entry->>'id')::uuid,
    (component_entry->>'itemId')::uuid,
    (component_entry->>'quantity')::numeric,
    component.ordinality::integer - 1
  from jsonb_array_elements(coalesce(p_state->'recipes', '[]'::jsonb)) as recipes(recipe_entry)
  cross join lateral jsonb_array_elements(coalesce(recipe_entry->'components', '[]'::jsonb))
    with ordinality as component(component_entry, ordinality);

  insert into public.category_default_lines (category_id, component_item_id, quantity, sort_order)
  select
    (category_entry->>'id')::uuid,
    (component_entry->>'itemId')::uuid,
    (component_entry->>'quantity')::numeric,
    component.ordinality::integer - 1
  from jsonb_array_elements(coalesce(p_state->'menuCategories', '[]'::jsonb)) as categories(category_entry)
  cross join lateral jsonb_array_elements(coalesce(category_entry->'defaultComponents', '[]'::jsonb))
    with ordinality as component(component_entry, ordinality);

  insert into public.menu_items (id, business_id, inventory_item_id, category_id)
  select
    (entry->>'id')::uuid,
    v_business_id,
    (entry->>'id')::uuid,
    case
      when entry->>'categoryId' is null or entry->>'categoryId' = '' then null
      else (entry->>'categoryId')::uuid
    end
  from jsonb_array_elements(coalesce(p_state->'items', '[]'::jsonb)) as source(entry)
  where entry->>'type' = 'MI';

  insert into public.price_events (
    id, business_id, item_id, source, pack_price, pack_quantity, unit_cost,
    old_unit_cost, received_quantity, revaluation_delta, supplier, note, created_at
  )
  select
    (entry->>'id')::uuid,
    v_business_id,
    (entry->>'itemId')::uuid,
    entry->>'source',
    (entry->>'packPrice')::numeric,
    (entry->>'packQuantity')::numeric,
    (entry->>'unitCost')::numeric,
    case
      when entry->'oldUnitCost' is null or entry->'oldUnitCost' = 'null'::jsonb then null
      else (entry->>'oldUnitCost')::numeric
    end,
    (entry->>'receivedQuantity')::numeric,
    (entry->>'revaluationDelta')::numeric,
    coalesce(entry->>'supplier', ''),
    coalesce(entry->>'note', ''),
    (entry->>'createdAt')::timestamptz
  from jsonb_array_elements(coalesce(p_state->'priceEvents', '[]'::jsonb)) as source(entry);

  insert into public.stock_movements (
    id, business_id, item_id, movement_type, quantity_change,
    unit_cost_snapshot, total_value, reference, created_at
  )
  select
    (entry->>'id')::uuid,
    v_business_id,
    (entry->>'itemId')::uuid,
    entry->>'type',
    (entry->>'quantityChange')::numeric,
    case
      when entry->'unitCostSnapshot' is null or entry->'unitCostSnapshot' = 'null'::jsonb then null
      else (entry->>'unitCostSnapshot')::numeric
    end,
    (entry->>'totalValue')::numeric,
    coalesce(entry->>'reference', ''),
    (entry->>'createdAt')::timestamptz
  from jsonb_array_elements(coalesce(p_state->'stockMovements', '[]'::jsonb)) as source(entry);

  insert into public.menu_pricing (
    menu_item_id, pricing_method, target_percent, rounding_increment, approved_price, updated_at
  )
  select
    (entry->>'itemId')::uuid,
    entry->>'method',
    (entry->>'targetPercent')::numeric,
    (entry->>'rounding')::integer,
    (entry->>'approvedPrice')::numeric,
    (entry->>'updatedAt')::timestamptz
  from jsonb_array_elements(coalesce(p_state->'menuPrices', '[]'::jsonb)) as source(entry);

  insert into public.audit_events (
    id, business_id, actor_user_id, event_type, title, detail, created_at
  )
  select
    (entry->>'id')::uuid,
    v_business_id,
    p_owner_user_id,
    entry->>'kind',
    entry->>'title',
    coalesce(entry->>'detail', ''),
    (entry->>'createdAt')::timestamptz
  from jsonb_array_elements(coalesce(p_state->'activities', '[]'::jsonb)) as source(entry);

  return v_next_revision;
end;
$$;

revoke all on function public.replace_accounting_state(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.replace_accounting_state(uuid, integer, jsonb) to service_role;

comment on function public.replace_accounting_state(uuid, integer, jsonb) is
  'Atomically persists a validated TMG Accounting state into normalized tables with revision locking.';
