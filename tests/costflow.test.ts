import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  calculateSuggestedPrice,
  createEmptyState,
  createSeedState,
  getCostSlots,
  normalizeWorkspaceState,
  type WorkspaceCommand,
  type WorkspaceState,
} from "../lib/costflow.ts";
import { safeSameOriginUrl } from "../lib/safe-redirect.ts";

const item = (state: WorkspaceState, id: string) => {
  const found = state.items.find((entry) => entry.id === id);
  assert.ok(found, `Missing item ${id}`);
  return found;
};

const itemNamed = (state: WorkspaceState, name: string) => {
  const found = state.items.find((entry) => entry.name === name);
  assert.ok(found, `Missing item ${name}`);
  return found;
};

const addCheese = (state: WorkspaceState) => applyCommand(state, {
  type: "add_raw_material",
  payload: { name: "Cheese", baseUnit: "pc", openingQuantity: 20, openingTotalCost: 140, reorderLevel: 5 },
}, "Test User");

test("new production workspaces start without demo accounting records", () => {
  const state = createEmptyState();

  assert.equal(state.schemaVersion, 2);
  assert.equal(state.businessName, "TMG Accounting");
  assert.deepEqual(state.items, []);
  assert.deepEqual(state.recipes, []);
  assert.deepEqual(state.menuCategories, []);
  assert.deepEqual(state.priceEvents, []);
  assert.deepEqual(state.stockMovements, []);
  assert.deepEqual(state.menuPrices, []);
  assert.deepEqual(state.activities, []);
  assert.equal(state.lastImpact, null);
});

test("unused items can be deleted with their transaction history", () => {
  let state = createEmptyState();
  state = addCheese(state);
  const cheese = itemNamed(state, "Cheese");

  state = applyCommand(state, { type: "delete_item", payload: { itemId: cheese.id } }, "Test User");

  assert.equal(state.items.some((entry) => entry.id === cheese.id), false);
  assert.equal(state.priceEvents.some((entry) => entry.itemId === cheese.id), false);
  assert.equal(state.stockMovements.some((entry) => entry.itemId === cheese.id), false);
  assert.match(state.activities[0].title, /Cheese deleted/);
});

test("items used by recipes cannot be deleted", () => {
  const state = createSeedState();
  assert.throws(
    () => applyCommand(state, { type: "delete_item", payload: { itemId: "garlic" } }, "Test User"),
    /used by: Garlic Paste/,
  );
});

test("auth callback redirects stay on the CostFlow origin", () => {
  assert.equal(safeSameOriginUrl("/inventory?tab=rm", "https://costflow.example").href, "https://costflow.example/inventory?tab=rm");
  assert.equal(safeSameOriginUrl("https://evil.example", "https://costflow.example").href, "https://costflow.example/");
  assert.equal(safeSameOriginUrl("//evil.example", "https://costflow.example").href, "https://costflow.example/");
  assert.equal(safeSameOriginUrl("/\\evil.example", "https://costflow.example").href, "https://costflow.example/");
});

test("seed is schema v2 with a durable Burger template and replacement-cost history", () => {
  const state = createSeedState();

  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(getCostSlots(state, "garlic"), { current: 12, recent: 10, previous: 9 });
  assert.equal(item(state, "garlic").onHand, 20);
  assert.equal(item(state, "burger").currentCost, 47.8);
  assert.equal(item(state, "burger").categoryId, "category_burger");
  assert.deepEqual(state.menuCategories[0], {
    id: "category_burger",
    name: "Burger",
    defaultComponents: [{ itemId: "sauce", quantity: 1 }, { itemId: "patty", quantity: 1 }],
    createdAt: "2026-10-10T02:12:00.000Z",
    updatedAt: "2026-10-10T02:12:00.000Z",
  });
  assert.equal(state.menuPrices[0].approvedPrice, 79);
});

