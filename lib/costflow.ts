export const ITEM_TYPES = ["RM", "CoRM", "FB", "OM", "PM", "MI"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const BASE_UNITS = ["pc", "g", "ml", "serving"] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];
export type RecipeItemType = "CoRM" | "FB" | "OM";
export type PriceUpdateMode = "restock" | "market";
export type PricingMethod = "markup" | "margin";

export type Item = {
  id: string;
  name: string;
  type: ItemType;
  /** New records use BaseUnit. Older workspaces may retain a legacy display unit. */
  baseUnit: string;
  onHand: number;
  reorderLevel: number;
  currentCost: number | null;
  supplier: string;
  active: boolean;
  categoryId?: string | null;
};

export type RecipeComponent = { itemId: string; quantity: number };

export type Recipe = {
  id: string;
  outputItemId: string;
  outputQuantity: number;
  components: RecipeComponent[];
  version: number;
  status: "approved";
  notes: string;
  updatedAt: string;
};

export type PriceEvent = {
  id: string;
  itemId: string;
  source: "opening" | "restock" | "market" | "calculated";
  packPrice: number;
  packQuantity: number;
  unitCost: number;
  oldUnitCost: number | null;
  receivedQuantity: number;
  revaluationDelta: number;
  supplier: string;
  note: string;
  createdAt: string;
};

export type StockMovement = {
  id: string;
  itemId: string;
  type: "opening" | "receipt" | "adjustment";
  quantityChange: number;
  unitCostSnapshot: number | null;
  totalValue: number;
  reference: string;
  createdAt: string;
};

export type MenuPrice = {
  itemId: string;
  approvedPrice: number;
  method: PricingMethod;
  targetPercent: number;
  rounding: number;
  updatedAt: string;
};

export type MenuCategory = {
  id: string;
  name: string;
  defaultComponents: RecipeComponent[];
  createdAt: string;
  updatedAt: string;
};

export type Activity = {
  id: string;
  kind: "price" | "stock" | "recipe" | "approval" | "item";
  title: string;
  detail: string;
  createdAt: string;
};

export type CostImpact = {
  sourceItemId: string;
  affectedItemIds: string[];
  oldCost: number | null;
  newCost: number | null;
  revaluationDelta: number;
  createdAt: string;
};

export type WorkspaceState = {
  schemaVersion: 2;
  businessName: string;
  branchName: string;
  currency: "PHP";
  items: Item[];
  recipes: Recipe[];
  menuCategories: MenuCategory[];
  priceEvents: PriceEvent[];
  stockMovements: StockMovement[];
  menuPrices: MenuPrice[];
  activities: Activity[];
  lastImpact: CostImpact | null;
};

export type WorkspaceCommand =
  | { type: "update_price"; payload: { itemId: string; mode: PriceUpdateMode; receivedQuantity: number; packPrice: number; packQuantity: number; supplier?: string; note?: string } }
  | { type: "adjust_stock"; payload: { itemId: string; quantityChange: number; reason: string } }
  | { type: "delete_item"; payload: { itemId: string } }
  | { type: "add_raw_material"; payload: { name: string; baseUnit: BaseUnit; openingQuantity: number; openingTotalCost: number | null; reorderLevel: number; supplier?: string } }
  | { type: "create_recipe_item"; payload: { name: string; itemType: RecipeItemType; baseUnit: BaseUnit; openingQuantity: number; reorderLevel: number; outputQuantity: number; components: RecipeComponent[]; notes?: string } }
  | { type: "save_recipe"; payload: { outputItemId: string; outputQuantity: number; components: RecipeComponent[]; notes?: string } }
  | { type: "add_menu_category"; payload: { name: string; defaultComponents: RecipeComponent[] } }
  | { type: "create_menu_item"; payload: { name: string; categoryId?: string | null; baseUnit: BaseUnit; outputQuantity: number; components: RecipeComponent[]; notes?: string; pricing: { method: PricingMethod; targetPercent: number; rounding: number } } }
  | { type: "update_pricing"; payload: { itemId: string; method: PricingMethod; targetPercent: number; rounding: number } }
  | { type: "approve_price"; payload: { itemId: string } };

const ALLOWED_COMPONENTS: Record<ItemType, ItemType[]> = {
  RM: [], PM: [], CoRM: ["RM", "CoRM"], FB: ["RM", "CoRM", "FB"],
  OM: ["RM", "CoRM", "FB", "OM", "PM"], MI: ["RM", "CoRM", "FB", "OM", "PM"],
};

const round6 = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const uid = (prefix: string) => {
  void prefix;
  return crypto.randomUUID();
};

