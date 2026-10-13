import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  calculateSuggestedPrice,
  createSeedState,
  getCostSlots,
} from "../lib/costflow.ts";

const item = (state: ReturnType<typeof createSeedState>, id: string) => {
  const found = state.items.find((entry) => entry.id === id);
  assert.ok(found, `Missing item ${id}`);
  return found;
};

test("seed demonstrates Previous, Recent, Current replacement costs", () => {
  const state = createSeedState();

  assert.deepEqual(getCostSlots(state, "garlic"), {
    current: 12,
    recent: 10,
    previous: 9,
  });
  assert.equal(item(state, "garlic").onHand, 20);
  assert.equal(item(state, "burger").currentCost, 41.4);
  assert.equal(state.menuPrices[0].approvedPrice, 79);
});

test("restock uses the new price for old and new stock and cascades recipe costs", () => {
  const state = applyCommand(createSeedState(), {
    type: "update_price",
    payload: {
      itemId: "garlic",
      mode: "restock",
      packPrice: 150,
      packQuantity: 10,
      receivedQuantity: 10,
      supplier: "FreshFields Supply",
      note: "Test receipt",
    },
  }, "Test User");

  assert.equal(item(state, "garlic").onHand, 30);
  assert.equal(item(state, "garlic").currentCost, 15);
  assert.equal(item(state, "burger").currentCost, 42);
  assert.equal(state.lastImpact?.revaluationDelta, 182.4);
  assert.equal(state.stockMovements.at(-1)?.totalValue, 150);
  assert.equal(state.menuPrices[0].approvedPrice, 79);
  assert.deepEqual(getCostSlots(state, "garlic"), {
    current: 15,
    recent: 12,
    previous: 10,
  });
});

test("market update reprices all stock without changing quantity", () => {
  const seed = createSeedState();
  const movementCount = seed.stockMovements.length;
  const state = applyCommand(seed, {
    type: "update_price",
    payload: {
      itemId: "garlic",
      mode: "market",
      packPrice: 80,
      packQuantity: 10,
      receivedQuantity: 999,
      note: "Market quotation",
    },
  }, "Test User");

  assert.equal(item(state, "garlic").onHand, 20);
  assert.equal(item(state, "garlic").currentCost, 8);
  assert.equal(item(state, "burger").currentCost, 40.6);
  assert.equal(state.lastImpact?.revaluationDelta, -243.2);
  assert.equal(state.stockMovements.length, movementCount);
  assert.equal(state.menuPrices[0].approvedPrice, 79);
  assert.deepEqual(getCostSlots(state, "garlic"), {
    current: 8,
    recent: 12,
    previous: 10,
  });
});

test("markup and margin pricing use different formulas and round upward", () => {
  assert.equal(calculateSuggestedPrice(40.6, "margin", 45, 5), 75);
  assert.equal(calculateSuggestedPrice(40.6, "markup", 45, 5), 60);
  assert.equal(calculateSuggestedPrice(40.6, "margin", 100, 5), null);
});

test("circular recipes are rejected", () => {
  let state = applyCommand(createSeedState(), {
    type: "add_item",
    payload: {
      name: "Second Paste",
      itemType: "CoRM",
      baseUnit: "g",
      openingQuantity: 0,
      openingUnitCost: null,
      reorderLevel: 0,
    },
  }, "Test User");
  const secondPaste = state.items.find((entry) => entry.name === "Second Paste");
  assert.ok(secondPaste);

  state = applyCommand(state, {
    type: "save_recipe",
    payload: {
      outputItemId: secondPaste.id,
      outputQuantity: 1,
      components: [{ itemId: "paste", quantity: 1 }],
    },
  }, "Test User");

  assert.throws(() => applyCommand(state, {
    type: "save_recipe",
    payload: {
      outputItemId: "paste",
      outputQuantity: 1,
      components: [{ itemId: secondPaste.id, quantity: 1 }],
    },
  }, "Test User"), /Circular recipe detected/);
});