test("v1 workspaces migrate without losing records, normalize known units, and preserve legacy units", () => {
  const seeded = createSeedState();
  const legacy = JSON.parse(JSON.stringify(seeded)) as {
    schemaVersion: number;
    menuCategories?: unknown;
    items: Array<Record<string, unknown>>;
    recipes: unknown[];
    priceEvents: unknown[];
  };
  legacy.schemaVersion = 1;
  delete legacy.menuCategories;
  legacy.items.find((entry) => entry.id === "garlic")!.baseUnit = "PCs";
  legacy.items.find((entry) => entry.id === "tomato")!.baseUnit = "grams";
  legacy.items.find((entry) => entry.id === "chicken")!.baseUnit = "kg";

  const migrated = normalizeWorkspaceState(legacy);

  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.menuCategories, []);
  assert.equal(item(migrated, "garlic").baseUnit, "pc");
  assert.equal(item(migrated, "tomato").baseUnit, "g");
  assert.equal(item(migrated, "chicken").baseUnit, "kg");
  assert.equal(item(migrated, "burger").categoryId, null);
  assert.equal(migrated.items.length, legacy.items.length);
  assert.equal(migrated.recipes.length, legacy.recipes.length);
  assert.equal(migrated.priceEvents.length, legacy.priceEvents.length);
  assert.throws(() => normalizeWorkspaceState({ ...legacy, schemaVersion: 99 }), /Unsupported workspace schema version/);
});

test("inventory creation is RM-only and accepts only canonical base units", () => {
  const state = addCheese(createSeedState());
  const cheese = itemNamed(state, "Cheese");

  assert.equal(cheese.type, "RM");
  assert.equal(cheese.baseUnit, "pc");
  assert.equal(cheese.currentCost, 7);
  assert.equal(cheese.onHand, 20);

  const legacyCreate = {
    type: "add_item",
    payload: { name: "Forbidden Menu Item", itemType: "MI", baseUnit: "serving", openingQuantity: 0, openingTotalCost: null, reorderLevel: 0 },
  } as unknown as WorkspaceCommand;
  assert.throws(() => applyCommand(state, legacyCreate, "Test User"), /Unknown command type: add_item/);

  const invalidUnit = {
    type: "add_raw_material",
    payload: { name: "Flour", baseUnit: "kg", openingQuantity: 1, openingTotalCost: 50, reorderLevel: 0 },
  } as unknown as WorkspaceCommand;
  assert.throws(() => applyCommand(state, invalidUnit, "Test User"), /Invalid base unit/);
});

test("opening total purchase cost is divided by opening quantity", () => {
  const state = applyCommand(createEmptyState(), {
    type: "add_raw_material",
    payload: {
      name: "Cooking Oil",
      baseUnit: "ml",
      openingQuantity: 1000,
      openingTotalCost: 300,
      reorderLevel: 100,
    },
  }, "Test User");

  const oil = itemNamed(state, "Cooking Oil");
  const openingPrice = state.priceEvents.find((event) => event.itemId === oil.id);
  const openingMovement = state.stockMovements.find((movement) => movement.itemId === oil.id);

  assert.equal(oil.currentCost, 0.3);
  assert.equal(openingPrice?.packPrice, 300);
  assert.equal(openingPrice?.packQuantity, 1000);
  assert.equal(openingPrice?.unitCost, 0.3);
  assert.equal(openingMovement?.totalValue, 300);

  assert.throws(() => applyCommand(createEmptyState(), {
    type: "add_raw_material",
    payload: { name: "Invalid Oil", baseUnit: "ml", openingQuantity: 0, openingTotalCost: 300, reorderLevel: 0 },
  }, "Test User"), /Opening quantity must be greater than zero/);
});

test("recipe item creation atomically creates a CoRM, FB, or OM output and its recipe", () => {
  const state = applyCommand(createSeedState(), {
    type: "create_recipe_item",
    payload: {
      name: "Tomato Base",
      itemType: "FB",
      baseUnit: "serving",
      openingQuantity: 5,
      reorderLevel: 2,
      outputQuantity: 10,
      components: [{ itemId: "tomato", quantity: 1000 }],
      notes: "Ten portions",
    },
  }, "Test User");
  const output = itemNamed(state, "Tomato Base");
  const recipe = state.recipes.find((entry) => entry.outputItemId === output.id);

  assert.equal(output.type, "FB");
  assert.equal(output.currentCost, 10);
  assert.equal(recipe?.version, 1);
  assert.deepEqual(recipe?.components, [{ itemId: "tomato", quantity: 1000 }]);
  assert.equal(state.stockMovements.at(-1)?.totalValue, 50);

  const seed = createSeedState();
  const forbidden = {
    type: "create_recipe_item",
    payload: { name: "Orphan Menu", itemType: "MI", baseUnit: "serving", openingQuantity: 0, reorderLevel: 0, outputQuantity: 1, components: [{ itemId: "sauce", quantity: 1 }] },
  } as unknown as WorkspaceCommand;
  assert.throws(() => applyCommand(seed, forbidden, "Test User"), /must be CoRM, FB, or OM/);
  assert.equal(seed.items.some((entry) => entry.name === "Orphan Menu"), false);
});

