import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createEmptyState,
  normalizeWorkspaceState,
  type Activity,
  type Item,
  type ItemType,
  type MenuCategory,
  type MenuPrice,
  type PriceEvent,
  type Recipe,
  type StockMovement,
  type WorkspaceState,
} from "@/lib/costflow";

type DbError = { code?: string; message: string };
type Row = Record<string, unknown>;

export class RevisionConflictError extends Error {
  constructor() {
    super("This workspace changed in another session. Refresh and try again.");
  }
}

function databaseError(error: DbError) {
  return new Error(`${error.code ? `${error.code}: ` : ""}${error.message}`);
}

const text = (value: unknown) => typeof value === "string" ? value : "";
const numeric = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0);
const nullableNumeric = (value: unknown) => value === null || value === undefined ? null : numeric(value);

async function getOrCreateBusiness(db: SupabaseClient, userId: string) {
  const selected = await db
    .from("businesses")
    .select("id,name,branch_name,currency,revision,last_impact")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (selected.error) throw databaseError(selected.error);
  if (selected.data) return selected.data as Row;

  const created = await db
    .from("businesses")
    .insert({ owner_user_id: userId, name: "TMG Accounting", branch_name: "Main Branch", currency: "PHP" })
    .select("id,name,branch_name,currency,revision,last_impact")
    .maybeSingle();
  if (!created.error && created.data) return created.data as Row;
  if (created.error?.code !== "23505") throw databaseError(created.error ?? { message: "Unable to initialize the business." });

  const winner = await db
    .from("businesses")
    .select("id,name,branch_name,currency,revision,last_impact")
    .eq("owner_user_id", userId)
    .single();
  if (winner.error) throw databaseError(winner.error);
  return winner.data as Row;
}

function groupLines(rows: Row[], parentKey: string) {
  const grouped = new Map<string, { itemId: string; quantity: number }[]>();
  for (const row of rows.slice().sort((a, b) => numeric(a.sort_order) - numeric(b.sort_order))) {
    const parentId = text(row[parentKey]);
    const values = grouped.get(parentId) ?? [];
    values.push({ itemId: text(row.component_item_id), quantity: numeric(row.quantity) });
    grouped.set(parentId, values);
  }
  return grouped;
}