const BASE_UNIT_ALIASES: Record<string, BaseUnit> = {
  pc: "pc",
  pcs: "pc",
  piece: "pc",
  pieces: "pc",
  g: "g",
  gram: "g",
  grams: "g",
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  serving: "serving",
  servings: "serving",
};

export function normalizeBaseUnit(value: unknown): BaseUnit {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  const unit = BASE_UNIT_ALIASES[normalized];
  if (!unit) throw new Error(`Unsupported base unit: ${String(value)}.`);
  return unit;
}

function normalizePersistedBaseUnit(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Unsupported base unit: ${String(value)}.`);
  const trimmed = value.trim();
  return BASE_UNIT_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/** Upgrades durable v1 JSON without resetting its inventory, recipes, prices, or history. */
export function normalizeWorkspaceState(value: unknown): WorkspaceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid workspace state.");
  const state = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const version = state.schemaVersion;
  if (version !== 1 && version !== 2) throw new Error(`Unsupported workspace schema version: ${String(version)}.`);
  if (!Array.isArray(state.items)) throw new Error("Workspace items are missing.");

  state.items = state.items.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid workspace item.");
    const item = value as Record<string, unknown>;
    const baseUnit = normalizePersistedBaseUnit(item.baseUnit);
    if (item.type === "MI") {
      const categoryId = version === 1 ? null : typeof item.categoryId === "string" && item.categoryId.trim() ? item.categoryId : null;
      return { ...item, baseUnit, categoryId };
    }
    const nonMenuItem = { ...item };
    delete nonMenuItem.categoryId;
    return { ...nonMenuItem, baseUnit };
  });
  state.menuCategories = version === 1 ? [] : Array.isArray(state.menuCategories) ? state.menuCategories : [];
  state.schemaVersion = 2;
  return state as unknown as WorkspaceState;
}

export function calculateSuggestedPrice(cost: number | null, method: PricingMethod, targetPercent: number, rounding: number): number | null {
  if (cost === null || cost < 0 || targetPercent < 0 || rounding <= 0) return null;
  if (method === "margin" && targetPercent >= 100) return null;
  const raw = method === "markup" ? cost * (1 + targetPercent / 100) : cost / (1 - targetPercent / 100);
  return round2(Math.ceil((raw - 1e-10) / rounding) * rounding);
}

export function actualMargin(cost: number | null, price: number): number | null {
  if (cost === null || price <= 0) return null;
  return ((price - cost) / price) * 100;
}

export function getCostSlots(state: WorkspaceState, itemId: string) {
  const values = state.priceEvents.filter((event) => event.itemId === itemId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { current: values[0]?.unitCost ?? null, recent: values[1]?.unitCost ?? null, previous: values[2]?.unitCost ?? null };
}

export function inventoryValue(state: WorkspaceState) {
  return round2(state.items.reduce((sum, item) => sum + item.onHand * (item.currentCost ?? 0), 0));
}

export function dependentIds(state: WorkspaceState, sourceId: string) {
  const found = new Set<string>();
  const queue = [sourceId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const recipe of state.recipes) {
      if (recipe.components.some((component) => component.itemId === current) && !found.has(recipe.outputItemId)) {
        found.add(recipe.outputItemId);
        queue.push(recipe.outputItemId);
      }
    }
  }
  return [...found];
}

function recomputeRecipeCosts(state: WorkspaceState, at: string) {
  const before = new Map(state.items.map((item) => [item.id, item.currentCost]));
  const items = new Map(state.items.map((item) => [item.id, item]));
  const recipes = new Map(state.recipes.map((recipe) => [recipe.outputItemId, recipe]));
  const visiting = new Set<string>();
  const resolved = new Map<string, number | null>();
  const resolve = (itemId: string): number | null => {
    if (resolved.has(itemId)) return resolved.get(itemId)!;
    const item = items.get(itemId);
    if (!item) throw new Error("A recipe references an item that no longer exists.");
    const recipe = recipes.get(itemId);
    if (!recipe) { resolved.set(itemId, item.currentCost); return item.currentCost; }
    if (visiting.has(itemId)) throw new Error("Circular recipe detected.");
    visiting.add(itemId);
    let total = 0;
    let missing = false;
    for (const component of recipe.components) {
      const cost = resolve(component.itemId);
      if (cost === null) missing = true;
      else total += component.quantity * cost;
    }
    visiting.delete(itemId);
    const value = missing ? null : round6(total / recipe.outputQuantity);
    item.currentCost = value;
    resolved.set(itemId, value);
    return value;
  };
  for (const recipe of state.recipes) resolve(recipe.outputItemId);
  const changed: string[] = [];
  let revaluationDelta = 0;
  for (const recipe of state.recipes) {
    const item = items.get(recipe.outputItemId)!;
    const oldCost = before.get(item.id) ?? null;
    const newCost = item.currentCost;
    const materiallyChanged = oldCost === null ? newCost !== null : newCost === null || Math.abs(oldCost - newCost) > 0.0000005;
    if (!materiallyChanged || newCost === null) continue;
    changed.push(item.id);
    const delta = oldCost === null ? 0 : round2(item.onHand * (newCost - oldCost));
    revaluationDelta += delta;
    state.priceEvents.push({ id: uid("price"), itemId: item.id, source: "calculated", packPrice: newCost, packQuantity: 1, unitCost: newCost, oldUnitCost: oldCost, receivedQuantity: 0, revaluationDelta: delta, supplier: "", note: `Recipe v${recipe.version} recalculation`, createdAt: at });
  }
  return { changed, revaluationDelta: round2(revaluationDelta) };
}

function assertFiniteNonNegative(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be zero or higher.`);
}