test("recipe editing is limited to CoRM, FB, and OM and still rejects cycles", () => {
  assert.throws(() => applyCommand(createSeedState(), {
    type: "save_recipe",
    payload: { outputItemId: "burger", outputQuantity: 1, components: [{ itemId: "sauce", quantity: 1 }] },
  }, "Test User"), /managed from the Menu tab/);

  let state = applyCommand(createSeedState(), {
    type: "create_recipe_item",
    payload: {
      name: "Second Paste",
      itemType: "CoRM",
      baseUnit: "g",
      openingQuantity: 0,
      reorderLevel: 0,
      outputQuantity: 1,
      components: [{ itemId: "paste", quantity: 1 }],
    },
  }, "Test User");
  const secondPaste = itemNamed(state, "Second Paste");

  assert.throws(() => applyCommand(state, {
    type: "save_recipe",
    payload: { outputItemId: "paste", outputQuantity: 1, components: [{ itemId: secondPaste.id, quantity: 1 }] },
  }, "Test User"), /Circular recipe detected/);

  state = applyCommand(state, {
    type: "save_recipe",
    payload: { outputItemId: secondPaste.id, outputQuantity: 2, components: [{ itemId: "garlic", quantity: 1 }] },
  }, "Test User");
  assert.equal(state.recipes.find((entry) => entry.outputItemId === secondPaste.id)?.version, 2);
});

test("menu categories accept only FB and OM snapshot defaults", () => {
  const state = applyCommand(createSeedState(), {
    type: "add_menu_category",
    payload: { name: "Signature", defaultComponents: [{ itemId: "sauce", quantity: 1 }, { itemId: "patty", quantity: 2 }] },
  }, "Test User");

  assert.deepEqual(state.menuCategories.at(-1)?.defaultComponents, [{ itemId: "sauce", quantity: 1 }, { itemId: "patty", quantity: 2 }]);
  assert.throws(() => applyCommand(state, {
    type: "add_menu_category",
    payload: { name: "Raw Defaults", defaultComponents: [{ itemId: "garlic", quantity: 1 }] },
  }, "Test User"), /only FB and OM/);
  assert.throws(() => applyCommand(state, {
    type: "add_menu_category",
    payload: { name: "signature", defaultComponents: [] },
  }, "Test User"), /already exists/);
});

test("Burger category creates Cheese Burger with defaults plus custom Cheese in one atomic command", () => {
  const withCheese = addCheese(createSeedState());
  const cheese = itemNamed(withCheese, "Cheese");
  const state = applyCommand(withCheese, {
    type: "create_menu_item",
    payload: {
      name: "Cheese Burger",
      categoryId: "category_burger",
      baseUnit: "serving",
      outputQuantity: 1,
      components: [
        { itemId: "sauce", quantity: 1 },
        { itemId: "patty", quantity: 1 },
        { itemId: cheese.id, quantity: 1 },
      ],
      notes: "Burger defaults plus cheese",
      pricing: { method: "margin", targetPercent: 45, rounding: 5 },
    },
  }, "Test User");
  const burger = itemNamed(state, "Cheese Burger");
  const recipe = state.recipes.find((entry) => entry.outputItemId === burger.id);
  const pricing = state.menuPrices.find((entry) => entry.itemId === burger.id);

  assert.equal(burger.type, "MI");
  assert.equal(burger.categoryId, "category_burger");
  assert.equal(burger.currentCost, 49.8);
  assert.deepEqual(recipe?.components, [
    { itemId: "sauce", quantity: 1 },
    { itemId: "patty", quantity: 1 },
    { itemId: cheese.id, quantity: 1 },
  ]);
  assert.deepEqual(pricing && { approvedPrice: pricing.approvedPrice, method: pricing.method, targetPercent: pricing.targetPercent, rounding: pricing.rounding }, { approvedPrice: 0, method: "margin", targetPercent: 45, rounding: 5 });

  state.menuCategories[0].defaultComponents[0].quantity = 9;
  assert.equal(recipe?.components[0].quantity, 1, "menu recipe keeps its category snapshot");
});

