"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeDollarSign,
  Bell,
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
  Warehouse,
  X,
} from "lucide-react";
import {
  ITEM_TYPES,
  actualMargin,
  calculateSuggestedPrice,
  dependentIds,
  getCostSlots,
  inventoryValue,
  type Item,
  type ItemType,
  type PricingMethod,
  type WorkspaceCommand,
  type WorkspaceState,
} from "@/lib/costflow";

type View = "dashboard" | "inventory" | "recipes" | "pricing" | "reports" | "settings";
type ModalName = "price" | "item" | "recipe" | "pricing" | null;

const NAV: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "recipes", label: "Recipes", icon: ChefHat },
  { id: "pricing", label: "Menu Pricing", icon: BadgeDollarSign },
  { id: "reports", label: "Reports", icon: ChartNoAxesCombined },
  { id: "settings", label: "Settings", icon: Settings },
];

const TYPE_LABELS: Record<ItemType, string> = {
  RM: "Raw material",
  CoRM: "Combined RM",
  FB: "Food base",
  OM: "Own made",
  PM: "Packaging",
  MI: "Menu item",
};

const ALLOWED: Record<ItemType, ItemType[]> = {
  RM: [], PM: [], CoRM: ["RM", "CoRM"], FB: ["RM", "CoRM", "FB"],
  OM: ["RM", "CoRM", "FB", "OM", "PM"], MI: ["RM", "CoRM", "FB", "OM", "PM"],
};

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
  return <span className={`type-badge type-${type}`} title={TYPE_LABELS[type]}>{type}</span>;
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

  const [newItem, setNewItem] = useState({ name: "", itemType: "RM" as ItemType, baseUnit: "pc", openingQuantity: "0", openingUnitCost: "", reorderLevel: "0", supplier: "" });
  const [recipeDraft, setRecipeDraft] = useState<{ outputItemId: string; outputQuantity: string; components: { itemId: string; quantity: string }[]; notes: string }>({ outputItemId: "", outputQuantity: "1", components: [], notes: "" });
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
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change could not be saved.");
      return false;
    } finally { setSaving(false); }
  };

  const itemMap = useMemo(() => new Map(state?.items.map((item) => [item.id, item]) ?? []), [state]);
  const selectedRecipe = state?.recipes.find((recipe) => recipe.id === selectedRecipeId) ?? state?.recipes[0];

  if (loading) return <main className="loading-screen"><div className="brand-mark"><TrendingUp size={22} /></div><div className="loading-line" /><p>Preparing your costing workspace…</p></main>;
  if (!state) return <main className="loading-screen"><AlertTriangle size={28} /><h1>CostFlow could not open</h1><p>{error}</p><button className="button primary" onClick={() => void load()}><RefreshCw size={17} /> Try again</button></main>;

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

  const openPrice = (item: Item) => {
    setPriceItemId(item.id); setPriceMode("restock"); setReceivedQuantity("");
    setPackQuantity("1"); setPackPrice(item.currentCost?.toString() ?? "");
    setPriceSupplier(item.supplier); setPriceNote(""); setModal("price"); setError("");
  };

  const beginRecipe = (outputItemId?: string) => {
    const output = outputItemId || state.items.find((item) => !["RM", "PM"].includes(item.type))?.id || "";
    const existing = state.recipes.find((recipe) => recipe.outputItemId === output);
    const firstAllowed = state.items.find((item) => item.id !== output && ALLOWED[itemMap.get(output)?.type ?? "MI"].includes(item.type));
    setRecipeDraft({ outputItemId: output, outputQuantity: existing?.outputQuantity.toString() ?? "1", components: existing?.components.map((component) => ({ itemId: component.itemId, quantity: component.quantity.toString() })) ?? (firstAllowed ? [{ itemId: firstAllowed.id, quantity: "1" }] : []), notes: existing?.notes ?? "" });
    setModal("recipe"); setError("");
  };

  const beginPricing = (itemId: string) => {
    const pricing = state.menuPrices.find((entry) => entry.itemId === itemId);
    setPricingDraft({ itemId, method: pricing?.method ?? "margin", targetPercent: String(pricing?.targetPercent ?? 45), rounding: String(pricing?.rounding ?? 5) });
    setModal("pricing"); setError("");
  };

  const submitPrice = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await sendCommand({ type: "update_price", payload: { itemId: priceItemId, mode: priceMode, receivedQuantity: Number(receivedQuantity || 0), packPrice: Number(packPrice), packQuantity: Number(packQuantity), supplier: priceSupplier, note: priceNote } }, "Current Cost updated. Dependent recipes were recalculated.");
    if (ok) setModal(null);
  };

  const submitItem = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await sendCommand({ type: "add_item", payload: { name: newItem.name, itemType: newItem.itemType, baseUnit: newItem.baseUnit, openingQuantity: Number(newItem.openingQuantity), openingUnitCost: newItem.openingUnitCost === "" ? null : Number(newItem.openingUnitCost), reorderLevel: Number(newItem.reorderLevel), supplier: newItem.supplier } }, "Item added to the catalog.");
    if (ok) { setModal(null); setNewItem({ name: "", itemType: "RM", baseUnit: "pc", openingQuantity: "0", openingUnitCost: "", reorderLevel: "0", supplier: "" }); }
  };

  const submitRecipe = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await sendCommand({ type: "save_recipe", payload: { outputItemId: recipeDraft.outputItemId, outputQuantity: Number(recipeDraft.outputQuantity), components: recipeDraft.components.map((component) => ({ itemId: component.itemId, quantity: Number(component.quantity) })), notes: recipeDraft.notes } }, "Recipe approved and all dependent costs refreshed.");
    if (ok) { setModal(null); const recipe = state.recipes.find((entry) => entry.outputItemId === recipeDraft.outputItemId); if (recipe) setSelectedRecipeId(recipe.id); }
  };

  const submitPricing = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await sendCommand({ type: "update_pricing", payload: { itemId: pricingDraft.itemId, method: pricingDraft.method, targetPercent: Number(pricingDraft.targetPercent), rounding: Number(pricingDraft.rounding) } }, "Pricing target updated. The published price was not changed.");
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
    return <>
      <section className="rule-banner"><div className="rule-icon"><RefreshCw size={18} /></div><div><strong>Current Cost drives every calculation</strong><p>The latest approved replacement price applies to all stock on hand. Original purchase records remain in history.</p></div><button className="text-button" onClick={() => setView("settings")}>How it works <ArrowRight size={15} /></button></section>
      <section className="metric-grid">
        <article className="metric-card"><div className="metric-icon green"><Warehouse size={19} /></div><span>Inventory at Current Cost</span><strong>{money(inventoryValue(state), 0)}</strong><small>{state.items.filter((item) => item.onHand > 0).length} stocked items</small></article>
        <article className="metric-card"><div className="metric-icon blue"><RefreshCw size={19} /></div><span>Direct cost updates</span><strong>{directUpdates.length}</strong><small>Full price history retained</small></article>
        <article className="metric-card"><div className="metric-icon amber"><Sparkles size={19} /></div><span>Last cascade impact</span><strong>{impact?.affectedItemIds.length ?? 0}</strong><small>Dependent items recalculated</small></article>
        <article className="metric-card"><div className="metric-icon rose"><CircleDollarSign size={19} /></div><span>Below target margin</span><strong>{menuRows.filter((row) => row.below).length}</strong><small>Needs pricing review</small></article>
      </section>
      <section className="dashboard-grid">
        <article className="panel impact-panel">
          <div className="panel-heading"><div><p className="eyebrow">Latest impact</p><h2>Cost cascade</h2></div>{impact && <span className={`delta-pill ${impact.newCost !== null && impact.oldCost !== null && impact.newCost < impact.oldCost ? "down" : "up"}`}>{impact.revaluationDelta >= 0 ? "+" : ""}{money(impact.revaluationDelta)}</span>}</div>
          {impact && impactSource ? <>
            <div className="impact-summary"><div className="impact-source"><TypeBadge type={impactSource.type} /><div><strong>{impactSource.name}</strong><span>{money(impact.oldCost)} → {money(impact.newCost)} per {impactSource.baseUnit}</span></div></div><ChevronRight size={20} /><div><strong>{impact.affectedItemIds.length}</strong><span>items refreshed</span></div></div>
            <div className="impact-chain"><div className="chain-node source">{impactSource.name}</div>{impact.affectedItemIds.map((id) => { const item = itemMap.get(id); return item ? <div className="chain-step" key={id}><ArrowRight size={14} /><div className="chain-node"><TypeBadge type={item.type} /> {item.name}<b>{money(item.currentCost)}</b></div></div> : null; })}</div>
          </> : <EmptyState title="No cost changes yet" detail="Update an RM or PM price to see the full dependency cascade." />}
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
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">Movement</p><h2>Recent Current Cost changes</h2></div></div><div className="movement-list">{movementEvents.map((event) => { const item = itemMap.get(event.itemId); const change = event.oldUnitCost && event.oldUnitCost !== 0 ? ((event.unitCost - event.oldUnitCost) / event.oldUnitCost) * 100 : 0; return <div className="movement-row" key={event.id}><TypeBadge type={item?.type ?? "RM"} /><div><strong>{item?.name}</strong><span>{event.source === "restock" ? "Restock" : "Market update"} · {dateTime(event.createdAt)}</span></div><div className="movement-values"><b>{money(event.unitCost)}</b><span className={change < 0 ? "negative" : "positive"}>{change < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}{Math.abs(change).toFixed(1)}%</span></div></div>; })}</div></article>
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">Audit trail</p><h2>Recent activity</h2></div><button className="text-button" onClick={() => setView("reports")}>Full history <ArrowRight size={15} /></button></div><div className="timeline">{state.activities.slice(0, 5).map((activity) => <div className="timeline-row" key={activity.id}><span className={`timeline-dot ${activity.kind}`} /><div><strong>{activity.title}</strong><p>{activity.detail}</p><small>{dateTime(activity.createdAt)}</small></div></div>)}</div></article>
      </section>
    </>;
  };

  const renderInventory = () => <section>
    <div className="section-toolbar"><div className="search-field"><Search size={17} /><input aria-label="Search inventory" placeholder="Search item or supplier…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select aria-label="Filter by item type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | ItemType)}><option value="all">All item types</option>{ITEM_TYPES.map((type) => <option key={type} value={type}>{type} · {TYPE_LABELS[type]}</option>)}</select><button className="button secondary" onClick={() => { setNewItem({ name: "", itemType: "RM", baseUnit: "pc", openingQuantity: "0", openingUnitCost: "", reorderLevel: "0", supplier: "" }); setModal("item"); }}><Plus size={17} /> Add item</button></div>
    <div className="table-panel"><div className="table-wrap"><table><thead><tr><th>Item</th><th>On hand</th><th>Previous</th><th>Recent</th><th>Current</th><th>Change</th><th>Current value</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>{filteredItems.map((item) => { const slots = getCostSlots(state, item.id); const change = slots.recent && slots.current !== null ? ((slots.current - slots.recent) / slots.recent) * 100 : null; const low = item.type !== "MI" && item.onHand <= item.reorderLevel; return <tr key={item.id}><td><div className="item-cell"><TypeBadge type={item.type} /><div><strong>{item.name}</strong><span>{item.supplier || TYPE_LABELS[item.type]}</span></div></div></td><td><b>{number(item.onHand)}</b> <span className="muted">{item.baseUnit}</span></td><td>{money(slots.previous, 4)}</td><td>{money(slots.recent, 4)}</td><td><strong>{money(item.currentCost, 4)}</strong><span className="unit-label">/{item.baseUnit}</span></td><td>{change === null ? <span className="muted">—</span> : <span className={`change ${change < 0 ? "negative" : "positive"}`}>{change < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}{Math.abs(change).toFixed(1)}%</span>}</td><td>{money(item.onHand * (item.currentCost ?? 0))}</td><td>{item.currentCost === null ? <span className="status missing">Missing cost</span> : low ? <span className="status warning">Low stock</span> : <span className="status healthy">Current</span>}</td><td>{["RM", "PM"].includes(item.type) ? <button className="row-action" onClick={() => openPrice(item)}>Update</button> : <button className="row-action" onClick={() => { const recipe = state.recipes.find((entry) => entry.outputItemId === item.id); if (recipe) { setSelectedRecipeId(recipe.id); setView("recipes"); } else beginRecipe(item.id); }}>Recipe</button>}</td></tr>; })}</tbody></table></div>{!filteredItems.length && <EmptyState title="No matching items" detail="Try a different search or item-type filter." />}</div>
  </section>;

  const renderRecipes = () => {
    const output = selectedRecipe ? itemMap.get(selectedRecipe.outputItemId) : null;
    return <section className="recipe-layout"><aside className="recipe-list panel"><div className="panel-heading"><div><p className="eyebrow">Cost structure</p><h2>Recipes</h2></div><button className="icon-button filled" aria-label="Create recipe" onClick={() => beginRecipe()}><Plus size={17} /></button></div>{state.recipes.map((recipe) => { const item = itemMap.get(recipe.outputItemId); return item ? <button key={recipe.id} className={`recipe-list-item ${selectedRecipe?.id === recipe.id ? "active" : ""}`} onClick={() => setSelectedRecipeId(recipe.id)}><TypeBadge type={item.type} /><div><strong>{item.name}</strong><span>v{recipe.version} · {recipe.components.length} components</span></div><b>{money(item.currentCost, 4)}</b><ChevronRight size={16} /></button> : null; })}</aside>
      <article className="panel recipe-detail">{selectedRecipe && output ? <><div className="recipe-hero"><div><div className="title-with-badge"><TypeBadge type={output.type} /><span>Approved recipe · Version {selectedRecipe.version}</span></div><h2>{output.name}</h2><p>{selectedRecipe.notes || "No preparation notes."}</p></div><button className="button secondary" onClick={() => beginRecipe(output.id)}><SlidersHorizontal size={16} /> Edit recipe</button></div><div className="recipe-stats"><div><span>Batch output</span><strong>{number(selectedRecipe.outputQuantity)} {output.baseUnit}</strong></div><div><span>Batch cost</span><strong>{money((output.currentCost ?? 0) * selectedRecipe.outputQuantity, 4)}</strong></div><div><span>Cost per {output.baseUnit}</span><strong>{money(output.currentCost, 4)}</strong></div></div><div className="component-heading"><h3>Components</h3><span>All lines use the component&apos;s base unit</span></div><div className="component-list">{selectedRecipe.components.map((component) => { const item = itemMap.get(component.itemId); const lineCost = item?.currentCost === null || item?.currentCost === undefined ? null : item.currentCost * component.quantity; return item ? <div className="component-row" key={item.id}><div className="component-index" /><TypeBadge type={item.type} /><div><strong>{item.name}</strong><span>{number(component.quantity)} {item.baseUnit} × {money(item.currentCost, 4)}</span></div><b>{money(lineCost, 4)}</b></div> : null; })}</div><div className="formula-note"><Database size={17} /><div><strong>Live recursive costing</strong><p>If any component changes, this recipe and every parent recipe are recalculated in dependency order.</p></div></div></> : <EmptyState title="Select a recipe" detail="Choose a recipe from the list to inspect its cost tree." />}</article>
    </section>;
  };

  const renderPricing = () => <section><div className="pricing-explainer"><div><Sparkles size={18} /><strong>Suggested prices follow Current Cost</strong></div><p>Published prices never change automatically. Review the margin impact, then approve the suggestion.</p></div><div className="pricing-grid">{menuRows.map(({ item, pricing, suggestion, margin, below }) => <article className="pricing-card" key={item.id}><header><div><TypeBadge type="MI" /><h2>{item.name}</h2></div><span className={`status ${below ? "warning" : "healthy"}`}>{below ? "Review margin" : "On target"}</span></header><div className="price-comparison"><div><span>Current cost</span><strong>{money(item.currentCost)}</strong></div><ArrowRight size={20} /><div><span>Published price</span><strong>{pricing.approvedPrice ? money(pricing.approvedPrice) : "Not set"}</strong></div><ArrowRight size={20} /><div className="suggested"><span>Suggested</span><strong>{money(suggestion)}</strong></div></div><div className="margin-meter"><div className="meter-label"><span>Actual margin</span><strong>{margin === null ? "—" : `${number(margin, 1)}%`} <small>/ {pricing.targetPercent}% target</small></strong></div><div className="meter-track"><span style={{ width: `${Math.max(0, Math.min(100, margin ?? 0))}%` }} /></div></div><div className="pricing-rule"><span>{pricing.method === "margin" ? "Target margin" : "Markup"}</span><b>{pricing.targetPercent}%</b><span>Round up to</span><b>₱{pricing.rounding}</b></div><footer><button className="button secondary" onClick={() => beginPricing(item.id)}><Settings size={16} /> Configure</button><button className="button primary" disabled={saving || suggestion === null || suggestion === pricing.approvedPrice} onClick={() => void sendCommand({ type: "approve_price", payload: { itemId: item.id } }, "Suggested menu price approved and published.")}><Check size={16} /> Approve {money(suggestion)}</button></footer></article>)}{!menuRows.length && <EmptyState title="No menu items yet" detail="Create an MI item and recipe to begin menu pricing." />}</div></section>;

  const renderReports = () => {
    const totalRevaluation = state.priceEvents.reduce((sum, event) => sum + event.revaluationDelta, 0);
    return <section><div className="report-grid"><article className="report-card"><Warehouse size={20} /><span>Current inventory value</span><strong>{money(inventoryValue(state))}</strong><small>Quantity × active Current Cost</small></article><article className="report-card"><RefreshCw size={20} /><span>Recorded revaluations</span><strong>{money(totalRevaluation)}</strong><small>Upward and downward adjustments</small></article><article className="report-card"><AlertTriangle size={20} /><span>Low-stock items</span><strong>{lowStock.length}</strong><small>At or below reorder level</small></article><article className="report-card"><CircleDollarSign size={20} /><span>Menu margin alerts</span><strong>{menuRows.filter((row) => row.below).length}</strong><small>Below configured target</small></article></div><div className="report-layout"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">Price movement report</p><h2>Current Cost history</h2></div><span className="status neutral">{state.priceEvents.length} events</span></div><div className="table-wrap compact"><table><thead><tr><th>Date</th><th>Item</th><th>Source</th><th>Old</th><th>New</th><th>Revaluation</th></tr></thead><tbody>{state.priceEvents.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12).map((event) => <tr key={event.id}><td>{dateTime(event.createdAt)}</td><td><strong>{itemMap.get(event.itemId)?.name}</strong></td><td><span className="status neutral">{event.source}</span></td><td>{money(event.oldUnitCost, 4)}</td><td>{money(event.unitCost, 4)}</td><td className={event.revaluationDelta < 0 ? "negative" : event.revaluationDelta > 0 ? "positive" : ""}>{event.revaluationDelta > 0 ? "+" : ""}{money(event.revaluationDelta)}</td></tr>)}</tbody></table></div></article><article className="panel"><div className="panel-heading"><div><p className="eyebrow">Immutable activity</p><h2>Audit history</h2></div></div><div className="timeline report-timeline">{state.activities.map((activity) => <div className="timeline-row" key={activity.id}><span className={`timeline-dot ${activity.kind}`} /><div><strong>{activity.title}</strong><p>{activity.detail}</p><small>{dateTime(activity.createdAt)}</small></div></div>)}</div></article></div></section>;
  };

  const renderSettings = () => <section className="settings-layout"><article className="panel settings-card"><div className="settings-icon"><RefreshCw size={24} /></div><p className="eyebrow">Valuation policy</p><h2>Current Replacement Cost</h2><p>Every approved RM or PM price becomes the active unit cost for all stock on hand. Cost increases and decreases flow through CoRM, FB, OM, and MI recipes immediately.</p><div className="settings-points"><div><Check size={17} /><span>No FIFO layers or blended old/new costs</span></div><div><Check size={17} /><span>Original purchase prices stay in the audit history</span></div><div><Check size={17} /><span>Market-only updates never change physical quantity</span></div><div><Check size={17} /><span>Published menu prices require approval</span></div></div></article><article className="panel settings-card"><div className="settings-icon indigo"><ShieldCheck size={24} /></div><p className="eyebrow">Workspace</p><h2>{state.businessName}</h2><div className="settings-list"><div><span>Branch</span><strong>{state.branchName}</strong></div><div><span>Currency</span><strong>Philippine peso (PHP)</strong></div><div><span>Signed in as</span><strong>{userName}</strong></div><div><span>Workspace revision</span><strong>#{revision}</strong></div></div><a className="button secondary signout" href={signOutPath} target="_top"><LogOut size={16} /> Sign out</a></article></section>;

  const pageTitle = NAV.find((item) => item.id === view)?.label ?? "Dashboard";

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}><div className="sidebar-brand"><div className="brand-mark"><TrendingUp size={21} /></div><div><strong>CostFlow</strong><span>Inventory & Menu Costing</span></div><button className="sidebar-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={19} /></button></div><nav aria-label="Primary navigation">{NAV.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => { setView(id); setMobileNav(false); }}><Icon size={19} /><span>{label}</span>{id === "pricing" && menuRows.some((row) => row.below) && <b>{menuRows.filter((row) => row.below).length}</b>}</button>)}</nav><div className="sidebar-foot"><div className="sync-status"><span /><div><strong>Live workspace</strong><small>Revision #{revision}</small></div></div><p>Current Cost mode</p></div></aside>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <div className="app-main"><header className="topbar"><div className="topbar-title"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div><p>{state.businessName} · {state.branchName}</p><h1>{pageTitle}</h1></div></div><div className="topbar-actions"><button className="icon-button" aria-label="Notifications"><Bell size={19} /><span className="notification-dot" /></button><button className="button primary" onClick={() => openPrice(state.items.find((item) => item.type === "RM") ?? state.items[0])}><RefreshCw size={17} /> Update Price</button><div className="user-chip" title={userName}>{userName.slice(0, 1).toUpperCase()}</div></div></header>
      <main className="content"><div className="page-intro"><div><p className="eyebrow">{view === "dashboard" ? "Wednesday · 14 October 2026" : "CostFlow workspace"}</p><h2>{view === "dashboard" ? "Good morning — your costs are current." : pageTitle}</h2><p>{view === "dashboard" ? "Review margin risks and the latest cost movements across your menu." : view === "inventory" ? "Every value uses the latest approved replacement cost." : view === "recipes" ? "Inspect and maintain the dependency chain behind every cost." : view === "pricing" ? "Turn live recipe costs into controlled, approved selling prices." : view === "reports" ? "Trace valuations, revaluations, margins, and every recorded change." : "Review the operating rules behind this workspace."}</p></div>{view === "inventory" && <button className="button primary desktop-action" onClick={() => openPrice(state.items.find((item) => item.type === "RM") ?? state.items[0])}><PackagePlus size={17} /> Receive stock</button>}{view === "recipes" && <button className="button primary desktop-action" onClick={() => beginRecipe()}><Plus size={17} /> New recipe</button>}</div>
        {error && <div className="error-banner" role="alert"><AlertTriangle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button></div>}
        {view === "dashboard" && renderDashboard()}{view === "inventory" && renderInventory()}{view === "recipes" && renderRecipes()}{view === "pricing" && renderPricing()}{view === "reports" && renderReports()}{view === "settings" && renderSettings()}
      </main>
    </div>
    <div className={`toast ${toast ? "show" : ""}`} aria-live="polite"><Check size={17} />{toast}</div>

    {modal === "price" && currentPriceItem && <Modal title={`Update ${currentPriceItem.name}`} eyebrow="Current Cost update" onClose={() => setModal(null)}><form onSubmit={submitPrice}><div className="mode-switch"><button type="button" className={priceMode === "restock" ? "active" : ""} onClick={() => setPriceMode("restock")}><PackagePlus size={18} /><span><strong>Restock</strong><small>Add quantity + update Current Cost</small></span></button><button type="button" className={priceMode === "market" ? "active" : ""} onClick={() => setPriceMode("market")}><TrendingUp size={18} /><span><strong>Market update</strong><small>Change cost only; quantity stays</small></span></button></div><div className="form-grid"><label className="field full"><span>Item</span><select value={priceItemId} onChange={(event) => { const item = itemMap.get(event.target.value); if (item) openPrice(item); }}><option value="" disabled>Select item</option>{state.items.filter((item) => ["RM", "PM"].includes(item.type)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}</select></label>{priceMode === "restock" && <label className="field"><span>Quantity received ({currentPriceItem.baseUnit})</span><input required min="0.000001" step="any" inputMode="decimal" value={receivedQuantity} onChange={(event) => setReceivedQuantity(event.target.value)} autoFocus /></label>}<label className="field"><span>Total pack price (₱)</span><input required min="0" step="any" inputMode="decimal" value={packPrice} onChange={(event) => setPackPrice(event.target.value)} autoFocus={priceMode === "market"} /></label><label className="field"><span>Units in pack ({currentPriceItem.baseUnit})</span><input required min="0.000001" step="any" inputMode="decimal" value={packQuantity} onChange={(event) => setPackQuantity(event.target.value)} /></label><label className="field"><span>Supplier</span><input value={priceSupplier} onChange={(event) => setPriceSupplier(event.target.value)} placeholder="Optional" /></label><label className="field full"><span>Reference or note</span><input value={priceNote} onChange={(event) => setPriceNote(event.target.value)} placeholder="Invoice, quotation, or reason" /></label></div><div className="impact-preview"><div className="preview-title"><Sparkles size={17} /><strong>Impact preview</strong><span>{previewAffected.length} dependent item{previewAffected.length === 1 ? "" : "s"}</span></div><div className="preview-grid"><div><span>Current unit cost</span><strong>{money(currentPriceItem.currentCost, 4)}</strong></div><ArrowRight size={17} /><div><span>New unit cost</span><strong>{previewNewCost === null || !Number.isFinite(previewNewCost) ? "—" : money(previewNewCost, 4)}</strong></div><div><span>Stock on hand</span><strong>{number(currentPriceItem.onHand)} → {number(previewNewQty)} {currentPriceItem.baseUnit}</strong></div><div><span>Inventory value</span><strong>{money(previewOldValue)} → {money(previewNewValue)}</strong></div><div><span>Existing-stock revaluation</span><strong className={previewRevaluation < 0 ? "negative" : "positive"}>{previewRevaluation >= 0 ? "+" : ""}{money(previewRevaluation)}</strong></div></div><p>All remaining stock will use the new Current Cost. Published menu prices will not change until approved.</p></div><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={17} /> : <Check size={17} />} Apply Current Cost</button></div></form></Modal>}

    {modal === "item" && <Modal title="Add catalog item" eyebrow="Item master" onClose={() => setModal(null)}><form onSubmit={submitItem}><div className="form-grid"><label className="field full"><span>Item name</span><input required autoFocus value={newItem.name} onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} placeholder="e.g. Cooking Oil" /></label><label className="field"><span>Classification</span><select value={newItem.itemType} onChange={(event) => setNewItem({ ...newItem, itemType: event.target.value as ItemType, openingUnitCost: ["RM", "PM"].includes(event.target.value) ? newItem.openingUnitCost : "" })}>{ITEM_TYPES.map((type) => <option key={type} value={type}>{type} · {TYPE_LABELS[type]}</option>)}</select></label><label className="field"><span>Base unit</span><input required value={newItem.baseUnit} onChange={(event) => setNewItem({ ...newItem, baseUnit: event.target.value })} placeholder="pc, g, ml, serving" /></label><label className="field"><span>Opening quantity</span><input required min="0" step="any" inputMode="decimal" value={newItem.openingQuantity} onChange={(event) => setNewItem({ ...newItem, openingQuantity: event.target.value })} /></label><label className="field"><span>Reorder level</span><input required min="0" step="any" inputMode="decimal" value={newItem.reorderLevel} onChange={(event) => setNewItem({ ...newItem, reorderLevel: event.target.value })} /></label>{["RM", "PM"].includes(newItem.itemType) && <label className="field"><span>Opening unit cost (₱)</span><input min="0" step="any" inputMode="decimal" value={newItem.openingUnitCost} onChange={(event) => setNewItem({ ...newItem, openingUnitCost: event.target.value })} placeholder="Optional" /></label>}<label className="field"><span>Supplier</span><input value={newItem.supplier} onChange={(event) => setNewItem({ ...newItem, supplier: event.target.value })} placeholder="Optional" /></label></div><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={17} /> : <Plus size={17} />} Add item</button></div></form></Modal>}

    {modal === "recipe" && <Modal title="Recipe builder" eyebrow="Versioned costing" onClose={() => setModal(null)}><form onSubmit={submitRecipe}><div className="form-grid"><label className="field full"><span>Output item</span><select value={recipeDraft.outputItemId} onChange={(event) => { const id = event.target.value; const existing = state.recipes.find((recipe) => recipe.outputItemId === id); const type = itemMap.get(id)?.type ?? "MI"; const first = state.items.find((item) => item.id !== id && ALLOWED[type].includes(item.type)); setRecipeDraft({ outputItemId: id, outputQuantity: existing?.outputQuantity.toString() ?? "1", components: existing?.components.map((component) => ({ itemId: component.itemId, quantity: component.quantity.toString() })) ?? (first ? [{ itemId: first.id, quantity: "1" }] : []), notes: existing?.notes ?? "" }); }}><option value="" disabled>Select produced or menu item</option>{state.items.filter((item) => !["RM", "PM"].includes(item.type)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}</select></label><label className="field"><span>Usable batch output ({itemMap.get(recipeDraft.outputItemId)?.baseUnit ?? "units"})</span><input required min="0.000001" step="any" inputMode="decimal" value={recipeDraft.outputQuantity} onChange={(event) => setRecipeDraft({ ...recipeDraft, outputQuantity: event.target.value })} /></label><label className="field"><span>Version</span><input disabled value={`v${(state.recipes.find((recipe) => recipe.outputItemId === recipeDraft.outputItemId)?.version ?? 0) + 1}`} /></label></div><div className="builder-heading"><div><h3>Components</h3><p>Quantities use each component&apos;s base unit.</p></div><button type="button" className="button secondary small" onClick={() => { const outputType = itemMap.get(recipeDraft.outputItemId)?.type ?? "MI"; const available = state.items.find((item) => item.id !== recipeDraft.outputItemId && ALLOWED[outputType].includes(item.type) && !recipeDraft.components.some((component) => component.itemId === item.id)); if (available) setRecipeDraft({ ...recipeDraft, components: [...recipeDraft.components, { itemId: available.id, quantity: "1" }] }); }}><Plus size={15} /> Add line</button></div><div className="builder-lines">{recipeDraft.components.map((component, index) => { const outputType = itemMap.get(recipeDraft.outputItemId)?.type ?? "MI"; const choices = state.items.filter((item) => item.id !== recipeDraft.outputItemId && ALLOWED[outputType].includes(item.type)); const selected = itemMap.get(component.itemId); return <div className="builder-line" key={`${index}-${component.itemId}`}><span className="line-number">{index + 1}</span><select aria-label={`Component ${index + 1}`} value={component.itemId} onChange={(event) => { const next = [...recipeDraft.components]; next[index] = { ...next[index], itemId: event.target.value }; setRecipeDraft({ ...recipeDraft, components: next }); }}>{choices.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}</select><div className="quantity-input"><input aria-label={`Quantity for component ${index + 1}`} required min="0.000001" step="any" inputMode="decimal" value={component.quantity} onChange={(event) => { const next = [...recipeDraft.components]; next[index] = { ...next[index], quantity: event.target.value }; setRecipeDraft({ ...recipeDraft, components: next }); }} /><span>{selected?.baseUnit}</span></div><b>{selected?.currentCost === null || !selected ? "Unavailable" : money(selected.currentCost * Number(component.quantity || 0), 4)}</b><button type="button" className="icon-button" aria-label={`Remove component ${index + 1}`} onClick={() => setRecipeDraft({ ...recipeDraft, components: recipeDraft.components.filter((_, entryIndex) => entryIndex !== index) })}><X size={16} /></button></div>; })}{!recipeDraft.components.length && <EmptyState title="No components" detail="Add at least one recipe component." />}</div><label className="field full"><span>Preparation notes</span><textarea rows={3} value={recipeDraft.notes} onChange={(event) => setRecipeDraft({ ...recipeDraft, notes: event.target.value })} placeholder="Yield, process, or portion notes" /></label><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={17} /> : <Check size={17} />} Approve recipe version</button></div></form></Modal>}

    {modal === "pricing" && itemMap.get(pricingDraft.itemId) && <Modal title={`Price ${itemMap.get(pricingDraft.itemId)?.name}`} eyebrow="Pricing target" onClose={() => setModal(null)}><form onSubmit={submitPricing}><div className="pricing-method"><button type="button" className={pricingDraft.method === "markup" ? "active" : ""} onClick={() => setPricingDraft({ ...pricingDraft, method: "markup" })}><strong>Markup</strong><span>Cost × (1 + markup %)</span></button><button type="button" className={pricingDraft.method === "margin" ? "active" : ""} onClick={() => setPricingDraft({ ...pricingDraft, method: "margin" })}><strong>Target margin</strong><span>Cost ÷ (1 − margin %)</span></button></div><div className="form-grid"><label className="field"><span>{pricingDraft.method === "margin" ? "Target margin" : "Markup"} (%)</span><input autoFocus required min="0" max={pricingDraft.method === "margin" ? "99.99" : undefined} step="0.1" inputMode="decimal" value={pricingDraft.targetPercent} onChange={(event) => setPricingDraft({ ...pricingDraft, targetPercent: event.target.value })} /></label><label className="field"><span>Round upward to</span><select value={pricingDraft.rounding} onChange={(event) => setPricingDraft({ ...pricingDraft, rounding: event.target.value })}><option value="1">Nearest ₱1</option><option value="5">Nearest ₱5</option><option value="10">Nearest ₱10</option></select></label></div><div className="suggestion-preview"><span>New suggested price</span><strong>{money(calculateSuggestedPrice(itemMap.get(pricingDraft.itemId)?.currentCost ?? null, pricingDraft.method, Number(pricingDraft.targetPercent), Number(pricingDraft.rounding)))}</strong><small>This changes the target only. Use Approve on the pricing page to publish.</small></div><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={17} /> : <Check size={17} />} Save target</button></div></form></Modal>}
  </div>;
}