export async function loadNormalizedWorkspace(db: SupabaseClient, userId: string) {
  const business = await getOrCreateBusiness(db, userId);
  const businessId = text(business.id);

  const [itemsResult, categoriesResult, recipesResult, pricesResult, stockResult, menuItemsResult, auditResult] = await Promise.all([
    db.from("inventory_items").select("id,name,item_type,base_unit,on_hand,reorder_level,current_unit_cost,supplier,active").eq("business_id", businessId),
    db.from("menu_categories").select("id,name,created_at,updated_at").eq("business_id", businessId),
    db.from("recipes").select("id,output_item_id,output_quantity,version,status,notes,updated_at").eq("business_id", businessId),
    db.from("price_events").select("id,item_id,source,pack_price,pack_quantity,unit_cost,old_unit_cost,received_quantity,revaluation_delta,supplier,note,created_at").eq("business_id", businessId),
    db.from("stock_movements").select("id,item_id,movement_type,quantity_change,unit_cost_snapshot,total_value,reference,created_at").eq("business_id", businessId),
    db.from("menu_items").select("id,inventory_item_id,category_id").eq("business_id", businessId),
    db.from("audit_events").select("id,event_type,title,detail,created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(100),
  ]);

  for (const result of [itemsResult, categoriesResult, recipesResult, pricesResult, stockResult, menuItemsResult, auditResult]) {
    if (result.error) throw databaseError(result.error);
  }

  const recipeRows = (recipesResult.data ?? []) as Row[];
  const categoryRows = (categoriesResult.data ?? []) as Row[];
  const menuItemRows = (menuItemsResult.data ?? []) as Row[];
  const recipeIds = recipeRows.map((row) => text(row.id));
  const categoryIds = categoryRows.map((row) => text(row.id));
  const menuItemIds = menuItemRows.map((row) => text(row.id));

  const [recipeLinesResult, categoryLinesResult, pricingResult] = await Promise.all([
    recipeIds.length
      ? db.from("recipe_lines").select("recipe_id,component_item_id,quantity,sort_order").in("recipe_id", recipeIds)
      : Promise.resolve({ data: [], error: null }),
    categoryIds.length
      ? db.from("category_default_lines").select("category_id,component_item_id,quantity,sort_order").in("category_id", categoryIds)
      : Promise.resolve({ data: [], error: null }),
    menuItemIds.length
      ? db.from("menu_pricing").select("menu_item_id,pricing_method,target_percent,rounding_increment,approved_price,updated_at").in("menu_item_id", menuItemIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [recipeLinesResult, categoryLinesResult, pricingResult]) {
    if (result.error) throw databaseError(result.error);
  }

  const categoryByItem = new Map(menuItemRows.map((row) => [text(row.inventory_item_id), row.category_id ? text(row.category_id) : undefined]));
  const menuItemToInventory = new Map(menuItemRows.map((row) => [text(row.id), text(row.inventory_item_id)]));
  const recipeLines = groupLines((recipeLinesResult.data ?? []) as Row[], "recipe_id");
  const categoryLines = groupLines((categoryLinesResult.data ?? []) as Row[], "category_id");

  const items: Item[] = ((itemsResult.data ?? []) as Row[]).map((row) => ({
    id: text(row.id),
    name: text(row.name),
    type: text(row.item_type) as ItemType,
    baseUnit: text(row.base_unit),
    onHand: numeric(row.on_hand),
    reorderLevel: numeric(row.reorder_level),
    currentCost: nullableNumeric(row.current_unit_cost),
    supplier: text(row.supplier),
    active: row.active !== false,
    ...(categoryByItem.get(text(row.id)) ? { categoryId: categoryByItem.get(text(row.id)) } : {}),
  }));

  const recipes: Recipe[] = recipeRows.map((row) => ({
    id: text(row.id),
    outputItemId: text(row.output_item_id),
    outputQuantity: numeric(row.output_quantity),
    components: recipeLines.get(text(row.id)) ?? [],
    version: numeric(row.version),
    status: text(row.status) as Recipe["status"],
    notes: text(row.notes),
    updatedAt: text(row.updated_at),
  }));

  const menuCategories: MenuCategory[] = categoryRows.map((row) => ({
    id: text(row.id),
    name: text(row.name),
    defaultComponents: categoryLines.get(text(row.id)) ?? [],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  }));

  const priceEvents: PriceEvent[] = ((pricesResult.data ?? []) as Row[]).map((row) => ({
    id: text(row.id), itemId: text(row.item_id), source: text(row.source) as PriceEvent["source"],
    packPrice: numeric(row.pack_price), packQuantity: numeric(row.pack_quantity), unitCost: numeric(row.unit_cost),
    oldUnitCost: nullableNumeric(row.old_unit_cost), receivedQuantity: numeric(row.received_quantity),
    revaluationDelta: numeric(row.revaluation_delta), supplier: text(row.supplier), note: text(row.note), createdAt: text(row.created_at),
  }));

  const stockMovements: StockMovement[] = ((stockResult.data ?? []) as Row[]).map((row) => ({
    id: text(row.id), itemId: text(row.item_id), type: text(row.movement_type) as StockMovement["type"],
    quantityChange: numeric(row.quantity_change), unitCostSnapshot: nullableNumeric(row.unit_cost_snapshot),
    totalValue: numeric(row.total_value), reference: text(row.reference), createdAt: text(row.created_at),
  }));

  const menuPrices: MenuPrice[] = ((pricingResult.data ?? []) as Row[]).map((row) => ({
    itemId: menuItemToInventory.get(text(row.menu_item_id)) ?? text(row.menu_item_id),
    approvedPrice: numeric(row.approved_price), method: text(row.pricing_method) as MenuPrice["method"],
    targetPercent: numeric(row.target_percent), rounding: numeric(row.rounding_increment), updatedAt: text(row.updated_at),
  }));

  const activities: Activity[] = ((auditResult.data ?? []) as Row[]).map((row) => ({
    id: text(row.id), kind: text(row.event_type) as Activity["kind"], title: text(row.title),
    detail: text(row.detail), createdAt: text(row.created_at),
  }));

  const state = normalizeWorkspaceState({
    ...createEmptyState(),
    businessName: text(business.name) || "TMG Accounting",
    branchName: text(business.branch_name) || "Main Branch",
    items,
    recipes,
    menuCategories,
    priceEvents,
    stockMovements,
    menuPrices,
    activities,
    lastImpact: business.last_impact as WorkspaceState["lastImpact"],
  });

  return { state, revision: numeric(business.revision) };
}

export async function saveNormalizedWorkspace(
  db: SupabaseClient,
  userId: string,
  expectedRevision: number,
  state: WorkspaceState,
) {
  const { data, error } = await db.rpc("replace_accounting_state", {
    p_owner_user_id: userId,
    p_expected_revision: expectedRevision,
    p_state: state,
  });
  if (error?.code === "40001" || error?.message.includes("revision_conflict")) {
    throw new RevisionConflictError();
  }
  if (error) throw databaseError(error);
  return numeric(data);
}