test("menu creation automatically merges category defaults and permits extra custom lines", () => {
  const withCheese = addCheese(createSeedState());
  const cheese = itemNamed(withCheese, "Cheese");

  const automatic = applyCommand(withCheese, {
    type: "create_menu_item",
    payload: {
      name: "Automatic Cheese Burger",
      categoryId: "category_burger",
      baseUnit: "serving",
      outputQuantity: 1,
      components: [{ itemId: cheese.id, quantity: 1 }],
      pricing: { method: "markup", targetPercent: 30, rounding: 1 },
    },
  }, "Test User");
  const automaticItem = itemNamed(automatic, "Automatic Cheese Burger");
  assert.deepEqual(automatic.recipes.find((entry) => entry.outputItemId === automaticItem.id)?.components, [
    { itemId: "sauce", quantity: 1 },
    { itemId: "patty", quantity: 1 },
    { itemId: cheese.id, quantity: 1 },
  ]);

  const uncategorized = applyCommand(withCheese, {
    type: "create_menu_item",
    payload: {
      name: "Cheese Plate",
      categoryId: null,
      baseUnit: "serving",
      outputQuantity: 1,
      components: [{ itemId: cheese.id, quantity: 2 }],
      pricing: { method: "markup", targetPercent: 30, rounding: 1 },
    },
  }, "Test User");
  assert.equal(itemNamed(uncategorized, "Cheese Plate").currentCost, 14);
});

test("restock uses the new price for old and new stock and cascades recipe costs", () => {
  const state = applyCommand(createSeedState(), {
    type: "update_price",
    payload: { itemId: "garlic", mode: "restock", packPrice: 150, packQuantity: 10, receivedQuantity: 10, supplier: "FreshFields Supply", note: "Test receipt" },
  }, "Test User");

  assert.equal(item(state, "garlic").onHand, 30);
  assert.equal(item(state, "garlic").currentCost, 15);
  assert.equal(item(state, "burger").currentCost, 49);
  assert.equal(state.lastImpact?.revaluationDelta, 182.4);
  assert.equal(state.stockMovements.at(-1)?.totalValue, 150);
  assert.equal(state.menuPrices[0].approvedPrice, 79);
  assert.deepEqual(getCostSlots(state, "garlic"), { current: 15, recent: 12, previous: 10 });
});

test("market update reprices all stock without changing quantity", () => {
  const seed = createSeedState();
  const movementCount = seed.stockMovements.length;
  const state = applyCommand(seed, {
    type: "update_price",
    payload: { itemId: "garlic", mode: "market", packPrice: 80, packQuantity: 10, receivedQuantity: 999, note: "Market quotation" },
  }, "Test User");

  assert.equal(item(state, "garlic").onHand, 20);
  assert.equal(item(state, "garlic").currentCost, 8);
  assert.equal(item(state, "burger").currentCost, 46.2);
  assert.equal(state.lastImpact?.revaluationDelta, -243.2);
  assert.equal(state.stockMovements.length, movementCount);
  assert.equal(state.menuPrices[0].approvedPrice, 79);
  assert.deepEqual(getCostSlots(state, "garlic"), { current: 8, recent: 12, previous: 10 });

  const invalidMode = {
    type: "update_price",
    payload: { itemId: "garlic", mode: "bogus", packPrice: 130, packQuantity: 10, receivedQuantity: 0 },
  } as unknown as WorkspaceCommand;
  assert.throws(() => applyCommand(seed, invalidMode, "Test User"), /mode must be restock or market/);
  assert.equal(item(seed, "garlic").currentCost, 12);
});

test("markup and margin pricing use different formulas and round upward", () => {
  assert.equal(calculateSuggestedPrice(40.6, "margin", 45, 5), 75);
  assert.equal(calculateSuggestedPrice(40.6, "markup", 45, 5), 60);
  assert.equal(calculateSuggestedPrice(40.6, "margin", 100, 5), null);
});

test("unknown commands fail explicitly instead of silently succeeding", () => {
  const command = { type: "mystery_command", payload: {} } as unknown as WorkspaceCommand;
  assert.throws(() => applyCommand(createSeedState(), command, "Test User"), /Unknown command type: mystery_command/);
});
