#!/usr/bin/env bun
// Synthetic CRM API — MCP Server (best practices)
//
// Follows Anthropic's MCP best practices:
// - Separate tools for separate concerns
// - Don't eagerly load expensive nested data
// - Clear descriptions with return format
//
// But even with best practices, MCP can't avoid returning ALL fields
// on each object. If you only need company names, you still get
// industry, size, founded, website, etc.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { incStat } from "./stats";

// Same simulated latencies as TQP server
const DELAYS = {
  cheap: 0,
  medium: 50,
  expensive: 150,
  very_expensive: 300,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cheapOp(name: string) { incStat("api_calls"); }
async function mediumOp(name: string) { incStat("api_calls"); await sleep(DELAYS.medium); }
async function expensiveOp(name: string) { incStat("api_calls"); await sleep(DELAYS.expensive); }
async function veryExpensiveOp(name: string) { incStat("api_calls"); await sleep(DELAYS.very_expensive); }

// ── Same fake data as TQP server ──────────────────────────

const COMPANIES = [
  { id: "comp_1", name: "Acme Corp", industry: "Technology", size: 450, founded: "2015-03-12", website: "https://acme.example.com" },
  { id: "comp_2", name: "Globex Inc", industry: "Manufacturing", size: 2300, founded: "2001-07-22", website: "https://globex.example.com" },
  { id: "comp_3", name: "Initech", industry: "Consulting", size: 180, founded: "2018-11-05", website: "https://initech.example.com" },
  { id: "comp_4", name: "Umbrella Ltd", industry: "Biotech", size: 8900, founded: "1998-01-15", website: "https://umbrella.example.com" },
  { id: "comp_5", name: "Stark Industries", industry: "Defense", size: 15000, founded: "1970-06-01", website: "https://stark.example.com" },
  { id: "comp_6", name: "Wayne Enterprises", industry: "Conglomerate", size: 32000, founded: "1939-05-01", website: "https://wayne.example.com" },
  { id: "comp_7", name: "Cyberdyne Systems", industry: "AI/Robotics", size: 600, founded: "2020-09-14", website: "https://cyberdyne.example.com" },
  { id: "comp_8", name: "Soylent Corp", industry: "Food Tech", size: 1200, founded: "2016-04-20", website: "https://soylent.example.com" },
];

const CONTACTS: Record<string, any[]> = {
  comp_1: [
    { id: "ct_1", name: "Alice Johnson", email: "alice@acme.com", role: "CEO", phone: "+1-555-0101" },
    { id: "ct_2", name: "Bob Smith", email: "bob@acme.com", role: "CTO", phone: "+1-555-0102" },
    { id: "ct_3", name: "Carol Davis", email: "carol@acme.com", role: "VP Sales", phone: "+1-555-0103" },
  ],
  comp_2: [
    { id: "ct_4", name: "Dan Brown", email: "dan@globex.com", role: "CEO", phone: "+1-555-0201" },
    { id: "ct_5", name: "Eve Wilson", email: "eve@globex.com", role: "CFO", phone: "+1-555-0202" },
  ],
  comp_3: [
    { id: "ct_6", name: "Frank Lee", email: "frank@initech.com", role: "Managing Director", phone: "+1-555-0301" },
  ],
  comp_4: [
    { id: "ct_7", name: "Grace Chen", email: "grace@umbrella.com", role: "CEO", phone: "+1-555-0401" },
    { id: "ct_8", name: "Hank Patel", email: "hank@umbrella.com", role: "CTO", phone: "+1-555-0402" },
  ],
  comp_5: [
    { id: "ct_9", name: "Ivy Martinez", email: "ivy@stark.com", role: "CEO", phone: "+1-555-0501" },
  ],
  comp_6: [
    { id: "ct_10", name: "Jack Wayne", email: "jack@wayne.com", role: "Chairman", phone: "+1-555-0601" },
  ],
  comp_7: [
    { id: "ct_11", name: "Kate Reese", email: "kate@cyberdyne.com", role: "CEO", phone: "+1-555-0701" },
    { id: "ct_12", name: "Leo Connor", email: "leo@cyberdyne.com", role: "Head of AI", phone: "+1-555-0702" },
  ],
  comp_8: [
    { id: "ct_13", name: "Maya Thorn", email: "maya@soylent.com", role: "CEO", phone: "+1-555-0801" },
  ],
};

function generateDeals(companyId: string): any[] {
  const hash = companyId.charCodeAt(companyId.length - 1);
  const count = (hash % 5) + 2;
  const stages = ["Prospecting", "Qualification", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];
  return Array.from({ length: count }, (_, i) => ({
    id: `deal_${companyId}_${i}`,
    title: `${COMPANIES.find(c => c.id === companyId)?.name} - Deal ${i + 1}`,
    value: ((hash * (i + 1) * 7919) % 500000) + 10000,
    stage: stages[(hash + i) % stages.length],
    probability: Math.min(95, ((hash + i * 13) % 100)),
    created: `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((hash % 28) + 1).padStart(2, "0")}`,
    close_date: `2026-${String(((i + 3) % 12) + 1).padStart(2, "0")}-15`,
  }));
}

function generateActivityLog(companyId: string): any[] {
  const hash = companyId.charCodeAt(companyId.length - 1);
  const types = ["email", "call", "meeting", "note", "task"];
  return Array.from({ length: 15 }, (_, i) => ({
    id: `act_${companyId}_${i}`,
    type: types[i % types.length],
    subject: `${types[i % types.length]} with ${COMPANIES.find(c => c.id === companyId)?.name} - ${["Follow-up", "Quarterly review", "Product demo", "Contract discussion", "Onboarding"][i % 5]}`,
    date: `2025-${String(12 - (i % 12)).padStart(2, "0")}-${String((hash + i) % 28 + 1).padStart(2, "0")}`,
    duration_minutes: [15, 30, 45, 60, 90][i % 5],
    notes: `Detailed notes for activity ${i + 1}. Discussed ${["pricing", "timeline", "requirements", "integration", "support"][i % 5]} topics. Follow-up needed: ${i % 2 === 0 ? "yes" : "no"}.`,
  }));
}

function generateHealthScore(companyId: string): any {
  const hash = companyId.charCodeAt(companyId.length - 1);
  return {
    overall: ((hash * 17) % 40) + 60,
    engagement: ((hash * 23) % 30) + 70,
    satisfaction: ((hash * 31) % 35) + 65,
    growth_potential: ((hash * 37) % 45) + 55,
    churn_risk: Math.max(5, 100 - ((hash * 41) % 40) - 60),
    last_calculated: "2026-03-06T00:00:00Z",
    factors: [
      { name: "Response time", score: ((hash * 43) % 30) + 70, weight: 0.25 },
      { name: "Feature adoption", score: ((hash * 47) % 35) + 65, weight: 0.20 },
      { name: "Support tickets", score: ((hash * 53) % 25) + 75, weight: 0.15 },
      { name: "Contract value trend", score: ((hash * 59) % 40) + 60, weight: 0.20 },
      { name: "Stakeholder engagement", score: ((hash * 61) % 30) + 70, weight: 0.20 },
    ],
  };
}

function generateRevenueForecast(companyId: string): any {
  const hash = companyId.charCodeAt(companyId.length - 1);
  const base = ((hash * 7919) % 500000) + 50000;
  return {
    current_arr: base,
    predicted_arr_12mo: Math.round(base * (1 + ((hash % 30) + 5) / 100)),
    confidence: ((hash * 67) % 20) + 75,
    model_version: "v3.2.1",
    factors: [
      { name: "Historical growth", impact: ((hash * 71) % 20) - 10, confidence: 85 },
      { name: "Market conditions", impact: ((hash * 73) % 15) - 7, confidence: 70 },
      { name: "Product usage trend", impact: ((hash * 79) % 25) - 5, confidence: 80 },
      { name: "Competitive landscape", impact: -((hash * 83) % 10), confidence: 60 },
    ],
    monthly_projection: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, "0")}`,
      revenue: Math.round(base / 12 * (1 + ((hash + i) % 10) / 100)),
      confidence: Math.max(50, 90 - i * 3),
    })),
  };
}

// ── MCP Server ──────────────────────────────────────────────

const server = new McpServer({
  name: "crm-mcp",
  version: "0.1.0",
});

// Best practice: list_companies returns metadata only (no nested data)
server.registerTool("list_companies", {
  description:
    "List all companies in the CRM. Returns company metadata only (no contacts, deals, or scores). " +
    "Each company includes: id (string), name (string), industry (string), size (int, employees), " +
    "founded (string, date), website (string). " +
    "Use get_company_contacts, get_company_deals, get_company_activity, get_company_health, " +
    "get_company_forecast for detailed data.",
  inputSchema: {
    industry: z.string().optional().describe("Filter by industry"),
  },
}, async ({ industry }) => {
  cheapOp("list_companies");
  let companies = COMPANIES;
  if (industry) {
    companies = companies.filter(c => c.industry.toLowerCase() === industry.toLowerCase());
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(companies, null, 2) }] };
});

// Best practice: separate tool for company detail (still no nested)
server.registerTool("get_company", {
  description:
    "Get a single company by ID. Returns: id, name, industry, size, founded, website. " +
    "Does NOT include contacts, deals, activity, health score, or forecast. " +
    "Use dedicated tools for those.",
  inputSchema: {
    id: z.string().describe("Company ID (e.g. comp_1)"),
  },
}, async ({ id }) => {
  cheapOp("get_company");
  const company = COMPANIES.find(c => c.id === id);
  if (!company) throw new Error(`Company ${id} not found`);
  return { content: [{ type: "text" as const, text: JSON.stringify(company, null, 2) }] };
});

// Best practice: separate tool for contacts
server.registerTool("get_company_contacts", {
  description:
    "Get all contacts for a company. Returns array of: id, name, email, role, phone.",
  inputSchema: {
    company_id: z.string().describe("Company ID"),
  },
}, async ({ company_id }) => {
  await mediumOp("get_contacts");
  const contacts = CONTACTS[company_id] ?? [];
  return { content: [{ type: "text" as const, text: JSON.stringify(contacts, null, 2) }] };
});

// Best practice: separate tool for deals
server.registerTool("get_company_deals", {
  description:
    "Get all deals for a company. Returns array of: id, title, value (USD), stage, probability (0-100), created, close_date.",
  inputSchema: {
    company_id: z.string().describe("Company ID"),
  },
}, async ({ company_id }) => {
  await expensiveOp("get_deals");
  return { content: [{ type: "text" as const, text: JSON.stringify(generateDeals(company_id), null, 2) }] };
});

// Best practice: separate tool for activity log
server.registerTool("get_company_activity", {
  description:
    "Get activity log for a company. Returns array of: id, type (email/call/meeting/note/task), " +
    "subject, date, duration_minutes, notes. Up to 15 recent activities.",
  inputSchema: {
    company_id: z.string().describe("Company ID"),
  },
}, async ({ company_id }) => {
  await expensiveOp("get_activity");
  return { content: [{ type: "text" as const, text: JSON.stringify(generateActivityLog(company_id), null, 2) }] };
});

// Best practice: separate tool for health score (expensive ML inference)
server.registerTool("get_company_health", {
  description:
    "Get ML-computed health score for a company. EXPENSIVE operation (runs ML inference). " +
    "Returns: overall (0-100), engagement, satisfaction, growth_potential, churn_risk, " +
    "last_calculated, factors (array of scoring factors with name, score, weight).",
  inputSchema: {
    company_id: z.string().describe("Company ID"),
  },
}, async ({ company_id }) => {
  await veryExpensiveOp("get_health");
  return { content: [{ type: "text" as const, text: JSON.stringify(generateHealthScore(company_id), null, 2) }] };
});

// Best practice: separate tool for revenue forecast (expensive ML inference)
server.registerTool("get_company_forecast", {
  description:
    "Get ML revenue forecast for a company. EXPENSIVE operation (runs ML model). " +
    "Returns: current_arr, predicted_arr_12mo, confidence, model_version, " +
    "factors (ML model factors), monthly_projection (12-month breakdown).",
  inputSchema: {
    company_id: z.string().describe("Company ID"),
  },
}, async ({ company_id }) => {
  await veryExpensiveOp("get_forecast");
  return { content: [{ type: "text" as const, text: JSON.stringify(generateRevenueForecast(company_id), null, 2) }] };
});

// Separate tool for pipeline
server.registerTool("get_pipeline_summary", {
  description:
    "Get all deals across all companies. Returns array of deal objects.",
  inputSchema: {},
}, async () => {
  await mediumOp("get_pipeline");
  const allDeals: any[] = [];
  for (const company of COMPANIES) {
    allDeals.push(...generateDeals(company.id));
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(allDeals, null, 2) }] };
});

// Separate tool for contact search
server.registerTool("search_contacts", {
  description:
    "Search contacts across all companies by name, email, or role.",
  inputSchema: {
    query: z.string().describe("Search term"),
  },
}, async ({ query: q }) => {
  cheapOp("search_contacts");
  const term = q.toLowerCase();
  const results: any[] = [];
  for (const contacts of Object.values(CONTACTS)) {
    for (const c of contacts) {
      if (c.name.toLowerCase().includes(term) || c.email.toLowerCase().includes(term) || c.role.toLowerCase().includes(term)) {
        results.push(c);
      }
    }
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
