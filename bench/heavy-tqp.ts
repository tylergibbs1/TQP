// Heavy Benchmark TQP Server
//
// Three test surfaces:
// 1. Scale: 50 products with 20+ fields and deep nesting
// 2. Write operations: safe/confirm/dry_run protocol-level safety
// 3. Multi-turn research: agent must gather data across many calls

import { TQP } from "../src/server";
import { incStat } from "./stats";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Fake product catalog (50 products, deeply nested) ──────

const CATEGORIES = ["Electronics", "Clothing", "Home", "Sports", "Books", "Food", "Toys", "Auto", "Health", "Garden"];
const BRANDS = ["AlphaTech", "BetaWear", "GammaHome", "DeltaSport", "EpsilonBooks", "ZetaFoods", "EtaToys", "ThetaAuto", "IotaHealth", "KappaGarden"];

function generateProduct(i: number) {
  const hash = ((i * 7919) + 31) % 1000;
  const cat = CATEGORIES[i % CATEGORIES.length];
  const brand = BRANDS[i % BRANDS.length];
  return {
    id: `prod_${i}`,
    name: `${brand} ${cat} Pro ${i}`,
    sku: `SKU-${String(hash).padStart(6, "0")}`,
    brand,
    category: cat,
    price: ((hash * 13) % 50000 + 500) / 100,
    currency: "USD",
    in_stock: hash % 3 !== 0,
    stock_count: hash % 3 !== 0 ? (hash % 200) + 1 : 0,
    rating: Math.round(((hash % 40) + 10) / 10 * 10) / 10,
    review_count: (hash * 7) % 500,
    weight_kg: ((hash % 100) + 1) / 10,
    dimensions: { length: (hash % 50) + 5, width: (hash % 40) + 3, height: (hash % 30) + 2 },
    tags: [cat.toLowerCase(), brand.toLowerCase(), hash % 2 === 0 ? "sale" : "new", hash % 5 === 0 ? "bestseller" : "regular"],
    created: `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((hash % 28) + 1).padStart(2, "0")}`,
    updated: `2026-02-${String((hash % 28) + 1).padStart(2, "0")}`,
    // Expensive fields (computed/joined)
    description: "",
    reviews: [] as any[],
    related_products: [] as string[],
    price_history: [] as any[],
    supplier_info: { name: "", lead_time_days: 0, cost: 0, country: "", reliability_score: 0 },
    analytics: { views_30d: 0, purchases_30d: 0, conversion_rate: 0, return_rate: 0, avg_time_on_page: 0 },
  };
}

function generateDescription(i: number): string {
  const p = generateProduct(i);
  return `The ${p.name} is a premium ${p.category.toLowerCase()} product by ${p.brand}. ` +
    `Featuring advanced technology and superior build quality, this product has earned a ${p.rating}/5 rating ` +
    `from ${p.review_count} verified customers. Perfect for everyday use with a weight of just ${p.weight_kg}kg. ` +
    `Dimensions: ${p.dimensions.length}x${p.dimensions.width}x${p.dimensions.height}cm. ` +
    `Currently ${p.in_stock ? "in stock" : "out of stock"} with ${p.stock_count} units available. ` +
    `Tagged as: ${p.tags.join(", ")}. Available since ${p.created}.`;
}

function generateReviews(i: number): any[] {
  const hash = ((i * 7919) + 31) % 1000;
  return Array.from({ length: 8 }, (_, j) => ({
    id: `rev_${i}_${j}`,
    author: `User${(hash + j * 17) % 500}`,
    rating: Math.min(5, Math.max(1, (hash + j) % 6)),
    title: ["Great product!", "Decent quality", "Not worth it", "Amazing!", "Could be better", "Love it", "Meh", "Fantastic"][j],
    text: `Review ${j + 1} for product ${i}. ${["Exceeded expectations.", "Works as described.", "Had some issues.", "Would buy again.", "Returned it.", "Best purchase ever.", "Average product.", "Highly recommend."][j]}`,
    date: `2025-${String((j % 12) + 1).padStart(2, "0")}-15`,
    helpful_votes: (hash + j * 31) % 50,
    verified_purchase: j % 3 !== 2,
  }));
}

function generatePriceHistory(i: number): any[] {
  const hash = ((i * 7919) + 31) % 1000;
  const base = ((hash * 13) % 50000 + 500) / 100;
  return Array.from({ length: 12 }, (_, j) => ({
    date: `2025-${String(j + 1).padStart(2, "0")}-01`,
    price: Math.round((base * (1 + ((hash + j * 7) % 20 - 10) / 100)) * 100) / 100,
    was_on_sale: j % 4 === 0,
  }));
}

function generateSupplier(i: number): any {
  const hash = ((i * 7919) + 31) % 1000;
  const countries = ["China", "USA", "Germany", "Japan", "South Korea", "India", "Vietnam", "Mexico"];
  return {
    name: `Supplier ${(hash % 20) + 1}`,
    lead_time_days: (hash % 30) + 3,
    cost: Math.round(((hash * 13) % 50000 + 500) / 100 * 0.6 * 100) / 100,
    country: countries[hash % countries.length],
    reliability_score: ((hash % 30) + 70) / 100,
  };
}