function assertBaseUnit(value: unknown): asserts value is BaseUnit {
  if (!BASE_UNITS.includes(value as BaseUnit)) throw new Error("Invalid base unit.");
}

function assertUniqueItemName(state: WorkspaceState, value: string) {
  if (state.items.some((item) => item.name.toLowerCase() === value.toLowerCase())) throw new Error("An item with this name already exists.");
}

function validatePricingRule(method: PricingMethod, targetPercent: number, rounding: number) {
  if (method !== "markup" && method !== "margin") throw new Error("Invalid pricing method.");
  assertFiniteNonNegative(targetPercent, "Target percentage");
  if (method === "margin" && targetPercent >= 100) throw new Error("Target margin must be below 100%.");
  if (![1, 5, 10].includes(rounding)) throw new Error("Invalid rounding increment.");
}

function validateComponents(state: WorkspaceState, outputType: ItemType, components: RecipeComponent[]) {
  if (!components.length) throw new Error("Add at least one component.");
  const seen = new Set<string>();
  return components.map((component) => {
    const item = state.items.find((entry) => entry.id === component.itemId);
    if (!item) throw new Error("A recipe component was not found.");
    if (seen.has(item.id)) throw new Error(`${item.name} appears more than once in this recipe.`);
    seen.add(item.id);
    if (!ALLOWED_COMPONENTS[outputType].includes(item.type)) throw new Error(`${item.type} cannot be used inside a ${outputType} recipe.`);
    if (!Number.isFinite(component.quantity) || component.quantity <= 0) throw new Error(`Quantity for ${item.name} must be greater than zero.`);
    return { itemId: item.id, quantity: round6(component.quantity) };
  });
}

function validateCategoryComponents(state: WorkspaceState, components: RecipeComponent[]) {
  const seen = new Set<string>();
  return components.map((component) => {
    const item = state.items.find((entry) => entry.id === component.itemId);
    if (!item) throw new Error("A category default component was not found.");
    if (seen.has(item.id)) throw new Error(`${item.name} appears more than once in this category.`);
    seen.add(item.id);
    if (item.type !== "FB" && item.type !== "OM") throw new Error("Category defaults may use only FB and OM items.");
    if (!Number.isFinite(component.quantity) || component.quantity <= 0) throw new Error(`Quantity for ${item.name} must be greater than zero.`);
    return { itemId: item.id, quantity: round6(component.quantity) };
  });
}

function validateRecipeGraph(state: WorkspaceState) {
  const recipes = new Map(state.recipes.map((recipe) => [recipe.outputItemId, recipe]));
  const visited = new Set<string>();
  const stack = new Set<string>();
  const walk = (itemId: string, path: string[]) => {
    if (stack.has(itemId)) throw new Error(`Circular recipe detected: ${[...path, itemId].join(" → ")}`);
    if (visited.has(itemId)) return;
    stack.add(itemId);
    const recipe = recipes.get(itemId);
    if (recipe) for (const component of recipe.components) if (recipes.has(component.itemId)) walk(component.itemId, [...path, itemId]);
    stack.delete(itemId);
    visited.add(itemId);
  };
  for (const id of recipes.keys()) walk(id, []);
}

