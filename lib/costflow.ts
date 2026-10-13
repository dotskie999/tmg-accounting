export const ITEM_TYPES = ["RM", "CoRM", "FB", "OM", "PM", "MI"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export type PriceUpdateMode = "restock" | "market";
export type PricingMethod = "markup" | "margin";

export type Item = {
  id: string;
  name: string;
  type: ItemType;
  baseUnit: string;
  onHand: number;
  reorderLevel: number;
  currentCost: number | null;
  supplier: string;
  active: boolean;
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
  schemaVersion: 1;
  businessName: string;
  branchName: string;
  currency: "PHP";
  items: Item[];
  recipes: Recipe[];
  priceEvents: PriceEvent[];
  stockMovements: StockMovement[];
  menuPrices: MenuPrice[];
  activities: Activity[];
  lastImpact: CostImpact | null;
};

export type WorkspaceCommand =
  | { type: "update_price"; payload: { itemId: string; mode: PriceUpdateMode; receivedQuantity: number; packPrice: number; packQuantity: number; supplier?: string; note?: string } }
  | { type: "adjust_stock"; payload: { itemId: string; quantityChange: number; reason: string } }
  | { type: "add_item"; payload: { name: string; itemType: ItemType; baseUnit: string; openingQuantity: number; openingUnitCost: number | null; reorderLevel: number; supplier?: string } }
  | { type: "save_recipe"; payload: { outputItemId: string; outputQuantity: number; components: RecipeComponent[]; notes?: string } }
  | { type: "update_pricing"; payload: { itemId: string; method: PricingMethod; targetPercent: number; rounding: number } }
  | { type: "approve_price"; payload: { itemId: string } };

const ALLOWED_COMPONENTS: Record<ItemType, ItemType[]> = {
  RM: [], PM: [], CoRM: ["RM", "CoRM"], FB: ["RM", "CoRM", "FB"],
  OM: ["RM", "CoRM", "FB", "OM", "PM"], MI: ["RM", "CoRM", "FB", "OM", "PM"],
};

const round6 = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

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
  const itemById = (id: string) => {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) throw new Error("Item not found.");
    return item;
  };

  if (command.type === "update_price") {
    const item = itemById(command.payload.itemId);
    if (!["RM", "PM"].includes(item.type)) throw new Error("Only purchased RM and PM items accept direct price updates.");
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
  }

  if (command.type === "adjust_stock") {
    const item = itemById(command.payload.itemId);
    if (!Number.isFinite(command.payload.quantityChange) || command.payload.quantityChange === 0) throw new Error("Adjustment quantity cannot be zero.");
    const next = round6(item.onHand + command.payload.quantityChange);
    if (next < 0) throw new Error("This adjustment would create negative stock.");
    if (!command.payload.reason.trim()) throw new Error("An adjustment reason is required.");
    item.onHand = next;
    state.stockMovements.push({ id: uid("move"), itemId: item.id, type: "adjustment", quantityChange: round6(command.payload.quantityChange), unitCostSnapshot: item.currentCost, totalValue: round2(command.payload.quantityChange * (item.currentCost ?? 0)), reference: command.payload.reason.trim(), createdAt: at });
    state.activities.unshift({ id: uid("activity"), kind: "stock", title: `${item.name} stock adjusted`, detail: `${command.payload.quantityChange > 0 ? "+" : ""}${command.payload.quantityChange} ${item.baseUnit} · ${command.payload.reason.trim()}`, createdAt: at });
  }

  if (command.type === "add_item") {
    const name = command.payload.name.trim();
    if (!name) throw new Error("Item name is required.");
    if (state.items.some((item) => item.name.toLowerCase() === name.toLowerCase())) throw new Error("An item with this name already exists.");
    if (!ITEM_TYPES.includes(command.payload.itemType)) throw new Error("Invalid item type.");
    if (!command.payload.baseUnit.trim()) throw new Error("Base unit is required.");
    assertFiniteNonNegative(command.payload.openingQuantity, "Opening quantity");
    assertFiniteNonNegative(command.payload.reorderLevel, "Reorder level");
    if (command.payload.openingUnitCost !== null) assertFiniteNonNegative(command.payload.openingUnitCost, "Opening cost");
    const id = uid("item");
    const directCost = ["RM", "PM"].includes(command.payload.itemType) ? command.payload.openingUnitCost : null;
    state.items.push({ id, name, type: command.payload.itemType, baseUnit: command.payload.baseUnit.trim(), onHand: round6(command.payload.openingQuantity), reorderLevel: round6(command.payload.reorderLevel), currentCost: directCost === null ? null : round6(directCost), supplier: command.payload.supplier?.trim() ?? "", active: true });
    if (directCost !== null) state.priceEvents.push({ id: uid("price"), itemId: id, source: "opening", packPrice: directCost, packQuantity: 1, unitCost: round6(directCost), oldUnitCost: null, receivedQuantity: command.payload.openingQuantity, revaluationDelta: 0, supplier: command.payload.supplier?.trim() ?? "", note: "Opening cost", createdAt: at });
    if (command.payload.openingQuantity > 0) state.stockMovements.push({ id: uid("move"), itemId: id, type: "opening", quantityChange: command.payload.openingQuantity, unitCostSnapshot: directCost, totalValue: round2(command.payload.openingQuantity * (directCost ?? 0)), reference: "Opening stock", createdAt: at });
    if (command.payload.itemType === "MI") state.menuPrices.push({ itemId: id, approvedPrice: 0, method: "margin", targetPercent: 45, rounding: 5, updatedAt: at });
    state.activities.unshift({ id: uid("activity"), kind: "item", title: `${name} created`, detail: `${command.payload.itemType} · ${command.payload.baseUnit}`, createdAt: at });
  }

  if (command.type === "save_recipe") {
    const output = itemById(command.payload.outputItemId);
    if (["RM", "PM"].includes(output.type)) throw new Error("RM and PM items cannot have recipes.");
    if (!Number.isFinite(command.payload.outputQuantity) || command.payload.outputQuantity <= 0) throw new Error("Recipe output must be greater than zero.");
    if (!command.payload.components.length) throw new Error("Add at least one component.");
    const seen = new Set<string>();
    const components = command.payload.components.map((component) => {
      const item = itemById(component.itemId);
      if (seen.has(item.id)) throw new Error(`${item.name} appears more than once in this recipe.`);
      seen.add(item.id);
      if (!ALLOWED_COMPONENTS[output.type].includes(item.type)) throw new Error(`${item.type} cannot be used inside a ${output.type} recipe.`);
      if (!Number.isFinite(component.quantity) || component.quantity <= 0) throw new Error(`Quantity for ${item.name} must be greater than zero.`);
      return { itemId: item.id, quantity: round6(component.quantity) };
    });
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
  }

  if (command.type === "update_pricing") {
    const item = itemById(command.payload.itemId);
    if (item.type !== "MI") throw new Error("Pricing rules apply only to menu items.");
    assertFiniteNonNegative(command.payload.targetPercent, "Target percentage");
    if (command.payload.method === "margin" && command.payload.targetPercent >= 100) throw new Error("Target margin must be below 100%.");
    if (![1, 5, 10].includes(command.payload.rounding)) throw new Error("Invalid rounding increment.");
    let pricing = state.menuPrices.find((entry) => entry.itemId === item.id);
    if (!pricing) { pricing = { itemId: item.id, approvedPrice: 0, method: command.payload.method, targetPercent: command.payload.targetPercent, rounding: command.payload.rounding, updatedAt: at }; state.menuPrices.push(pricing); }
    pricing.method = command.payload.method;
    pricing.targetPercent = command.payload.targetPercent;
    pricing.rounding = command.payload.rounding;
    pricing.updatedAt = at;
  }

  if (command.type === "approve_price") {
    const item = itemById(command.payload.itemId);
    const pricing = state.menuPrices.find((entry) => entry.itemId === item.id);
    if (!pricing) throw new Error("Configure a pricing rule first.");
    const suggestion = calculateSuggestedPrice(item.currentCost, pricing.method, pricing.targetPercent, pricing.rounding);
    if (suggestion === null) throw new Error("A suggested price is unavailable until all component costs are complete.");
    pricing.approvedPrice = suggestion;
    pricing.updatedAt = at;
    state.activities.unshift({ id: uid("activity"), kind: "approval", title: `${item.name} price approved`, detail: `${actorName} approved the suggested price of ₱${suggestion.toFixed(2)}.`, createdAt: at });
  }

  state.activities = state.activities.slice(0, 100);
  return state;
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
    { id: "burger", name: "Garlic Chicken Burger", type: "MI", baseUnit: "serving", onHand: 0, reorderLevel: 0, currentCost: null, supplier: "", active: true },
  ];
  const recipes: Recipe[] = [
    { id: "recipe_paste", outputItemId: "paste", outputQuantity: 100, components: [{ itemId: "garlic", quantity: 5 }], version: 1, status: "approved", notes: "Blended garlic preparation", updatedAt: "2026-10-10T02:00:00.000Z" },
    { id: "recipe_sauce", outputItemId: "sauce", outputQuantity: 5, components: [{ itemId: "paste", quantity: 20 }, { itemId: "tomato", quantity: 200 }], version: 1, status: "approved", notes: "Five standard portions", updatedAt: "2026-10-10T02:05:00.000Z" },
    { id: "recipe_patty", outputItemId: "patty", outputQuantity: 1, components: [{ itemId: "chicken", quantity: 150 }, { itemId: "sauce", quantity: 1 }], version: 1, status: "approved", notes: "One 150 g patty", updatedAt: "2026-10-10T02:10:00.000Z" },
    { id: "recipe_burger", outputItemId: "burger", outputQuantity: 1, components: [{ itemId: "patty", quantity: 1 }, { itemId: "box", quantity: 1 }], version: 1, status: "approved", notes: "Takeaway configuration", updatedAt: "2026-10-10T02:15:00.000Z" },
  ];
  const state: WorkspaceState = {
    schemaVersion: 1, businessName: "CostFlow Kitchen", branchName: "Main Branch", currency: "PHP", items, recipes,
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