function generateAnalytics(i: number): any {
  const hash = ((i * 7919) + 31) % 1000;
  return {
    views_30d: (hash * 17) % 10000 + 100,
    purchases_30d: (hash * 3) % 500 + 5,
    conversion_rate: Math.round(((hash % 15) + 1) / 100 * 10000) / 10000,
    return_rate: Math.round(((hash % 8)) / 100 * 10000) / 10000,
    avg_time_on_page: ((hash % 180) + 20),
  };
}

const ALL_PRODUCTS = Array.from({ length: 50 }, (_, i) => generateProduct(i));

// ── Cart / Orders for write operations ──────

let cart: { product_id: string; quantity: number }[] = [];
let orders: { id: string; items: typeof cart; total: number; status: string }[] = [];

export function createHeavyServer(): TQP {
  const server = new TQP({
    name: "ecommerce",
    description: "E-commerce product catalog with 50 products, deep nesting, write operations, and analytics",
  });

  // Types
  server.type("Dimension", {
    length: { type: "int" },
    width:  { type: "int" },
    height: { type: "int" },
  });

  server.type("Review", {
    id:                { type: "string" },
    author:            { type: "string" },
    rating:            { type: "int" },
    title:             { type: "string" },
    text:              { type: "string" },
    date:              { type: "string" },
    helpful_votes:     { type: "int" },
    verified_purchase: { type: "bool" },
  });

  server.type("PricePoint", {
    date:        { type: "string" },
    price:       { type: "float" },
    was_on_sale: { type: "bool" },
  });

  server.type("Supplier", {
    name:              { type: "string" },
    lead_time_days:    { type: "int" },
    cost:              { type: "float", description: "Wholesale cost" },
    country:           { type: "string" },
    reliability_score: { type: "float" },
  });

  server.type("Analytics", {
    views_30d:         { type: "int" },
    purchases_30d:     { type: "int" },
    conversion_rate:   { type: "float" },
    return_rate:       { type: "float" },
    avg_time_on_page:  { type: "int", description: "Seconds" },
  });

  server.type("Product", {
    id:               { type: "string" },
    name:             { type: "string" },
    sku:              { type: "string" },
    brand:            { type: "string" },
    category:         { type: "string" },
    price:            { type: "float" },
    currency:         { type: "string" },
    in_stock:         { type: "bool" },
    stock_count:      { type: "int" },
    rating:           { type: "float" },
    review_count:     { type: "int" },
    weight_kg:        { type: "float" },
    dimensions:       { type: "Dimension" },
    tags:             { type: "list:string" },
    created:          { type: "string" },
    updated:          { type: "string" },
    description:      { type: "string", cost: "high", description: "Full product description (generated)" },
    reviews:          { type: "list:Review", cost: "high", description: "All customer reviews (DB join)" },
    related_products: { type: "list:string", cost: "high", description: "IDs of related products (ML recommendation)" },
    price_history:    { type: "list:PricePoint", cost: "high", description: "12-month price history" },
    supplier_info:    { type: "Supplier", cost: "high", description: "Supplier details (external API)" },
    analytics:        { type: "Analytics", cost: "high", description: "30-day analytics (aggregation query)" },
  });

  server.type("CartItem", {
    product_id: { type: "string" },
    quantity:   { type: "int" },
  });

  server.type("Order", {
    id:     { type: "string" },
    items:  { type: "list:CartItem" },
    total:  { type: "float" },
    status: { type: "string" },
  });

  // ── Read actions ──────────────────────────────────────────

  server.action("list_products", {
    description: "List products in the catalog",
    input: {
      category: { type: "string?", description: "Filter by category" },
      in_stock: { type: "bool?", description: "Filter by stock status" },
      limit:    { type: "int", default: 20 },
      offset:   { type: "int", default: 0 },
    },
    returns: "list:Product",
    safe: true,
    handler: async ({ category, in_stock, limit, offset }) => {
      incStat("api_calls");
      let products = ALL_PRODUCTS;
      if (category) products = products.filter(p => p.category.toLowerCase() === (category as string).toLowerCase());
      if (in_stock !== undefined) products = products.filter(p => p.in_stock === in_stock);
      return products.slice(offset as number ?? 0, (offset as number ?? 0) + (limit as number ?? 20));
    },
    resolve: {
      description: async () => { incStat("resolver_runs"); incStat("api_calls"); await sleep(50); return ""; },
      reviews: async () => { incStat("resolver_runs"); incStat("api_calls"); await sleep(150); return []; },
      related_products: async () => { incStat("resolver_runs"); incStat("api_calls"); await sleep(200); return []; },
      price_history: async () => { incStat("resolver_runs"); incStat("api_calls"); await sleep(100); return []; },
      supplier_info: async () => { incStat("resolver_runs"); incStat("api_calls"); await sleep(150); return { name: "", lead_time_days: 0, cost: 0, country: "", reliability_score: 0 }; },
      analytics: async () => { incStat("resolver_runs"); incStat("api_calls"); await sleep(200); return { views_30d: 0, purchases_30d: 0, conversion_rate: 0, return_rate: 0, avg_time_on_page: 0 }; },
    },
  });

  server.action("get_product", {
    description: "Get a single product by ID",
    input: {
      id: { type: "string", required: true },
    },
    returns: "Product",
    safe: true,
    handler: async ({ id }) => {
      incStat("api_calls");
      const p = ALL_PRODUCTS.find(p => p.id === id);
      if (!p) throw new Error(`Product ${id} not found`);
      return { ...p };
    },
    resolve: {
      description: async ({ id }) => { incStat("resolver_runs"); incStat("api_calls"); await sleep(50); return generateDescription(parseInt((id as string).split("_")[1])); },
      reviews: async ({ id }) => { incStat("resolver_runs"); incStat("api_calls"); await sleep(150); return generateReviews(parseInt((id as string).split("_")[1])); },
      related_products: async ({ id }) => {
        incStat("resolver_runs"); incStat("api_calls"); await sleep(200);
        const idx = parseInt((id as string).split("_")[1]);
        return [1, 2, 3, 4, 5].map(d => `prod_${(idx + d) % 50}`);
      },
      price_history: async ({ id }) => { incStat("resolver_runs"); incStat("api_calls"); await sleep(100); return generatePriceHistory(parseInt((id as string).split("_")[1])); },
      supplier_info: async ({ id }) => { incStat("resolver_runs"); incStat("api_calls"); await sleep(150); return generateSupplier(parseInt((id as string).split("_")[1])); },
      analytics: async ({ id }) => { incStat("resolver_runs"); incStat("api_calls"); await sleep(200); return generateAnalytics(parseInt((id as string).split("_")[1])); },
    },
  });

  server.action("search_products", {
    description: "Search products by name or tag",
    input: {
      query: { type: "string", required: true },
    },
    returns: "list:Product",
    safe: true,
    handler: async ({ query: q }) => {
      incStat("api_calls");
      const term = (q as string).toLowerCase();
      return ALL_PRODUCTS.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.tags.some(t => t.includes(term))
      );
    },
    resolve: {
      description: async () => { incStat("resolver_runs"); incStat("api_calls"); await sleep(50); return ""; },
      reviews: async () => { incStat("resolver_runs"); incStat("api_calls"); await sleep(150); return []; },
      related_products: async () => { incStat("resolver_runs"); incStat("api_calls"); await sleep(200); return []; },
      price_history: async () => { incStat("resolver_runs"); incStat("api_calls"); await sleep(100); return []; },
      supplier_info: async () => { incStat("resolver_runs"); incStat("api_calls"); await sleep(150); return { name: "", lead_time_days: 0, cost: 0, country: "", reliability_score: 0 }; },
      analytics: async () => { incStat("resolver_runs"); incStat("api_calls"); await sleep(200); return { views_30d: 0, purchases_30d: 0, conversion_rate: 0, return_rate: 0, avg_time_on_page: 0 }; },
    },
  });

  // ── Write actions ──────────────────────────────────────────

  server.action("add_to_cart", {
    description: "Add a product to the shopping cart",
    input: {
      product_id: { type: "string", required: true },
      quantity:   { type: "int", default: 1 },
    },
    returns: "list:CartItem",
    safe: false,
    handler: async ({ product_id, quantity }) => {
      incStat("api_calls");
      const existing = cart.find(c => c.product_id === product_id);
      if (existing) existing.quantity += (quantity as number) ?? 1;
      else cart.push({ product_id: product_id as string, quantity: (quantity as number) ?? 1 });
      return [...cart];
    },
  });

  server.action("place_order", {
    description: "Place an order from the current cart. This charges the customer's payment method.",
    input: {},
    returns: "Order",
    safe: false,
    confirm: true,
    handler: async (_input, ctx) => {
      incStat("api_calls");
      if (cart.length === 0) throw new Error("Cart is empty");
      const total = cart.reduce((sum, item) => {
        const p = ALL_PRODUCTS.find(p => p.id === item.product_id);
        return sum + (p?.price ?? 0) * item.quantity;
      }, 0);
      const order = {
        id: `ord_${Date.now()}`,
        items: [...cart],
        total: Math.round(total * 100) / 100,
        status: "confirmed",
      };
      orders.push(order);
      cart = [];
      return order;
    },
  });

  server.action("get_cart", {
    description: "View current shopping cart",
    input: {},
    returns: "list:CartItem",
    safe: true,
    handler: async () => {
      incStat("api_calls");
      return [...cart];
    },
  });

  return server;
}

if (import.meta.main) {
  const port = parseInt(process.env.TQP_PORT ?? "3030", 10);
  const server = createHeavyServer();
  server.listen({ transport: "http", port });
}
