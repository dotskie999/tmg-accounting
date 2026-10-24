"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeDollarSign,
  Boxes,
  ChartNoAxesCombined,
  Check,
  ChefHat,
  ChevronRight,
  CircleDollarSign,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Trash2,
  UtensilsCrossed,
  Warehouse,
  X,
} from "lucide-react";
import {
  BASE_UNITS,
  ITEM_TYPES,
  actualMargin,
  calculateSuggestedPrice,
  dependentIds,
  getCostSlots,
  inventoryValue,
  type BaseUnit,
  type Item,
  type ItemType,
  type PricingMethod,
  type WorkspaceCommand,
  type WorkspaceState,
} from "@/lib/costflow";

type View = "dashboard" | "inventory" | "recipes" | "menu" | "pricing" | "reports" | "settings";
type ModalName = "price" | "item" | "recipe" | "category" | "menu" | "pricing" | null;

const NAV: { id: View; label: string; description: string; group: "Daily work" | "Review" | "Account"; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Home", description: "Start here", group: "Daily work", icon: LayoutDashboard },
  { id: "inventory", label: "Stock & Prices", description: "Ingredients and purchases", group: "Daily work", icon: Boxes },
  { id: "recipes", label: "Preparations", description: "Sauces, bases, and batches", group: "Daily work", icon: ChefHat },
  { id: "menu", label: "Menu Items", description: "What you sell", group: "Daily work", icon: UtensilsCrossed },
  { id: "pricing", label: "Selling Prices", description: "Margin and markup", group: "Review", icon: BadgeDollarSign },
  { id: "reports", label: "History", description: "Changes and activity", group: "Review", icon: ChartNoAxesCombined },
  { id: "settings", label: "Help & Account", description: "Rules and sign out", group: "Account", icon: Settings },
];

const NAV_GROUPS = ["Daily work", "Review", "Account"] as const;

const TYPE_LABELS: Record<ItemType, string> = {
  RM: "Raw material",
  CoRM: "Combined ingredient",
  FB: "Food base",
  OM: "Prepared item",
  PM: "Packaging",
  MI: "Menu item",
};

const ALLOWED: Record<ItemType, ItemType[]> = {
  RM: [], PM: [], CoRM: ["RM", "CoRM"], FB: ["RM", "CoRM", "FB"],
  OM: ["RM", "CoRM", "FB", "OM", "PM"], MI: ["RM", "CoRM", "FB", "OM", "PM"],
};

const RECIPE_OUTPUT_TYPES = ["CoRM", "FB", "OM"] as const;
const UNIT_LABELS: Record<BaseUnit, string> = { pc: "PCs", g: "g", ml: "ml", serving: "serving" };

const money = (value: number | null | undefined, maximumFractionDigits = 2) =>
  value === null || value === undefined || Number.isNaN(value)
    ? "Unavailable"
    : new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        minimumFractionDigits: Math.min(2, maximumFractionDigits),
        maximumFractionDigits,
      }).format(value);

const number = (value: number, digits = 2) =>
  new Intl.NumberFormat("en-PH", { maximumFractionDigits: digits }).format(value);

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(value));

type WorkspaceResponse = { state?: WorkspaceState; revision?: number; error?: string };

async function requestWorkspace() {
  const response = await fetch("/api/workspace", { cache: "no-store" });
  const data = await response.json() as WorkspaceResponse;
  if (!response.ok || !data.state || !data.revision) throw new Error(data.error || "Unable to load the workspace.");
  return { state: data.state, revision: data.revision };
}

function TypeBadge({ type }: { type: ItemType }) {
  return <span className={`type-badge type-${type}`} title={`${TYPE_LABELS[type]} (${type})`} aria-label={`${TYPE_LABELS[type]} (${type})`}>{type}</span>;
}

function Modal({ title, eyebrow, children, onClose }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 id="modal-title">{title}</h2></div>
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><Sparkles size={22} /><strong>{title}</strong><span>{detail}</span></div>;
}