export function applyCommand(original: WorkspaceState, command: WorkspaceCommand, actorName: string): WorkspaceState {
  const state = JSON.parse(JSON.stringify(original)) as WorkspaceState;
  const at = new Date().toISOString();
  const finish = () => {
    state.activities = state.activities.slice(0, 100);
    return state;
  };
  const itemById = (id: string) => {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) throw new Error("Item not found.");
    return item;
  };

  switch (command.type) {
    case "update_price": { // Current replacement cost: all old and new stock uses this unit cost.
      const item = itemById(command.payload.itemId);
      if (!["RM", "PM"].includes(item.type)) throw new Error("Only purchased RM and PM items accept direct price updates.");
      if (command.payload.mode !== "restock" && command.payload.mode !== "market") throw new Error("Price update mode must be restock or market.");
      assertFiniteNonNegative(command.payload.packPrice, "Pack price");
      if (!Number.isFinite(command.payload.packQuantity) || command.payload.packQuantity <= 0) throw new Error("Pack quantity must be greater than zero.");
      const received = command.payload.mode === "restock" ? command.payload.receivedQuantity : 0;
      if (command.payload.mode === "restock" && (!Number.isFinite(received) || received <= 0)) throw new Error("Received quantity must be greater than zero.");
      const oldCost = item.currentCost;
      const newCost = round6(command.payload.packPrice / command.payload.packQuantity);
      const directRevaluation = oldCost === null ? 0 : round2(item.onHand * (newCost - oldCost));
      item.currentCost = newCost;
      item.supplier = command.payload.supplier?.trim() || item.supplier;
      if (command.payload.mode === "restock") item.onHand = round6(item.onHand + received);
      state.priceEvents.push({ id: uid("price"), itemId: item.id, source: command.payload.mode, packPrice: round2(command.payload.packPrice), packQuantity: round6(command.payload.packQuantity), unitCost: newCost, oldUnitCost: oldCost, receivedQuantity: received, revaluationDelta: directRevaluation, supplier: command.payload.supplier?.trim() ?? "", note: command.payload.note?.trim() ?? "", createdAt: at });
      if (command.payload.mode === "restock") state.stockMovements.push({ id: uid("move"), itemId: item.id, type: "receipt", quantityChange: received, unitCostSnapshot: newCost, totalValue: round2(received * newCost), reference: command.payload.note?.trim() || "Stock receipt", createdAt: at });
      const cascade = recomputeRecipeCosts(state, at);
      const affected = dependentIds(state, item.id).filter((id) => cascade.changed.includes(id));
      state.lastImpact = { sourceItemId: item.id, affectedItemIds: affected, oldCost, newCost, revaluationDelta: round2(directRevaluation + cascade.revaluationDelta), createdAt: at };
      state.activities.unshift({ id: uid("activity"), kind: "price", title: `${item.name} Current Cost updated`, detail: `${command.payload.mode === "restock" ? `Received ${received} ${item.baseUnit}; ` : "Market update; "}${affected.length} dependent item${affected.length === 1 ? "" : "s"} recalculated by ${actorName}.`, createdAt: at });
      return finish();
    }

    case "adjust_stock": {
      const item = itemById(command.payload.itemId);
      if (!Number.isFinite(command.payload.quantityChange) || command.payload.quantityChange === 0) throw new Error("Adjustment quantity cannot be zero.");
      const next = round6(item.onHand + command.payload.quantityChange);
      if (next < 0) throw new Error("This adjustment would create negative stock.");
      if (!command.payload.reason.trim()) throw new Error("An adjustment reason is required.");
      item.onHand = next;
      state.stockMovements.push({ id: uid("move"), itemId: item.id, type: "adjustment", quantityChange: round6(command.payload.quantityChange), unitCostSnapshot: item.currentCost, totalValue: round2(command.payload.quantityChange * (item.currentCost ?? 0)), reference: command.payload.reason.trim(), createdAt: at });
      state.activities.unshift({ id: uid("activity"), kind: "stock", title: `${item.name} stock adjusted`, detail: `${command.payload.quantityChange > 0 ? "+" : ""}${command.payload.quantityChange} ${item.baseUnit} · ${command.payload.reason.trim()}`, createdAt: at });
      return finish();
    }

    case "delete_item": {
      const item = itemById(command.payload.itemId);
      const recipeDependents = state.recipes
        .filter((recipe) => recipe.components.some((component) => component.itemId === item.id))
        .map((recipe) => state.items.find((entry) => entry.id === recipe.outputItemId)?.name)
        .filter((name): name is string => Boolean(name));
      if (recipeDependents.length) {
        throw new Error(`${item.name} cannot be deleted because it is used by: ${recipeDependents.join(", ")}.`);
      }
      const categoryDependents = state.menuCategories
        .filter((category) => category.defaultComponents.some((component) => component.itemId === item.id))
        .map((category) => category.name);
      if (categoryDependents.length) {
        throw new Error(`${item.name} cannot be deleted because it is a default line in: ${categoryDependents.join(", ")}.`);
      }

      state.items = state.items.filter((entry) => entry.id !== item.id);
      state.recipes = state.recipes.filter((recipe) => recipe.outputItemId !== item.id);
      state.priceEvents = state.priceEvents.filter((event) => event.itemId !== item.id);
      state.stockMovements = state.stockMovements.filter((movement) => movement.itemId !== item.id);
      state.menuPrices = state.menuPrices.filter((pricing) => pricing.itemId !== item.id);
      if (state.lastImpact?.sourceItemId === item.id || state.lastImpact?.affectedItemIds.includes(item.id)) {
        state.lastImpact = null;
      }
      state.activities.unshift({ id: uid("activity"), kind: "item", title: `${item.name} deleted`, detail: `${item.type} item and its related history were removed by ${actorName}.`, createdAt: at });
      return finish();
    }

    case "add_raw_material": {
      const name = command.payload.name.trim();
      if (!name) throw new Error("Item name is required.");
      assertUniqueItemName(state, name);
      assertBaseUnit(command.payload.baseUnit);
      assertFiniteNonNegative(command.payload.openingQuantity, "Opening quantity");
      assertFiniteNonNegative(command.payload.reorderLevel, "Reorder level");
      if (command.payload.openingTotalCost !== null) {
        assertFiniteNonNegative(command.payload.openingTotalCost, "Opening total cost");
        if (command.payload.openingQuantity <= 0) throw new Error("Opening quantity must be greater than zero when an opening total cost is entered.");
      }
      const id = uid("item");
      const directCost = command.payload.openingTotalCost === null
        ? null
        : round6(command.payload.openingTotalCost / command.payload.openingQuantity);
      state.items.push({ id, name, type: "RM", baseUnit: command.payload.baseUnit, onHand: round6(command.payload.openingQuantity), reorderLevel: round6(command.payload.reorderLevel), currentCost: directCost, supplier: command.payload.supplier?.trim() ?? "", active: true });
      if (directCost !== null) state.priceEvents.push({ id: uid("price"), itemId: id, source: "opening", packPrice: round2(command.payload.openingTotalCost!), packQuantity: round6(command.payload.openingQuantity), unitCost: directCost, oldUnitCost: null, receivedQuantity: command.payload.openingQuantity, revaluationDelta: 0, supplier: command.payload.supplier?.trim() ?? "", note: "Opening total cost", createdAt: at });
      if (command.payload.openingQuantity > 0) state.stockMovements.push({ id: uid("move"), itemId: id, type: "opening", quantityChange: round6(command.payload.openingQuantity), unitCostSnapshot: directCost, totalValue: round2(command.payload.openingQuantity * (directCost ?? 0)), reference: "Opening stock", createdAt: at });
      state.activities.unshift({ id: uid("activity"), kind: "item", title: `${name} created`, detail: `RM · ${command.payload.baseUnit}`, createdAt: at });
      return finish();
    }

    case "create_recipe_item": {
      const name = command.payload.name.trim();
      if (!name) throw new Error("Recipe name is required.");
      assertUniqueItemName(state, name);
      if (!["CoRM", "FB", "OM"].includes(command.payload.itemType)) throw new Error("Recipe items must be CoRM, FB, or OM.");
      assertBaseUnit(command.payload.baseUnit);
      assertFiniteNonNegative(command.payload.openingQuantity, "Opening quantity");
      assertFiniteNonNegative(command.payload.reorderLevel, "Reorder level");
      if (!Number.isFinite(command.payload.outputQuantity) || command.payload.outputQuantity <= 0) throw new Error("Recipe output must be greater than zero.");
      const components = validateComponents(state, command.payload.itemType, command.payload.components);
      const id = uid("item");
      const output: Item = { id, name, type: command.payload.itemType, baseUnit: command.payload.baseUnit, onHand: round6(command.payload.openingQuantity), reorderLevel: round6(command.payload.reorderLevel), currentCost: null, supplier: "", active: true };
      const recipe: Recipe = { id: uid("recipe"), outputItemId: id, outputQuantity: round6(command.payload.outputQuantity), components, version: 1, status: "approved", notes: command.payload.notes?.trim() ?? "", updatedAt: at };
      state.items.push(output);
      state.recipes.push(recipe);
      validateRecipeGraph(state);
      const cascade = recomputeRecipeCosts(state, at);
      if (output.onHand > 0) state.stockMovements.push({ id: uid("move"), itemId: id, type: "opening", quantityChange: output.onHand, unitCostSnapshot: output.currentCost, totalValue: round2(output.onHand * (output.currentCost ?? 0)), reference: "Opening stock", createdAt: at });
      state.lastImpact = { sourceItemId: id, affectedItemIds: [], oldCost: null, newCost: output.currentCost, revaluationDelta: cascade.revaluationDelta, createdAt: at };
      state.activities.unshift({ id: uid("activity"), kind: "recipe", title: `${name} recipe v1 approved`, detail: `${command.payload.itemType} output and ${components.length} component${components.length === 1 ? "" : "s"} created together.`, createdAt: at });
      return finish();
    }

    case "save_recipe": {
      const output = itemById(command.payload.outputItemId);
      if (output.type === "MI") throw new Error("Menu item recipes must be managed from the Menu tab.");
      if (!["CoRM", "FB", "OM"].includes(output.type)) throw new Error("Only CoRM, FB, and OM recipes can be edited here.");
      if (!Number.isFinite(command.payload.outputQuantity) || command.payload.outputQuantity <= 0) throw new Error("Recipe output must be greater than zero.");
      const components = validateComponents(state, output.type, command.payload.components);
      const existingIndex = state.recipes.findIndex((recipe) => recipe.outputItemId === output.id);
      const previous = existingIndex >= 0 ? state.recipes[existingIndex] : null;
      const recipe: Recipe = { id: previous?.id ?? uid("recipe"), outputItemId: output.id, outputQuantity: round6(command.payload.outputQuantity), components, version: (previous?.version ?? 0) + 1, status: "approved", notes: command.payload.notes?.trim() ?? "", updatedAt: at };
      if (existingIndex >= 0) state.recipes[existingIndex] = recipe; else state.recipes.push(recipe);
      validateRecipeGraph(state);
      const oldCost = output.currentCost;
      const cascade = recomputeRecipeCosts(state, at);
      const affected = [output.id, ...dependentIds(state, output.id)].filter((id) => cascade.changed.includes(id));
      state.lastImpact = { sourceItemId: output.id, affectedItemIds: affected.filter((id) => id !== output.id), oldCost, newCost: output.currentCost, revaluationDelta: cascade.revaluationDelta, createdAt: at };
      state.activities.unshift({ id: uid("activity"), kind: "recipe", title: `${output.name} recipe v${recipe.version} approved`, detail: `${components.length} component${components.length === 1 ? "" : "s"}; ${affected.length} calculated cost${affected.length === 1 ? "" : "s"} refreshed.`, createdAt: at });
      return finish();
    }

    case "add_menu_category": {
      const name = command.payload.name.trim();
      if (!name) throw new Error("Category name is required.");
      if (state.menuCategories.some((category) => category.name.toLowerCase() === name.toLowerCase())) throw new Error("A menu category with this name already exists.");
      const defaultComponents = validateCategoryComponents(state, command.payload.defaultComponents);
      state.menuCategories.push({ id: uid("category"), name, defaultComponents, createdAt: at, updatedAt: at });
      state.activities.unshift({ id: uid("activity"), kind: "item", title: `${name} category created`, detail: `${defaultComponents.length} default component${defaultComponents.length === 1 ? "" : "s"}.`, createdAt: at });
      return finish();
    }

    case "create_menu_item": {
      const name = command.payload.name.trim();
      if (!name) throw new Error("Menu item name is required.");
      assertUniqueItemName(state, name);
      assertBaseUnit(command.payload.baseUnit);
      if (!Number.isFinite(command.payload.outputQuantity) || command.payload.outputQuantity <= 0) throw new Error("Recipe output must be greater than zero.");
      validatePricingRule(command.payload.pricing.method, command.payload.pricing.targetPercent, command.payload.pricing.rounding);
      const categoryId = command.payload.categoryId?.trim() || null;
      const category = categoryId ? state.menuCategories.find((entry) => entry.id === categoryId) : null;
      if (categoryId && !category) throw new Error("Menu category not found.");
      const submittedComponents = validateComponents(state, "MI", command.payload.components);
      const defaultIds = new Set(category?.defaultComponents.map((component) => component.itemId) ?? []);
      const components = category
        ? [...category.defaultComponents.map((component) => ({ ...component })), ...submittedComponents.filter((component) => !defaultIds.has(component.itemId))]
        : submittedComponents;
      const id = uid("item");
      const output: Item = { id, name, type: "MI", baseUnit: command.payload.baseUnit, onHand: 0, reorderLevel: 0, currentCost: null, supplier: "", active: true, categoryId };
      const recipe: Recipe = { id: uid("recipe"), outputItemId: id, outputQuantity: round6(command.payload.outputQuantity), components, version: 1, status: "approved", notes: command.payload.notes?.trim() ?? "", updatedAt: at };
      state.items.push(output);
      state.recipes.push(recipe);
      state.menuPrices.push({ itemId: id, approvedPrice: 0, method: command.payload.pricing.method, targetPercent: command.payload.pricing.targetPercent, rounding: command.payload.pricing.rounding, updatedAt: at });
      validateRecipeGraph(state);
      const cascade = recomputeRecipeCosts(state, at);
      state.lastImpact = { sourceItemId: id, affectedItemIds: [], oldCost: null, newCost: output.currentCost, revaluationDelta: cascade.revaluationDelta, createdAt: at };
      state.activities.unshift({ id: uid("activity"), kind: "item", title: `${name} added to Menu`, detail: `${category?.name ?? "No category"} · ${components.length} component${components.length === 1 ? "" : "s"}.`, createdAt: at });
      return finish();
    }

    case "update_pricing": {
      const item = itemById(command.payload.itemId);
      if (item.type !== "MI") throw new Error("Pricing rules apply only to menu items.");
      validatePricingRule(command.payload.method, command.payload.targetPercent, command.payload.rounding);
      let pricing = state.menuPrices.find((entry) => entry.itemId === item.id);
      if (!pricing) { pricing = { itemId: item.id, approvedPrice: 0, method: command.payload.method, targetPercent: command.payload.targetPercent, rounding: command.payload.rounding, updatedAt: at }; state.menuPrices.push(pricing); }
      pricing.method = command.payload.method;
      pricing.targetPercent = command.payload.targetPercent;
      pricing.rounding = command.payload.rounding;
      pricing.updatedAt = at;
      return finish();
    }

    case "approve_price": {
      const item = itemById(command.payload.itemId);
      const pricing = state.menuPrices.find((entry) => entry.itemId === item.id);
      if (!pricing) throw new Error("Configure a pricing rule first.");
      const suggestion = calculateSuggestedPrice(item.currentCost, pricing.method, pricing.targetPercent, pricing.rounding);
      if (suggestion === null) throw new Error("A suggested price is unavailable until all component costs are complete.");
      pricing.approvedPrice = suggestion;
      pricing.updatedAt = at;
      state.activities.unshift({ id: uid("activity"), kind: "approval", title: `${item.name} price approved`, detail: `${actorName} approved the suggested price of ₱${suggestion.toFixed(2)}.`, createdAt: at });
      return finish();
    }

    default: {
      const unknown = command as { type?: unknown };
      throw new Error(`Unknown command type: ${String(unknown.type)}.`);
    }
  }
}

