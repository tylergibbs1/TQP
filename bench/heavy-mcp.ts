#!/usr/bin/env bun
// Heavy Benchmark MCP Server — best practices
//
// Same data as heavy-tqp.ts but using MCP's separate-tools pattern.
// No field selection: every tool returns all fields on its objects.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { incStat } from "./stats";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Same data generation as TQP server
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
let cart: { product_id: string; quantity: number }[] = [];
let orders: any[] = [];

// ── MCP Server ──────────────────────────────────────────────

const server = new McpServer({ name: "ecommerce-mcp", version: "0.1.0" });

// List products (metadata only, no expensive fields — best practice)
server.registerTool("list_products", {
  description:
    "List products in the catalog. Returns product metadata: id, name, sku, brand, category, price, currency, " +
    "in_stock, stock_count, rating, review_count, weight_kg, dimensions, tags, created, updated. " +
    "Does NOT include description, reviews, related products, price history, supplier info, or analytics. " +
    "Use dedicated tools for those.",
  inputSchema: {
    category: z.string().optional().describe("Filter by category"),
    in_stock: z.boolean().optional().describe("Filter by stock status"),
    limit: z.number().default(20).describe("Max products to return"),
    offset: z.number().default(0).describe("Offset for pagination"),
  },
}, async ({ category, in_stock, limit, offset }) => {
  incStat("api_calls");
  let products = ALL_PRODUCTS;
  if (category) products = products.filter(p => p.category.toLowerCase() === category.toLowerCase());
  if (in_stock !== undefined) products = products.filter(p => p.in_stock === in_stock);
  const slice = products.slice(offset, offset + limit);
  return { content: [{ type: "text" as const, text: JSON.stringify(slice, null, 2) }] };
});

server.registerTool("get_product", {
  description:
    "Get a single product by ID. Returns all metadata fields (same as list_products). " +
    "Use dedicated tools for description, reviews, price history, supplier, analytics.",
  inputSchema: { id: z.string().describe("Product ID") },
}, async ({ id }) => {
  incStat("api_calls");
  const p = ALL_PRODUCTS.find(p => p.id === id);
  if (!p) throw new Error(`Product ${id} not found`);
  return { content: [{ type: "text" as const, text: JSON.stringify(p, null, 2) }] };
});

server.registerTool("search_products", {
  description: "Search products by name or tag. Returns product metadata (no expensive fields).",
  inputSchema: { query: z.string().describe("Search term") },
}, async ({ query: q }) => {
  incStat("api_calls");
  const term = q.toLowerCase();
  const results = ALL_PRODUCTS.filter(p =>
    p.name.toLowerCase().includes(term) || p.tags.some(t => t.includes(term))
  );
  return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
});

// Separate expensive tools (best practice)
server.registerTool("get_product_description", {
  description: "Get full product description. Returns the generated description text.",
  inputSchema: { id: z.string().describe("Product ID") },
}, async ({ id }) => {
  incStat("api_calls"); await sleep(50);
  const idx = parseInt(id.split("_")[1]);
  return { content: [{ type: "text" as const, text: generateDescription(idx) }] };
});

server.registerTool("get_product_reviews", {
  description: "Get all customer reviews for a product (up to 8). Each review has: id, author, rating, title, text, date, helpful_votes, verified_purchase.",
  inputSchema: { id: z.string().describe("Product ID") },
}, async ({ id }) => {
  incStat("api_calls"); await sleep(150);
  const idx = parseInt(id.split("_")[1]);
  return { content: [{ type: "text" as const, text: JSON.stringify(generateReviews(idx), null, 2) }] };
});

server.registerTool("get_product_price_history", {
  description: "Get 12-month price history for a product. Array of: date, price, was_on_sale.",
  inputSchema: { id: z.string().describe("Product ID") },
}, async ({ id }) => {
  incStat("api_calls"); await sleep(100);
  const idx = parseInt(id.split("_")[1]);
  return { content: [{ type: "text" as const, text: JSON.stringify(generatePriceHistory(idx), null, 2) }] };
});

server.registerTool("get_product_supplier", {
  description: "Get supplier info for a product. Returns: name, lead_time_days, cost, country, reliability_score.",
  inputSchema: { id: z.string().describe("Product ID") },
}, async ({ id }) => {
  incStat("api_calls"); await sleep(150);
  const idx = parseInt(id.split("_")[1]);
  return { content: [{ type: "text" as const, text: JSON.stringify(generateSupplier(idx), null, 2) }] };
});

server.registerTool("get_product_analytics", {
  description: "Get 30-day analytics for a product. Returns: views_30d, purchases_30d, conversion_rate, return_rate, avg_time_on_page.",
  inputSchema: { id: z.string().describe("Product ID") },
}, async ({ id }) => {
  incStat("api_calls"); await sleep(200);
  const idx = parseInt(id.split("_")[1]);
  return { content: [{ type: "text" as const, text: JSON.stringify(generateAnalytics(idx), null, 2) }] };
});

// Write operations
server.registerTool("add_to_cart", {
  description: "Add a product to the shopping cart. Returns updated cart.",
  inputSchema: {
    product_id: z.string().describe("Product ID"),
    quantity: z.number().default(1).describe("Quantity"),
  },
}, async ({ product_id, quantity }) => {
  incStat("api_calls");
  const existing = cart.find(c => c.product_id === product_id);
  if (existing) existing.quantity += quantity;
  else cart.push({ product_id, quantity });
  return { content: [{ type: "text" as const, text: JSON.stringify(cart, null, 2) }] };
});

server.registerTool("place_order", {
  description: "Place an order from the current cart. WARNING: This charges the customer's payment method. Cannot be undone.",
  inputSchema: {},
}, async () => {
  incStat("api_calls");
  if (cart.length === 0) throw new Error("Cart is empty");
  const total = cart.reduce((sum, item) => {
    const p = ALL_PRODUCTS.find(p => p.id === item.product_id);
    return sum + (p?.price ?? 0) * item.quantity;
  }, 0);
  const order = { id: `ord_${Date.now()}`, items: [...cart], total: Math.round(total * 100) / 100, status: "confirmed" };
  orders.push(order);
  cart = [];
  return { content: [{ type: "text" as const, text: JSON.stringify(order, null, 2) }] };
});

server.registerTool("get_cart", {
  description: "View current shopping cart contents.",
  inputSchema: {},
}, async () => {
  incStat("api_calls");
  return { content: [{ type: "text" as const, text: JSON.stringify(cart, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