export default function CostFlowApp({ userName, signOutPath }: { userName: string; signOutPath: string }) {
  const [view, setView] = useState<View>("dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<ModalName>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ItemType>("all");
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>("");

  const [priceItemId, setPriceItemId] = useState("garlic");
  const [priceMode, setPriceMode] = useState<"restock" | "market">("restock");
  const [receivedQuantity, setReceivedQuantity] = useState("10");
  const [packPrice, setPackPrice] = useState("120");
  const [packQuantity, setPackQuantity] = useState("10");
  const [priceSupplier, setPriceSupplier] = useState("");
  const [priceNote, setPriceNote] = useState("");

  const [newItem, setNewItem] = useState({ name: "", baseUnit: "pc" as BaseUnit, openingQuantity: "0", openingTotalCost: "", reorderLevel: "0", supplier: "" });
  const [recipeDraft, setRecipeDraft] = useState<{ outputItemId: string; name: string; itemType: "CoRM" | "FB" | "OM"; baseUnit: BaseUnit; openingQuantity: string; reorderLevel: string; outputQuantity: string; components: { itemId: string; quantity: string }[]; notes: string }>({ outputItemId: "", name: "", itemType: "FB", baseUnit: "serving", openingQuantity: "0", reorderLevel: "0", outputQuantity: "1", components: [], notes: "" });
  const [categoryDraft, setCategoryDraft] = useState<{ name: string; defaultComponents: { itemId: string; quantity: string }[] }>({ name: "", defaultComponents: [] });
  const [menuDraft, setMenuDraft] = useState<{ name: string; categoryId: string; baseUnit: BaseUnit; outputQuantity: string; components: { itemId: string; quantity: string }[]; notes: string }>({ name: "", categoryId: "", baseUnit: "serving", outputQuantity: "1", components: [], notes: "" });
  const [pricingDraft, setPricingDraft] = useState<{ itemId: string; method: PricingMethod; targetPercent: string; rounding: string }>({ itemId: "", method: "margin", targetPercent: "45", rounding: "5" });

  const refreshWorkspace = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await requestWorkspace();
      setState(data.state);
      setRevision(data.revision);
      setSelectedRecipeId((current) => current || data.state.recipes[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the workspace.");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    void requestWorkspace()
      .then((data) => {
        if (cancelled) return;
        setState(data.state);
        setRevision(data.revision);
        setSelectedRecipeId((current) => current || data.state.recipes[0]?.id || "");
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Unable to load the workspace.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const sendCommand = async (command: WorkspaceCommand, success: string) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision, command }) });
      const data = await response.json() as { state?: WorkspaceState; revision?: number; error?: string; conflict?: boolean };
      if (!response.ok || !data.state || !data.revision) {
        if (data.conflict) await refreshWorkspace();
        throw new Error(data.error || "The change could not be saved.");
      }
      setState(data.state);
      setRevision(data.revision);
      setToast(success);
      return data.state;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change could not be saved.");
      return null;
    } finally { setSaving(false); }
  };

  const itemMap = useMemo(() => new Map(state?.items.map((item) => [item.id, item]) ?? []), [state]);
  const recipeIsManagedHere = (recipe: WorkspaceState["recipes"][number]) => RECIPE_OUTPUT_TYPES.includes(itemMap.get(recipe.outputItemId)?.type as (typeof RECIPE_OUTPUT_TYPES)[number]);
  const selectedRecipe = state?.recipes.find((recipe) => recipe.id === selectedRecipeId && recipeIsManagedHere(recipe)) ?? state?.recipes.find(recipeIsManagedHere);

  if (loading) return <main className="loading-screen"><div className="brand-logo" role="img" aria-label="TMG Accounting" /><div className="loading-line" /><p>Preparing your accounting workspace…</p></main>;
  if (!state) return <main className="loading-screen"><AlertTriangle size={28} /><h1>TMG Accounting could not open</h1><p>{error}</p><button className="button primary" onClick={() => void refreshWorkspace()}><RefreshCw size={17} /> Try again</button></main>;

  const menuRows = state.items.filter((item) => item.type === "MI").map((item) => {
    const pricing = state.menuPrices.find((entry) => entry.itemId === item.id) ?? { itemId: item.id, approvedPrice: 0, method: "margin" as const, targetPercent: 45, rounding: 5, updatedAt: "" };
    const suggestion = calculateSuggestedPrice(item.currentCost, pricing.method, pricing.targetPercent, pricing.rounding);
    const margin = actualMargin(item.currentCost, pricing.approvedPrice);
    return { item, pricing, suggestion, margin, below: margin === null || margin + 0.0001 < pricing.targetPercent };
  });
  const lowStock = state.items.filter((item) => item.type !== "MI" && item.onHand <= item.reorderLevel);
  const directUpdates = state.priceEvents.filter((event) => event.source === "restock" || event.source === "market");
  const filteredItems = state.items.filter((item) => {
    const matchesSearch = `${item.name} ${item.supplier}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (typeFilter === "all" || item.type === typeFilter);
  });
  const firstPurchasedItem = state.items.find((item) => item.type === "RM" || item.type === "PM");
  const hasIngredient = state.items.some((item) => item.type === "RM");
  const hasPreparation = state.recipes.some(recipeIsManagedHere);
  const hasMenuItem = state.items.some((item) => item.type === "MI");
  const hasSellingPrice = state.menuPrices.some((price) => price.approvedPrice > 0);

  const beginRawMaterial = () => {
    setNewItem({ name: "", baseUnit: "pc", openingQuantity: "0", openingTotalCost: "", reorderLevel: "0", supplier: "" });
    setModal("item");
    setError("");
  };

  const openPrice = (item: Item) => {
    setPriceItemId(item.id); setPriceMode("restock"); setReceivedQuantity("");
    setPackQuantity("1"); setPackPrice(item.currentCost?.toString() ?? "");
    setPriceSupplier(item.supplier); setPriceNote(""); setModal("price"); setError("");
  };

  const beginRecipe = (outputItemId?: string) => {
    const output = outputItemId ? itemMap.get(outputItemId) : null;
    const outputType = output && RECIPE_OUTPUT_TYPES.includes(output.type as (typeof RECIPE_OUTPUT_TYPES)[number]) ? output.type as "CoRM" | "FB" | "OM" : "FB";
    const existing = output ? state.recipes.find((recipe) => recipe.outputItemId === output.id) : null;
    const firstAllowed = state.items.find((item) => item.id !== output?.id && ALLOWED[outputType].includes(item.type));
    setRecipeDraft({
      outputItemId: output?.id ?? "",
      name: output?.name ?? "",
      itemType: outputType,
      baseUnit: (output?.baseUnit as BaseUnit | undefined) ?? "serving",
      openingQuantity: output?.onHand.toString() ?? "0",
      reorderLevel: output?.reorderLevel.toString() ?? "0",
      outputQuantity: existing?.outputQuantity.toString() ?? "1",
      components: existing?.components.map((component) => ({ itemId: component.itemId, quantity: component.quantity.toString() })) ?? (firstAllowed ? [{ itemId: firstAllowed.id, quantity: "1" }] : []),
      notes: existing?.notes ?? "",
    });
    setModal("recipe"); setError("");
  };

  const beginCategory = () => {
    const first = state.items.find((item) => item.type === "FB" || item.type === "OM");
    setCategoryDraft({ name: "", defaultComponents: first ? [{ itemId: first.id, quantity: "1" }] : [] });
    setModal("category"); setError("");
  };

  const beginMenu = () => {
    setMenuDraft({ name: "", categoryId: "", baseUnit: "serving", outputQuantity: "1", components: [], notes: "" });
    setModal("menu"); setError("");
  };

  const startPreparation = () => {
    setView("recipes");
    beginRecipe();
  };

  const startMenuItem = () => {
    setView("menu");
    beginMenu();
  };

  const selectMenuCategory = (categoryId: string) => {
    const previous = state.menuCategories.find((category) => category.id === menuDraft.categoryId);
    const nextCategory = state.menuCategories.find((category) => category.id === categoryId);
    const priorDefaultIds = new Set(previous?.defaultComponents.map((component) => component.itemId) ?? []);
    const manualLines = menuDraft.components.filter((component) => !priorDefaultIds.has(component.itemId));
    const defaults = nextCategory?.defaultComponents.map((component) => ({ itemId: component.itemId, quantity: component.quantity.toString() })) ?? [];
    const defaultIds = new Set(defaults.map((component) => component.itemId));
    setMenuDraft({ ...menuDraft, categoryId, components: [...defaults, ...manualLines.filter((component) => !defaultIds.has(component.itemId))] });
  };

  const beginPricing = (itemId: string) => {
    const pricing = state.menuPrices.find((entry) => entry.itemId === itemId);
    setPricingDraft({ itemId, method: pricing?.method ?? "margin", targetPercent: String(pricing?.targetPercent ?? 45), rounding: String(pricing?.rounding ?? 5) });
    setModal("pricing"); setError("");
  };

  const deleteItem = async (item: Item) => {
    const confirmed = window.confirm(`Delete ${item.name}? This also removes its own recipe, price history, stock movements, and pricing record. Items used by another recipe or category cannot be deleted.`);
    if (!confirmed) return;
    const nextState = await sendCommand({ type: "delete_item", payload: { itemId: item.id } }, `${item.name} was deleted.`);
    if (nextState && selectedRecipe?.outputItemId === item.id) {
      setSelectedRecipeId(nextState.recipes[0]?.id ?? "");
    }
  };

  const submitPrice = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await sendCommand({ type: "update_price", payload: { itemId: priceItemId, mode: priceMode, receivedQuantity: Number(receivedQuantity || 0), packPrice: Number(packPrice), packQuantity: Number(packQuantity), supplier: priceSupplier, note: priceNote } }, "Stock and price saved. Related costs were updated.");
    if (ok) setModal(null);
  };

  const submitItem = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await sendCommand({ type: "add_raw_material", payload: { name: newItem.name, baseUnit: newItem.baseUnit, openingQuantity: Number(newItem.openingQuantity), openingTotalCost: newItem.openingTotalCost === "" ? null : Number(newItem.openingTotalCost), reorderLevel: Number(newItem.reorderLevel), supplier: newItem.supplier } }, "Raw material added to inventory.");
    if (ok) { setModal(null); setNewItem({ name: "", baseUnit: "pc", openingQuantity: "0", openingTotalCost: "", reorderLevel: "0", supplier: "" }); }
  };

  const submitRecipe = async (event: FormEvent) => {
    event.preventDefault();
    const components = recipeDraft.components.map((component) => ({ itemId: component.itemId, quantity: Number(component.quantity) }));
    const command: WorkspaceCommand = recipeDraft.outputItemId
      ? { type: "save_recipe", payload: { outputItemId: recipeDraft.outputItemId, outputQuantity: Number(recipeDraft.outputQuantity), components, notes: recipeDraft.notes } }
      : { type: "create_recipe_item", payload: { name: recipeDraft.name, itemType: recipeDraft.itemType, baseUnit: recipeDraft.baseUnit, openingQuantity: Number(recipeDraft.openingQuantity), reorderLevel: Number(recipeDraft.reorderLevel), outputQuantity: Number(recipeDraft.outputQuantity), components, notes: recipeDraft.notes } };
    const nextState = await sendCommand(command, recipeDraft.outputItemId ? "Preparation saved and related costs updated." : "Preparation created and costed.");
    if (nextState) {
      setModal(null);
      const outputItemId = recipeDraft.outputItemId || nextState.items.find((item) => item.type === recipeDraft.itemType && item.name.toLowerCase() === recipeDraft.name.trim().toLowerCase())?.id;
      const recipe = nextState.recipes.find((entry) => entry.outputItemId === outputItemId);
      if (recipe) setSelectedRecipeId(recipe.id);
    }
  };

  const submitCategory = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await sendCommand({ type: "add_menu_category", payload: { name: categoryDraft.name, defaultComponents: categoryDraft.defaultComponents.map((component) => ({ itemId: component.itemId, quantity: Number(component.quantity) })) } }, "Menu category and its automatic lines were saved.");
    if (ok) { setModal(null); setCategoryDraft({ name: "", defaultComponents: [] }); }
  };

  const submitMenu = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await sendCommand({ type: "create_menu_item", payload: { name: menuDraft.name, categoryId: menuDraft.categoryId || null, baseUnit: menuDraft.baseUnit, outputQuantity: Number(menuDraft.outputQuantity), components: menuDraft.components.map((component) => ({ itemId: component.itemId, quantity: Number(component.quantity) })), notes: menuDraft.notes, pricing: { method: "margin", targetPercent: 45, rounding: 5 } } }, "Menu item saved with its calculated cost.");
    if (ok) { setModal(null); setMenuDraft({ name: "", categoryId: "", baseUnit: "serving", outputQuantity: "1", components: [], notes: "" }); }
  };

  const submitPricing = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await sendCommand({ type: "update_pricing", payload: { itemId: pricingDraft.itemId, method: pricingDraft.method, targetPercent: Number(pricingDraft.targetPercent), rounding: Number(pricingDraft.rounding) } }, "Pricing rule saved. The customer price has not changed yet.");
    if (ok) setModal(null);
  };

  const currentPriceItem = itemMap.get(priceItemId);
  const previewNewCost = Number(packQuantity) > 0 ? Number(packPrice) / Number(packQuantity) : null;
  const previewOldValue = currentPriceItem ? currentPriceItem.onHand * (currentPriceItem.currentCost ?? 0) : 0;
  const previewNewQty = currentPriceItem ? currentPriceItem.onHand + (priceMode === "restock" ? Number(receivedQuantity || 0) : 0) : 0;
  const previewNewValue = previewNewCost === null ? 0 : previewNewQty * previewNewCost;
  const previewRevaluation = currentPriceItem && previewNewCost !== null && currentPriceItem.currentCost !== null ? currentPriceItem.onHand * (previewNewCost - currentPriceItem.currentCost) : 0;
  const previewAffected = currentPriceItem ? dependentIds(state, currentPriceItem.id) : [];

  const renderDashboard = () => {
    const impact = state.lastImpact;
    const impactSource = impact ? itemMap.get(impact.sourceItemId) : null;
    const movementEvents = directUpdates.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
    const setupSteps = [
      { title: "Add your ingredients", detail: "Enter what you buy, its quantity, and total purchase cost.", done: hasIngredient, disabled: false, action: beginRawMaterial },
      { title: "Create your preparations", detail: "Combine ingredients into sauces, bases, patties, or other batches.", done: hasPreparation, disabled: !hasIngredient, action: startPreparation },
      { title: "Build your menu items", detail: "Choose the ingredients and preparations used in each item you sell.", done: hasMenuItem, disabled: !hasIngredient, action: startMenuItem },
      { title: "Set your selling prices", detail: "Choose a margin or markup, then approve the price customers will see.", done: hasSellingPrice, disabled: !hasMenuItem, action: () => setView("pricing") },
    ];
    const completedSteps = setupSteps.filter((step) => step.done).length;
    return <>
      <section className="panel start-panel">
        <div className="start-heading"><div><p className="eyebrow">Quick actions</p><h2>What would you like to do?</h2><p>Choose a task below. TMG Accounting will guide you through it.</p></div></div>
        <div className="quick-action-grid">
          <button className="quick-action" onClick={beginRawMaterial}><span className="quick-icon green"><Plus size={20} /></span><span><strong>Add an ingredient</strong><small>Record a new raw material</small></span><ChevronRight size={18} /></button>
          <button className="quick-action" disabled={!firstPurchasedItem} onClick={() => firstPurchasedItem && openPrice(firstPurchasedItem)}><span className="quick-icon blue"><PackagePlus size={20} /></span><span><strong>Receive stock</strong><small>{firstPurchasedItem ? "Add a purchase and its latest price" : "Add an ingredient first"}</small></span><ChevronRight size={18} /></button>
          <button className="quick-action" disabled={!hasIngredient} onClick={startPreparation}><span className="quick-icon amber"><ChefHat size={20} /></span><span><strong>Make a preparation</strong><small>{hasIngredient ? "Create a sauce, base, or batch" : "Add an ingredient first"}</small></span><ChevronRight size={18} /></button>
          <button className="quick-action" disabled={!hasIngredient} onClick={startMenuItem}><span className="quick-icon rose"><UtensilsCrossed size={20} /></span><span><strong>Add a menu item</strong><small>{hasIngredient ? "Build something you sell" : "Add an ingredient first"}</small></span><ChevronRight size={18} /></button>
        </div>
      </section>

      {completedSteps < setupSteps.length && <section className="panel setup-guide">
        <div className="setup-heading"><div><p className="eyebrow">First-time setup</p><h2>Follow these four simple steps</h2></div><span>{completedSteps} of {setupSteps.length} complete</span></div>
        <div className="setup-progress"><span style={{ width: `${(completedSteps / setupSteps.length) * 100}%` }} /></div>
        <div className="setup-steps">{setupSteps.map((step, index) => <button key={step.title} className={step.done ? "complete" : ""} disabled={step.done || step.disabled} onClick={step.action}><span className="step-number">{step.done ? <Check size={16} /> : index + 1}</span><span><strong>{step.title}</strong><small>{step.done ? "Completed" : step.detail}</small></span>{!step.done && <ChevronRight size={17} />}</button>)}</div>
      </section>}

      {!!state.items.length && <>
      <section className="rule-banner"><div className="rule-icon"><RefreshCw size={18} /></div><div><strong>Your latest price is used everywhere</strong><p>When an ingredient price changes, stock, preparations, and menu costs update automatically. Your old prices remain in History.</p></div><button className="text-button" onClick={() => setView("settings")}>Learn more <ArrowRight size={15} /></button></section>
      <section className="metric-grid">
        <article className="metric-card"><div className="metric-icon green"><Warehouse size={19} /></div><span>Value of stock on hand</span><strong>{money(inventoryValue(state), 0)}</strong><small>{state.items.filter((item) => item.onHand > 0).length} stocked items</small></article>
        <article className="metric-card"><div className="metric-icon blue"><RefreshCw size={19} /></div><span>Price updates</span><strong>{directUpdates.length}</strong><small>Previous prices kept in History</small></article>
        <article className="metric-card"><div className="metric-icon amber"><Sparkles size={19} /></div><span>Items updated last time</span><strong>{impact?.affectedItemIds.length ?? 0}</strong><small>Costs recalculated automatically</small></article>
        <article className="metric-card"><div className="metric-icon rose"><CircleDollarSign size={19} /></div><span>Prices needing review</span><strong>{menuRows.filter((row) => row.below).length}</strong><small>Below your chosen target</small></article>
      </section>
      <section className="dashboard-grid">
        <article className="panel impact-panel">
          <div className="panel-heading"><div><p className="eyebrow">Latest price change</p><h2>Items affected by the change</h2></div>{impact && <span className={`delta-pill ${impact.newCost !== null && impact.oldCost !== null && impact.newCost < impact.oldCost ? "down" : "up"}`}>{impact.revaluationDelta >= 0 ? "+" : ""}{money(impact.revaluationDelta)}</span>}</div>
          {impact && impactSource ? <>
            <div className="impact-summary"><div className="impact-source"><TypeBadge type={impactSource.type} /><div><strong>{impactSource.name}</strong><span>{money(impact.oldCost)} → {money(impact.newCost)} per {impactSource.baseUnit}</span></div></div><ChevronRight size={20} /><div><strong>{impact.affectedItemIds.length}</strong><span>items refreshed</span></div></div>
            <div className="impact-chain"><div className="chain-node source">{impactSource.name}</div>{impact.affectedItemIds.map((id) => { const item = itemMap.get(id); return item ? <div className="chain-step" key={id}><ArrowRight size={14} /><div className="chain-node"><TypeBadge type={item.type} /> {item.name}<b>{money(item.currentCost)}</b></div></div> : null; })}</div>
          </> : <EmptyState title="No price changes yet" detail="Receive stock or change an ingredient price to see which preparations and menu items are affected." />}
        </article>
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Pricing health</p><h2>Needs attention</h2></div><button className="text-button" onClick={() => setView("pricing")}>View all <ArrowRight size={15} /></button></div>
          <div className="attention-list">
            {menuRows.filter((row) => row.below).map(({ item, pricing, suggestion, margin }) => <button className="attention-row" key={item.id} onClick={() => { setView("pricing"); beginPricing(item.id); }}><div className="attention-avatar"><ChefHat size={17} /></div><div><strong>{item.name}</strong><span>{margin === null ? "No published margin" : `${number(margin, 1)}% actual vs ${pricing.targetPercent}% target`}</span></div><div><b>{money(suggestion)}</b><span>suggested</span></div><ChevronRight size={17} /></button>)}
            {lowStock.slice(0, 2).map((item) => <button className="attention-row" key={item.id} onClick={() => { setView("inventory"); setSearch(item.name); }}><div className="attention-avatar warning"><AlertTriangle size={17} /></div><div><strong>{item.name} is low</strong><span>{number(item.onHand)} {item.baseUnit} on hand · reorder at {number(item.reorderLevel)}</span></div><ChevronRight size={17} /></button>)}
            {!menuRows.some((row) => row.below) && !lowStock.length && <EmptyState title="Everything looks healthy" detail="No low-stock or margin alerts." />}
          </div>
        </article>
      </section>
      <section className="dashboard-grid lower">
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">Price history</p><h2>Recent price changes</h2></div></div><div className="movement-list">{movementEvents.map((event) => { const item = itemMap.get(event.itemId); const change = event.oldUnitCost && event.oldUnitCost !== 0 ? ((event.unitCost - event.oldUnitCost) / event.oldUnitCost) * 100 : 0; return <div className="movement-row" key={event.id}><TypeBadge type={item?.type ?? "RM"} /><div><strong>{item?.name}</strong><span>{event.source === "restock" ? "Stock received" : "Price changed only"} · {dateTime(event.createdAt)}</span></div><div className="movement-values"><b>{money(event.unitCost)}</b><span className={change < 0 ? "negative" : "positive"}>{change < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}{Math.abs(change).toFixed(1)}%</span></div></div>; })}</div></article>
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">What changed</p><h2>Recent activity</h2></div><button className="text-button" onClick={() => setView("reports")}>See all <ArrowRight size={15} /></button></div><div className="timeline">{state.activities.slice(0, 5).map((activity) => <div className="timeline-row" key={activity.id}><span className={`timeline-dot ${activity.kind}`} /><div><strong>{activity.title}</strong><p>{activity.detail}</p><small>{dateTime(activity.createdAt)}</small></div></div>)}</div></article>
      </section>
      </>}
    </>;
  };

  const renderInventory = () => <section>
    <div className="section-toolbar">
      <div className="search-field"><Search size={17} /><input aria-label="Search inventory" placeholder="Search item or supplier…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <select aria-label="Filter by item type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | ItemType)}>
        <option value="all">All item types</option>
        {ITEM_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]} ({type})</option>)}
      </select>
      <button className="button secondary" onClick={beginRawMaterial}><Plus size={17} /> Add ingredient</button>
    </div>
    <div className="table-panel">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Ingredient or item</th><th>On hand</th><th>Older price</th><th>Last price</th><th>Current unit cost</th><th>Change</th><th>Stock value</th><th>Status</th><th aria-label="Actions" /></tr></thead>
          <tbody>{filteredItems.map((item) => {
            const slots = getCostSlots(state, item.id);
            const change = slots.recent && slots.current !== null ? ((slots.current - slots.recent) / slots.recent) * 100 : null;
            const low = item.type !== "MI" && item.onHand <= item.reorderLevel;
            return <tr key={item.id}>
              <td><div className="item-cell"><TypeBadge type={item.type} /><div><strong>{item.name}</strong><span>{item.supplier || TYPE_LABELS[item.type]}</span></div></div></td>
              <td><b>{number(item.onHand)}</b> <span className="muted">{item.baseUnit}</span></td>
              <td>{money(slots.previous, 4)}</td>
              <td>{money(slots.recent, 4)}</td>
              <td><strong>{money(item.currentCost, 4)}</strong><span className="unit-label">/{item.baseUnit}</span></td>
              <td>{change === null ? <span className="muted">—</span> : <span className={`change ${change < 0 ? "negative" : "positive"}`}>{change < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}{Math.abs(change).toFixed(1)}%</span>}</td>
              <td>{money(item.onHand * (item.currentCost ?? 0))}</td>
              <td>{item.currentCost === null ? <span className="status missing">Missing cost</span> : low ? <span className="status warning">Low stock</span> : <span className="status healthy">Current</span>}</td>
              <td><div className="row-actions">
                {["RM", "PM"].includes(item.type)
                  ? <button className="row-action" onClick={() => openPrice(item)}>Stock / price</button>
                  : item.type === "MI"
                    ? <button className="row-action" onClick={() => setView("menu")}>View menu</button>
                    : <button className="row-action" onClick={() => { const recipe = state.recipes.find((entry) => entry.outputItemId === item.id); if (recipe) { setSelectedRecipeId(recipe.id); setView("recipes"); } else beginRecipe(item.id); }}>View recipe</button>}
                <button className="row-action delete" aria-label={`Delete ${item.name}`} title={`Delete ${item.name}`} disabled={saving} onClick={() => void deleteItem(item)}><Trash2 size={14} /></button>
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!filteredItems.length && <EmptyState title="No matching items" detail="Try a different search or item-type filter." />}
    </div>
  </section>;

  const renderRecipes = () => {
    const output = selectedRecipe ? itemMap.get(selectedRecipe.outputItemId) : null;
    return <section className="recipe-layout"><aside className="recipe-list panel"><div className="panel-heading"><div><p className="eyebrow">Things you prepare</p><h2>Preparations</h2></div><button className="icon-button filled" aria-label="Add a preparation" onClick={() => beginRecipe()}><Plus size={17} /></button></div>{state.recipes.filter((recipe) => { const item = itemMap.get(recipe.outputItemId); return item && RECIPE_OUTPUT_TYPES.includes(item.type as (typeof RECIPE_OUTPUT_TYPES)[number]); }).map((recipe) => { const item = itemMap.get(recipe.outputItemId); return item ? <button key={recipe.id} className={`recipe-list-item ${selectedRecipe?.id === recipe.id ? "active" : ""}`} onClick={() => setSelectedRecipeId(recipe.id)}><TypeBadge type={item.type} /><div><strong>{item.name}</strong><span>Saved version {recipe.version} · {recipe.components.length} ingredients</span></div><b>{money(item.currentCost, 4)}</b><ChevronRight size={16} /></button> : null; })}</aside>
      <article className="panel recipe-detail">{selectedRecipe && output ? <><div className="recipe-hero"><div><div className="title-with-badge"><TypeBadge type={output.type} /><span>{TYPE_LABELS[output.type]} · Saved version {selectedRecipe.version}</span></div><h2>{output.name}</h2><p>{selectedRecipe.notes || "No preparation notes."}</p></div><button className="button secondary" onClick={() => beginRecipe(output.id)}><SlidersHorizontal size={16} /> Edit preparation</button></div><div className="recipe-stats"><div><span>Amount made</span><strong>{number(selectedRecipe.outputQuantity)} {output.baseUnit}</strong></div><div><span>Total batch cost</span><strong>{money((output.currentCost ?? 0) * selectedRecipe.outputQuantity, 4)}</strong></div><div><span>Cost per {output.baseUnit}</span><strong>{money(output.currentCost, 4)}</strong></div></div><div className="component-heading"><h3>Ingredients used</h3><span>Quantities follow each ingredient&apos;s unit</span></div><div className="component-list">{selectedRecipe.components.map((component) => { const item = itemMap.get(component.itemId); const lineCost = item?.currentCost === null || item?.currentCost === undefined ? null : item.currentCost * component.quantity; return item ? <div className="component-row" key={item.id}><div className="component-index" /><TypeBadge type={item.type} /><div><strong>{item.name}</strong><span>{number(component.quantity)} {item.baseUnit} × {money(item.currentCost, 4)}</span></div><b>{money(lineCost, 4)}</b></div> : null; })}</div><div className="formula-note"><Database size={17} /><div><strong>Costs update automatically</strong><p>When an ingredient price changes, this preparation and any menu item using it are recalculated.</p></div></div></> : <EmptyState title="Choose a preparation" detail="Select one from the list, or use the plus button to make your first preparation." />}</article>
    </section>;
  };

  const renderMenu = () => {
    const menuItems = state.items.filter((item) => item.type === "MI");
    return <section className="menu-workspace">
      <article className="panel category-panel">
        <div className="panel-heading"><div><p className="eyebrow">Optional time-saver</p><h2>Menu categories</h2></div><button className="button secondary small" onClick={beginCategory}><Plus size={15} /> Add category</button></div>
        <p className="panel-copy">A category can automatically add the usual preparations to a new menu item. For example, Burger can add patty and sauce.</p>
        <div className="category-list">{state.menuCategories.map((category) => <div className="category-card" key={category.id}><div className="category-card-title"><span className="category-icon"><UtensilsCrossed size={16} /></span><div><strong>{category.name}</strong><small>{category.defaultComponents.length} automatic line{category.defaultComponents.length === 1 ? "" : "s"}</small></div></div><div className="template-lines">{category.defaultComponents.map((component) => { const componentItem = itemMap.get(component.itemId); return <span key={component.itemId}>{componentItem?.name ?? "Missing item"} · {number(component.quantity)} {componentItem?.baseUnit}</span>; })}</div></div>)}{!state.menuCategories.length && <EmptyState title="No categories yet" detail="Add a category such as Burger, then choose its automatic sauce and patty lines." />}</div>
      </article>
      <article className="panel menu-panel">
        <div className="panel-heading"><div><p className="eyebrow">What customers buy</p><h2>Menu items</h2></div></div>
        <p className="panel-copy">Choose a category to add its usual ingredients automatically, then add any extras such as cheese.</p>
        <div className="menu-item-list">{menuItems.map((menuItem) => { const recipe = state.recipes.find((entry) => entry.outputItemId === menuItem.id); const category = state.menuCategories.find((entry) => entry.id === menuItem.categoryId); const pricing = state.menuPrices.find((entry) => entry.itemId === menuItem.id); const suggestion = calculateSuggestedPrice(menuItem.currentCost, pricing?.method ?? "margin", pricing?.targetPercent ?? 45, pricing?.rounding ?? 5); return <div className="menu-item-card" key={menuItem.id}><div className="menu-item-main"><TypeBadge type="MI" /><div><strong>{menuItem.name}</strong><span>{category?.name ?? "No category"} · {recipe?.components.length ?? 0} recipe lines</span></div></div><div className="menu-item-components">{recipe?.components.map((component) => <span key={component.itemId}>{itemMap.get(component.itemId)?.name}</span>)}</div><div className="menu-item-cost"><span>Current cost</span><strong>{money(menuItem.currentCost)}</strong></div><div className="menu-item-cost"><span>Suggested</span><strong>{money(suggestion)}</strong></div><button className="row-action" onClick={() => { setView("pricing"); beginPricing(menuItem.id); }}>Pricing</button></div>; })}{!menuItems.length && <EmptyState title="No menu items yet" detail="Create a menu item, optionally choose a category, then add any custom lines." />}</div>
      </article>
    </section>;
  };

  const renderPricing = () => <section><div className="pricing-explainer"><div><Sparkles size={18} /><strong>Your costs suggest a selling price</strong></div><p>Customer prices never change by themselves. Review the suggestion, then choose when to use it.</p></div><div className="pricing-grid">{menuRows.map(({ item, pricing, suggestion, margin, below }) => <article className="pricing-card" key={item.id}><header><div><TypeBadge type="MI" /><h2>{item.name}</h2></div><span className={`status ${below ? "warning" : "healthy"}`}>{below ? "Review price" : "On target"}</span></header><div className="price-comparison"><div><span>Cost to make</span><strong>{money(item.currentCost)}</strong></div><ArrowRight size={20} /><div><span>Current selling price</span><strong>{pricing.approvedPrice ? money(pricing.approvedPrice) : "Not set"}</strong></div><ArrowRight size={20} /><div className="suggested"><span>Suggested selling price</span><strong>{money(suggestion)}</strong></div></div><div className="margin-meter"><div className="meter-label"><span>Actual margin</span><strong>{margin === null ? "—" : `${number(margin, 1)}%`} <small>/ {pricing.targetPercent}% target</small></strong></div><div className="meter-track"><span style={{ width: `${Math.max(0, Math.min(100, margin ?? 0))}%` }} /></div></div><div className="pricing-rule"><span>{pricing.method === "margin" ? "Target margin" : "Markup"}</span><b>{pricing.targetPercent}%</b><span>Round up to</span><b>₱{pricing.rounding}</b></div><footer><button className="button secondary" onClick={() => beginPricing(item.id)}><Settings size={16} /> Change pricing rule</button><button className="button primary" disabled={saving || suggestion === null || suggestion === pricing.approvedPrice} onClick={() => void sendCommand({ type: "approve_price", payload: { itemId: item.id } }, "Selling price saved.")}><Check size={16} /> Use {money(suggestion)}</button></footer></article>)}{!menuRows.length && <EmptyState title="No menu items yet" detail="Add a menu item first, then return here to set its selling price." />}</div></section>;

  const renderReports = () => {
    const totalRevaluation = state.priceEvents.reduce((sum, event) => sum + event.revaluationDelta, 0);
    return <section><div className="report-grid"><article className="report-card"><Warehouse size={20} /><span>Value of stock on hand</span><strong>{money(inventoryValue(state))}</strong><small>Quantity multiplied by the latest unit cost</small></article><article className="report-card"><RefreshCw size={20} /><span>Stock value changes</span><strong>{money(totalRevaluation)}</strong><small>Combined effect of price increases and decreases</small></article><article className="report-card"><AlertTriangle size={20} /><span>Low-stock items</span><strong>{lowStock.length}</strong><small>At or below your warning level</small></article><article className="report-card"><CircleDollarSign size={20} /><span>Selling prices to review</span><strong>{menuRows.filter((row) => row.below).length}</strong><small>Below your chosen profit target</small></article></div><div className="report-layout"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">Purchase prices</p><h2>Price change history</h2></div><span className="status neutral">{state.priceEvents.length} changes</span></div><div className="table-wrap compact"><table><thead><tr><th>Date</th><th>Item</th><th>How it changed</th><th>Old unit cost</th><th>New unit cost</th><th>Stock value change</th></tr></thead><tbody>{state.priceEvents.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12).map((event) => <tr key={event.id}><td>{dateTime(event.createdAt)}</td><td><strong>{itemMap.get(event.itemId)?.name}</strong></td><td><span className="status neutral">{event.source === "restock" ? "Stock received" : event.source === "market" ? "Price only" : event.source === "opening" ? "Starting price" : "Automatic costing"}</span></td><td>{money(event.oldUnitCost, 4)}</td><td>{money(event.unitCost, 4)}</td><td className={event.revaluationDelta < 0 ? "negative" : event.revaluationDelta > 0 ? "positive" : ""}>{event.revaluationDelta > 0 ? "+" : ""}{money(event.revaluationDelta)}</td></tr>)}</tbody></table></div></article><article className="panel"><div className="panel-heading"><div><p className="eyebrow">Recent actions</p><h2>Activity history</h2></div></div><div className="timeline report-timeline">{state.activities.map((activity) => <div className="timeline-row" key={activity.id}><span className={`timeline-dot ${activity.kind}`} /><div><strong>{activity.title}</strong><p>{activity.detail}</p><small>{dateTime(activity.createdAt)}</small></div></div>)}</div></article></div></section>;
  };

  const renderSettings = () => <section className="settings-layout"><article className="panel settings-card"><div className="settings-icon"><RefreshCw size={24} /></div><p className="eyebrow">How costs work</p><h2>The latest purchase price is used</h2><p>When you receive stock or record a new market price, that unit cost applies to everything currently on hand. Preparations and menu item costs update automatically.</p><div className="settings-points"><div><Check size={17} /><span>Old and new stock use the same latest unit cost</span></div><div><Check size={17} /><span>Previous purchase prices remain available in History</span></div><div><Check size={17} /><span>Changing a price without receiving stock keeps the quantity unchanged</span></div><div><Check size={17} /><span>Customer selling prices change only when you approve them</span></div></div></article><article className="panel settings-card"><div className="settings-icon indigo"><ShieldCheck size={24} /></div><p className="eyebrow">Your account</p><h2>{state.businessName}</h2><div className="settings-list"><div><span>Branch</span><strong>{state.branchName}</strong></div><div><span>Currency</span><strong>Philippine peso (PHP)</strong></div><div><span>Signed in as</span><strong>{userName}</strong></div><div><span>Saving status</span><strong>Saved online</strong></div></div><form action={signOutPath} method="post" target="_top"><button className="button secondary signout" type="submit"><LogOut size={16} /> Sign out</button></form></article></section>;

  const pageTitle = NAV.find((item) => item.id === view)?.label ?? "Home";
  const pageDescription: Record<View, string> = {
    dashboard: "Choose a task below and follow the simple steps.",
    inventory: "Add ingredients, receive stock, and keep purchase prices current.",
    recipes: "Combine ingredients into the sauces, bases, and batches you prepare.",
    menu: "Build the items you sell from ingredients and preparations.",
    pricing: "Review suggested prices and decide what customers should pay.",
    reports: "See price changes, stock value changes, and recent activity.",
    settings: "Understand how costs work, review your account, or sign out.",
  };

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
      <div className="sidebar-brand"><div className="brand-logo" role="img" aria-label="TMG Accounting" /><div><strong>TMG Accounting</strong><span>Simple food costing</span></div><button className="sidebar-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={19} /></button></div>
      <nav aria-label="Primary navigation">{NAV_GROUPS.map((group) => <div className="nav-group" key={group}><p>{group}</p>{NAV.filter((item) => item.group === group).map(({ id, label, description, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => { setView(id); setMobileNav(false); }}><Icon size={19} /><span><strong>{label}</strong><small>{description}</small></span>{id === "pricing" && menuRows.some((row) => row.below) && <b>{menuRows.filter((row) => row.below).length}</b>}</button>)}</div>)}</nav>
      <div className="sidebar-foot"><div className="sync-status"><span /><div><strong>Saved online</strong><small>Your changes are protected</small></div></div></div>
    </aside>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <div className="app-main"><header className="topbar"><div className="topbar-title"><button className="mobile-menu" aria-label="Open navigation menu" onClick={() => setMobileNav(true)}><Menu size={20} /><span>Menu</span></button><div><p>{state.businessName} · {state.branchName}</p><h1>{pageTitle}</h1></div></div><div className="topbar-actions"><div className="user-chip" title={userName}>{userName.slice(0, 1).toUpperCase()}</div></div></header>
      <main className="content"><div className="page-intro"><div><p className="eyebrow">{view === "dashboard" ? "Start here" : NAV.find((item) => item.id === view)?.description}</p><h2>{view === "dashboard" ? "What do you need to do today?" : pageTitle}</h2><p>{pageDescription[view]}</p></div>{view === "inventory" && <button className="button primary desktop-action" disabled={!firstPurchasedItem} onClick={() => firstPurchasedItem && openPrice(firstPurchasedItem)}><PackagePlus size={17} /> Receive stock</button>}{view === "recipes" && <button className="button primary desktop-action" onClick={startPreparation}><Plus size={17} /> Add preparation</button>}{view === "menu" && <button className="button primary desktop-action" onClick={startMenuItem}><Plus size={17} /> Add menu item</button>}</div>
        {error && <div className="error-banner" role="alert"><AlertTriangle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button></div>}
        {view === "dashboard" && renderDashboard()}{view === "inventory" && renderInventory()}{view === "recipes" && renderRecipes()}{view === "menu" && renderMenu()}{view === "pricing" && renderPricing()}{view === "reports" && renderReports()}{view === "settings" && renderSettings()}
      </main>
    </div>
    <nav className="mobile-bottom-nav" aria-label="Common destinations">{NAV.slice(0, 4).map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><Icon size={18} /><span>{label === "Stock & Prices" ? "Stock" : label === "Preparations" ? "Prep" : label === "Menu Items" ? "Menu" : label}</span></button>)}</nav>
    <div className={`toast ${toast ? "show" : ""}`} aria-live="polite"><Check size={17} />{toast}</div>

    {modal === "price" && currentPriceItem && <Modal title={`Stock and price: ${currentPriceItem.name}`} eyebrow="Record a purchase or price change" onClose={() => setModal(null)}><form onSubmit={submitPrice}><div className="mode-switch"><button type="button" className={priceMode === "restock" ? "active" : ""} onClick={() => setPriceMode("restock")}><PackagePlus size={18} /><span><strong>Receive stock</strong><small>Add quantity and use the latest price</small></span></button><button type="button" className={priceMode === "market" ? "active" : ""} onClick={() => setPriceMode("market")}><TrendingUp size={18} /><span><strong>Change price only</strong><small>Keep the same quantity on hand</small></span></button></div><div className="form-grid"><label className="field full"><span>Ingredient</span><select value={priceItemId} onChange={(event) => { const item = itemMap.get(event.target.value); if (item) openPrice(item); }}><option value="" disabled>Select ingredient</option>{state.items.filter((item) => ["RM", "PM"].includes(item.type)).map((item) => <option key={item.id} value={item.id}>{item.name} · {TYPE_LABELS[item.type]}</option>)}</select></label>{priceMode === "restock" && <label className="field"><span>Quantity received ({currentPriceItem.baseUnit})</span><input required min="0.000001" step="any" inputMode="decimal" value={receivedQuantity} onChange={(event) => setReceivedQuantity(event.target.value)} autoFocus /></label>}<label className="field"><span>Total purchase price (₱)</span><input required min="0" step="any" inputMode="decimal" value={packPrice} onChange={(event) => setPackPrice(event.target.value)} autoFocus={priceMode === "market"} /></label><label className="field"><span>Quantity covered by that price ({currentPriceItem.baseUnit})</span><input required min="0.000001" step="any" inputMode="decimal" value={packQuantity} onChange={(event) => setPackQuantity(event.target.value)} /></label><label className="field"><span>Supplier</span><input value={priceSupplier} onChange={(event) => setPriceSupplier(event.target.value)} placeholder="Optional" /></label><label className="field full"><span>Receipt number or note</span><input value={priceNote} onChange={(event) => setPriceNote(event.target.value)} placeholder="Optional" /></label></div><div className="impact-preview"><div className="preview-title"><Sparkles size={17} /><strong>Before you save</strong><span>{previewAffected.length} other item{previewAffected.length === 1 ? "" : "s"} will update</span></div><div className="preview-grid"><div><span>Old unit cost</span><strong>{money(currentPriceItem.currentCost, 4)}</strong></div><ArrowRight size={17} /><div><span>New unit cost</span><strong>{previewNewCost === null || !Number.isFinite(previewNewCost) ? "—" : money(previewNewCost, 4)}</strong></div><div><span>Stock on hand</span><strong>{number(currentPriceItem.onHand)} → {number(previewNewQty)} {currentPriceItem.baseUnit}</strong></div><div><span>Total stock value</span><strong>{money(previewOldValue)} → {money(previewNewValue)}</strong></div><div><span>Change in stock value</span><strong className={previewRevaluation < 0 ? "negative" : "positive"}>{previewRevaluation >= 0 ? "+" : ""}{money(previewRevaluation)}</strong></div></div><p>The new unit cost will be used for all stock on hand. Selling prices will stay the same until you choose to change them.</p></div><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={17} /> : <Check size={17} />} Save stock and price</button></div></form></Modal>}

    {modal === "item" && <Modal title="Add an ingredient" eyebrow="Step 1 · Ingredient details" onClose={() => setModal(null)}>
      <form onSubmit={submitItem}>
        <div className="form-grid">
          <label className="field full"><span>Ingredient name</span><input required autoFocus value={newItem.name} onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} placeholder="e.g. Cooking oil" /></label>
          <label className="field"><span>How do you measure it?</span><select value={newItem.baseUnit} onChange={(event) => setNewItem({ ...newItem, baseUnit: event.target.value as BaseUnit })}>{BASE_UNITS.map((unit) => <option key={unit} value={unit}>{UNIT_LABELS[unit]}</option>)}</select></label>
          <label className="field"><span>Quantity currently on hand</span><input required min="0" step="any" inputMode="decimal" value={newItem.openingQuantity} onChange={(event) => setNewItem({ ...newItem, openingQuantity: event.target.value })} /></label>
          <label className="field"><span>Show low-stock warning at</span><input required min="0" step="any" inputMode="decimal" value={newItem.reorderLevel} onChange={(event) => setNewItem({ ...newItem, reorderLevel: event.target.value })} /></label>
          <label className="field"><span>Total cost of the quantity on hand (₱)</span><input min="0" step="any" inputMode="decimal" value={newItem.openingTotalCost} onChange={(event) => setNewItem({ ...newItem, openingTotalCost: event.target.value })} placeholder="Optional" /></label>
          <label className="field"><span>Supplier</span><input value={newItem.supplier} onChange={(event) => setNewItem({ ...newItem, supplier: event.target.value })} placeholder="Optional" /></label>
        </div>
        {newItem.openingTotalCost !== "" && Number(newItem.openingQuantity) > 0 && <div className="form-note"><CircleDollarSign size={16} /><span>Calculated unit cost: {money(Number(newItem.openingTotalCost) / Number(newItem.openingQuantity), 4)} per {UNIT_LABELS[newItem.baseUnit]}</span></div>}
        <div className="form-note"><ShieldCheck size={16} /><span>You can combine ingredients into sauces, bases, and other preparations in the next section.</span></div>
        <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={17} /> : <Plus size={17} />} Save ingredient</button></div>
      </form>
    </Modal>}

    {modal === "recipe" && <Modal title={recipeDraft.outputItemId ? `Edit ${recipeDraft.name}` : "Add a preparation"} eyebrow="Combine ingredients into something you make" onClose={() => setModal(null)}>
      <form onSubmit={submitRecipe}>
        <div className="form-grid">
          {recipeDraft.outputItemId ? <label className="field full"><span>Preparation</span><input disabled value={`${recipeDraft.name} · ${TYPE_LABELS[recipeDraft.itemType]}`} /></label> : <>
            <label className="field full"><span>Preparation name</span><input required autoFocus value={recipeDraft.name} onChange={(event) => setRecipeDraft({ ...recipeDraft, name: event.target.value })} placeholder="e.g. Burger sauce" /></label>
            <label className="field"><span>Type of preparation</span><select value={recipeDraft.itemType} onChange={(event) => { const nextType = event.target.value as "CoRM" | "FB" | "OM"; const first = state.items.find((item) => ALLOWED[nextType].includes(item.type)); setRecipeDraft({ ...recipeDraft, itemType: nextType, components: first ? [{ itemId: first.id, quantity: "1" }] : [] }); }}>{RECIPE_OUTPUT_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]} ({type})</option>)}</select></label>
            <label className="field"><span>Base unit</span><select value={recipeDraft.baseUnit} onChange={(event) => setRecipeDraft({ ...recipeDraft, baseUnit: event.target.value as BaseUnit })}>{BASE_UNITS.map((unit) => <option key={unit} value={unit}>{UNIT_LABELS[unit]}</option>)}</select></label>
            <label className="field"><span>Opening quantity</span><input required min="0" step="any" inputMode="decimal" value={recipeDraft.openingQuantity} onChange={(event) => setRecipeDraft({ ...recipeDraft, openingQuantity: event.target.value })} /></label>
            <label className="field"><span>Reorder level</span><input required min="0" step="any" inputMode="decimal" value={recipeDraft.reorderLevel} onChange={(event) => setRecipeDraft({ ...recipeDraft, reorderLevel: event.target.value })} /></label>
          </>}
          <label className="field"><span>Amount this recipe makes ({UNIT_LABELS[recipeDraft.baseUnit]})</span><input required min="0.000001" step="any" inputMode="decimal" value={recipeDraft.outputQuantity} onChange={(event) => setRecipeDraft({ ...recipeDraft, outputQuantity: event.target.value })} /></label>
          <label className="field"><span>Version</span><input disabled value={`v${(state.recipes.find((recipe) => recipe.outputItemId === recipeDraft.outputItemId)?.version ?? 0) + 1}`} /></label>
        </div>
        <div className="builder-heading"><div><h3>Ingredients and preparations used</h3><p>Enter how much of each one goes into this batch.</p></div><button type="button" className="button secondary small" onClick={() => { const choices = state.items.filter((item) => item.id !== recipeDraft.outputItemId && ALLOWED[recipeDraft.itemType].includes(item.type)); const available = choices.find((item) => !recipeDraft.components.some((component) => component.itemId === item.id)); if (available) setRecipeDraft({ ...recipeDraft, components: [...recipeDraft.components, { itemId: available.id, quantity: "1" }] }); }}><Plus size={15} /> Add ingredient</button></div>
        <div className="builder-lines">{recipeDraft.components.map((component, index) => { const choices = state.items.filter((item) => item.id !== recipeDraft.outputItemId && ALLOWED[recipeDraft.itemType].includes(item.type)); const selected = itemMap.get(component.itemId); return <div className="builder-line" key={`${index}-${component.itemId}`}><span className="line-number">{index + 1}</span><select aria-label={`Ingredient ${index + 1}`} value={component.itemId} onChange={(event) => { const next = [...recipeDraft.components]; next[index] = { ...next[index], itemId: event.target.value }; setRecipeDraft({ ...recipeDraft, components: next }); }}>{choices.map((item) => <option key={item.id} value={item.id}>{item.name} · {TYPE_LABELS[item.type]}</option>)}</select><div className="quantity-input"><input aria-label={`Quantity for ingredient ${index + 1}`} required min="0.000001" step="any" inputMode="decimal" value={component.quantity} onChange={(event) => { const next = [...recipeDraft.components]; next[index] = { ...next[index], quantity: event.target.value }; setRecipeDraft({ ...recipeDraft, components: next }); }} /><span>{selected?.baseUnit}</span></div><b>{selected?.currentCost === null || !selected ? "Cost unavailable" : money(selected.currentCost * Number(component.quantity || 0), 4)}</b><button type="button" className="icon-button" aria-label={`Remove ingredient ${index + 1}`} onClick={() => setRecipeDraft({ ...recipeDraft, components: recipeDraft.components.filter((_, entryIndex) => entryIndex !== index) })}><X size={16} /></button></div>; })}{!recipeDraft.components.length && <EmptyState title="No ingredients added" detail="Add at least one ingredient or preparation." />}</div>
        <label className="field full"><span>Preparation notes</span><textarea rows={3} value={recipeDraft.notes} onChange={(event) => setRecipeDraft({ ...recipeDraft, notes: event.target.value })} placeholder="Yield, process, or portion notes" /></label>
        <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={17} /> : <Check size={17} />} {recipeDraft.outputItemId ? "Save changes" : "Save preparation"}</button></div>
      </form>
    </Modal>}

    {modal === "category" && <Modal title="Add menu category" eyebrow="Save time on similar menu items" onClose={() => setModal(null)}>
      <form onSubmit={submitCategory}>
        <div className="form-grid"><label className="field full"><span>Category name</span><input required autoFocus value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} placeholder="e.g. Burger" /></label></div>
        <div className="builder-heading"><div><h3>Preparations to add automatically</h3><p>These are added whenever you choose this category for a new menu item.</p></div><button type="button" className="button secondary small" onClick={() => { const available = state.items.find((item) => (item.type === "FB" || item.type === "OM") && !categoryDraft.defaultComponents.some((component) => component.itemId === item.id)); if (available) setCategoryDraft({ ...categoryDraft, defaultComponents: [...categoryDraft.defaultComponents, { itemId: available.id, quantity: "1" }] }); }}><Plus size={15} /> Add preparation</button></div>
        <div className="builder-lines">{categoryDraft.defaultComponents.map((component, index) => { const choices = state.items.filter((item) => item.type === "FB" || item.type === "OM"); const selected = itemMap.get(component.itemId); return <div className="builder-line" key={`${index}-${component.itemId}`}><span className="line-number">{index + 1}</span><select aria-label={`Category default ${index + 1}`} value={component.itemId} onChange={(event) => { const next = [...categoryDraft.defaultComponents]; next[index] = { ...next[index], itemId: event.target.value }; setCategoryDraft({ ...categoryDraft, defaultComponents: next }); }}>{choices.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}</select><div className="quantity-input"><input aria-label={`Default quantity ${index + 1}`} required min="0.000001" step="any" inputMode="decimal" value={component.quantity} onChange={(event) => { const next = [...categoryDraft.defaultComponents]; next[index] = { ...next[index], quantity: event.target.value }; setCategoryDraft({ ...categoryDraft, defaultComponents: next }); }} /><span>{selected?.baseUnit}</span></div><b>{selected?.currentCost === null || !selected ? "Unavailable" : money(selected.currentCost * Number(component.quantity || 0), 4)}</b><button type="button" className="icon-button" aria-label={`Remove category default ${index + 1}`} onClick={() => setCategoryDraft({ ...categoryDraft, defaultComponents: categoryDraft.defaultComponents.filter((_, entryIndex) => entryIndex !== index) })}><X size={16} /></button></div>; })}{!categoryDraft.defaultComponents.length && <EmptyState title="No automatic lines" detail="This category can still be saved, but it will not preload a menu recipe." />}</div>
        <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={17} /> : <Check size={17} />} Save category</button></div>
      </form>
    </Modal>}

    {modal === "menu" && <Modal title="Add menu item" eyebrow="Build what the customer receives" onClose={() => setModal(null)}>
      <form onSubmit={submitMenu}>
        <div className="form-grid">
          <label className="field full"><span>Menu item name</span><input required autoFocus value={menuDraft.name} onChange={(event) => setMenuDraft({ ...menuDraft, name: event.target.value })} placeholder="e.g. Cheese Burger" /></label>
          <label className="field full"><span>Category (optional)</span><select value={menuDraft.categoryId} onChange={(event) => selectMenuCategory(event.target.value)}><option value="">No category — start blank</option>{state.menuCategories.map((category) => <option key={category.id} value={category.id}>{category.name} · {category.defaultComponents.length} automatic lines</option>)}</select></label>
          <label className="field"><span>Base unit</span><select value={menuDraft.baseUnit} onChange={(event) => setMenuDraft({ ...menuDraft, baseUnit: event.target.value as BaseUnit })}>{BASE_UNITS.map((unit) => <option key={unit} value={unit}>{UNIT_LABELS[unit]}</option>)}</select></label>
          <label className="field"><span>Number of servings made</span><input required min="0.000001" step="any" inputMode="decimal" value={menuDraft.outputQuantity} onChange={(event) => setMenuDraft({ ...menuDraft, outputQuantity: event.target.value })} /></label>
        </div>
        {menuDraft.categoryId && <div className="form-note template-note"><Sparkles size={16} /><span>{state.menuCategories.find((category) => category.id === menuDraft.categoryId)?.name} defaults were added automatically. Add custom lines below.</span></div>}
        <div className="builder-heading"><div><h3>Ingredients and preparations used</h3><p>Enter everything needed to make this menu item.</p></div><button type="button" className="button secondary small" onClick={() => { const available = state.items.find((item) => ALLOWED.MI.includes(item.type) && !menuDraft.components.some((component) => component.itemId === item.id)); if (available) setMenuDraft({ ...menuDraft, components: [...menuDraft.components, { itemId: available.id, quantity: "1" }] }); }}><Plus size={15} /> Add ingredient</button></div>
        <div className="builder-lines">{menuDraft.components.map((component, index) => { const choices = state.items.filter((item) => ALLOWED.MI.includes(item.type)); const selected = itemMap.get(component.itemId); const category = state.menuCategories.find((entry) => entry.id === menuDraft.categoryId); const inherited = category?.defaultComponents.some((entry) => entry.itemId === component.itemId) ?? false; return <div className={`builder-line ${inherited ? "inherited" : ""}`} key={`${index}-${component.itemId}`}><span className="line-number">{index + 1}</span><select aria-label={`Menu ingredient ${index + 1}`} disabled={inherited} value={component.itemId} onChange={(event) => { const next = [...menuDraft.components]; next[index] = { ...next[index], itemId: event.target.value }; setMenuDraft({ ...menuDraft, components: next }); }}>{choices.map((item) => <option key={item.id} value={item.id}>{item.name} · {TYPE_LABELS[item.type]}</option>)}</select><div className="quantity-input"><input aria-label={`Menu quantity ${index + 1}`} disabled={inherited} required min="0.000001" step="any" inputMode="decimal" value={component.quantity} onChange={(event) => { const next = [...menuDraft.components]; next[index] = { ...next[index], quantity: event.target.value }; setMenuDraft({ ...menuDraft, components: next }); }} /><span>{selected?.baseUnit}</span></div><b>{inherited ? "From category" : selected?.currentCost === null || !selected ? "Cost unavailable" : money(selected.currentCost * Number(component.quantity || 0), 4)}</b>{inherited ? <span className="line-lock"><Check size={15} /></span> : <button type="button" className="icon-button" aria-label={`Remove menu ingredient ${index + 1}`} onClick={() => setMenuDraft({ ...menuDraft, components: menuDraft.components.filter((_, entryIndex) => entryIndex !== index) })}><X size={16} /></button>}</div>; })}{!menuDraft.components.length && <EmptyState title="Nothing added yet" detail="Choose a category for automatic items, or add an ingredient or preparation." />}</div>
        <label className="field full"><span>Menu notes</span><textarea rows={3} value={menuDraft.notes} onChange={(event) => setMenuDraft({ ...menuDraft, notes: event.target.value })} placeholder="Preparation or serving notes" /></label>
        <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={17} /> : <Check size={17} />} Create menu item</button></div>
      </form>
    </Modal>}

    {modal === "pricing" && itemMap.get(pricingDraft.itemId) && <Modal title={`Set a price for ${itemMap.get(pricingDraft.itemId)?.name}`} eyebrow="Choose how profit is calculated" onClose={() => setModal(null)}><form onSubmit={submitPricing}><div className="pricing-method"><button type="button" className={pricingDraft.method === "markup" ? "active" : ""} onClick={() => setPricingDraft({ ...pricingDraft, method: "markup" })}><strong>Markup</strong><span>Add a percentage on top of cost</span></button><button type="button" className={pricingDraft.method === "margin" ? "active" : ""} onClick={() => setPricingDraft({ ...pricingDraft, method: "margin" })}><strong>Target margin</strong><span>Keep a percentage of the selling price as profit</span></button></div><div className="form-grid"><label className="field"><span>{pricingDraft.method === "margin" ? "Target margin" : "Markup"} (%)</span><input autoFocus required min="0" max={pricingDraft.method === "margin" ? "99.99" : undefined} step="0.1" inputMode="decimal" value={pricingDraft.targetPercent} onChange={(event) => setPricingDraft({ ...pricingDraft, targetPercent: event.target.value })} /></label><label className="field"><span>Round the price up to</span><select value={pricingDraft.rounding} onChange={(event) => setPricingDraft({ ...pricingDraft, rounding: event.target.value })}><option value="1">Nearest ₱1</option><option value="5">Nearest ₱5</option><option value="10">Nearest ₱10</option></select></label></div><div className="suggestion-preview"><span>Suggested selling price</span><strong>{money(calculateSuggestedPrice(itemMap.get(pricingDraft.itemId)?.currentCost ?? null, pricingDraft.method, Number(pricingDraft.targetPercent), Number(pricingDraft.rounding)))}</strong><small>This saves your pricing rule. You will still choose when to use the suggested selling price.</small></div><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={17} /> : <Check size={17} />} Save pricing rule</button></div></form></Modal>}
  </div>;
}