export function createEmptyState(): WorkspaceState {
  return {
    schemaVersion: 2,
    businessName: "TMG Accounting",
    branchName: "Main Branch",
    currency: "PHP",
    items: [],
    recipes: [],
    menuCategories: [],
    priceEvents: [],
    stockMovements: [],
    menuPrices: [],
    activities: [],
    lastImpact: null,
  };
}

export function createSeedState(): WorkspaceState {
  const items: Item[] = [
    { id: "garlic", name: "Garlic", type: "RM", baseUnit: "pc", onHand: 20, reorderLevel: 12, currentCost: 12, supplier: "FreshFields Supply", active: true },
    { id: "tomato", name: "Tomato", type: "RM", baseUnit: "g", onHand: 8000, reorderLevel: 2500, currentCost: 0.1, supplier: "FreshFields Supply", active: true },
    { id: "chicken", name: "Ground Chicken", type: "RM", baseUnit: "g", onHand: 12000, reorderLevel: 4000, currentCost: 0.2, supplier: "Prime Poultry", active: true },
    { id: "box", name: "Burger Box", type: "PM", baseUnit: "pc", onHand: 120, reorderLevel: 50, currentCost: 5, supplier: "PackRight", active: true },
    { id: "paste", name: "Garlic Paste", type: "CoRM", baseUnit: "g", onHand: 600, reorderLevel: 200, currentCost: null, supplier: "", active: true },
    { id: "sauce", name: "House Sauce", type: "FB", baseUnit: "serving", onHand: 30, reorderLevel: 10, currentCost: null, supplier: "", active: true },
    { id: "patty", name: "Chicken Patty", type: "OM", baseUnit: "pc", onHand: 24, reorderLevel: 8, currentCost: null, supplier: "", active: true },
    { id: "burger", name: "Garlic Chicken Burger", type: "MI", baseUnit: "serving", onHand: 0, reorderLevel: 0, currentCost: null, supplier: "", active: true, categoryId: "category_burger" },
  ];
  const recipes: Recipe[] = [
    { id: "recipe_paste", outputItemId: "paste", outputQuantity: 100, components: [{ itemId: "garlic", quantity: 5 }], version: 1, status: "approved", notes: "Blended garlic preparation", updatedAt: "2026-10-10T02:00:00.000Z" },
    { id: "recipe_sauce", outputItemId: "sauce", outputQuantity: 5, components: [{ itemId: "paste", quantity: 20 }, { itemId: "tomato", quantity: 200 }], version: 1, status: "approved", notes: "Five standard portions", updatedAt: "2026-10-10T02:05:00.000Z" },
    { id: "recipe_patty", outputItemId: "patty", outputQuantity: 1, components: [{ itemId: "chicken", quantity: 150 }, { itemId: "sauce", quantity: 1 }], version: 1, status: "approved", notes: "One 150 g patty", updatedAt: "2026-10-10T02:10:00.000Z" },
    { id: "recipe_burger", outputItemId: "burger", outputQuantity: 1, components: [{ itemId: "sauce", quantity: 1 }, { itemId: "patty", quantity: 1 }, { itemId: "box", quantity: 1 }], version: 1, status: "approved", notes: "Takeaway configuration", updatedAt: "2026-10-10T02:15:00.000Z" },
  ];
  const state: WorkspaceState = {
    schemaVersion: 2, businessName: "TMG Accounting", branchName: "Main Branch", currency: "PHP", items, recipes,
    menuCategories: [{ id: "category_burger", name: "Burger", defaultComponents: [{ itemId: "sauce", quantity: 1 }, { itemId: "patty", quantity: 1 }], createdAt: "2026-10-10T02:12:00.000Z", updatedAt: "2026-10-10T02:12:00.000Z" }],
    priceEvents: [
      { id: "price_garlic_1", itemId: "garlic", source: "opening", packPrice: 90, packQuantity: 10, unitCost: 9, oldUnitCost: null, receivedQuantity: 10, revaluationDelta: 0, supplier: "FreshFields Supply", note: "Opening price", createdAt: "2026-08-04T01:00:00.000Z" },
      { id: "price_garlic_2", itemId: "garlic", source: "restock", packPrice: 100, packQuantity: 10, unitCost: 10, oldUnitCost: 9, receivedQuantity: 10, revaluationDelta: 10, supplier: "FreshFields Supply", note: "September receipt", createdAt: "2026-09-08T01:00:00.000Z" },
      { id: "price_garlic_3", itemId: "garlic", source: "restock", packPrice: 120, packQuantity: 10, unitCost: 12, oldUnitCost: 10, receivedQuantity: 10, revaluationDelta: 20, supplier: "FreshFields Supply", note: "October receipt", createdAt: "2026-10-12T01:00:00.000Z" },
      { id: "price_tomato", itemId: "tomato", source: "opening", packPrice: 100, packQuantity: 1000, unitCost: 0.1, oldUnitCost: null, receivedQuantity: 8000, revaluationDelta: 0, supplier: "FreshFields Supply", note: "Opening cost", createdAt: "2026-10-01T01:00:00.000Z" },
      { id: "price_chicken", itemId: "chicken", source: "opening", packPrice: 200, packQuantity: 1000, unitCost: 0.2, oldUnitCost: null, receivedQuantity: 12000, revaluationDelta: 0, supplier: "Prime Poultry", note: "Opening cost", createdAt: "2026-10-01T01:05:00.000Z" },
      { id: "price_box", itemId: "box", source: "opening", packPrice: 5, packQuantity: 1, unitCost: 5, oldUnitCost: null, receivedQuantity: 120, revaluationDelta: 0, supplier: "PackRight", note: "Opening cost", createdAt: "2026-10-01T01:10:00.000Z" },
    ],
    stockMovements: [],
    menuPrices: [{ itemId: "burger", approvedPrice: 79, method: "margin", targetPercent: 45, rounding: 5, updatedAt: "2026-10-10T03:00:00.000Z" }],
    activities: [
      { id: "activity_1", kind: "price", title: "Garlic Current Cost updated", detail: "Received 10 pc; four dependent items recalculated.", createdAt: "2026-10-12T01:00:00.000Z" },
      { id: "activity_2", kind: "recipe", title: "Garlic Chicken Burger recipe approved", detail: "Version 1 · takeaway configuration", createdAt: "2026-10-10T02:15:00.000Z" },
    ],
    lastImpact: { sourceItemId: "garlic", affectedItemIds: ["paste", "sauce", "patty", "burger"], oldCost: 10, newCost: 12, revaluationDelta: 101.6, createdAt: "2026-10-12T01:00:00.000Z" },
  };
  recomputeRecipeCosts(state, "2026-10-10T02:20:00.000Z");
  state.activities = state.activities.slice(0, 100);
  return state;
}
