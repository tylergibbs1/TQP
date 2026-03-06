// Synthetic CRM API — TQP Server
//
// Simulates a real-world CRM where some fields are cheap (in-memory lookup)
// and some are EXPENSIVE (database joins, external API calls, ML inference).
//
// The "expense" is simulated with sleep + API call counters so we can
// measure exactly how much work each approach triggers.

import { TQP } from "../src/server";
import { incStat } from "./stats";

// Simulated latencies for expensive operations
const DELAYS = {
  cheap: 0,       // In-memory lookup
  medium: 50,     // Single DB query
  expensive: 150, // Multi-table join or external API
  very_expensive: 300, // ML inference or heavy aggregation
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Track each "backend operation" type
function cheapOp(name: string) {
  incStat("api_calls");
}

async function mediumOp(name: string) {
  incStat("api_calls");
  await sleep(DELAYS.medium);
}

async function expensiveOp(name: string) {
  incStat("api_calls");
  await sleep(DELAYS.expensive);
}

async function veryExpensiveOp(name: string) {
  incStat("api_calls");
  await sleep(DELAYS.very_expensive);
}

// ── Fake data ──────────────────────────────────────────────

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

// ── TQP Server ──────────────────────────────────────────────

export function createCRMServer(): TQP {
  const server = new TQP({
    name: "crm",
    description: "CRM system with companies, contacts, deals, activity logs, health scores, and revenue forecasts",
  });

  server.type("Contact", {
    id:    { type: "string" },
    name:  { type: "string" },
    email: { type: "string" },
    role:  { type: "string" },
    phone: { type: "string" },
  });

  server.type("Deal", {
    id:          { type: "string" },
    title:       { type: "string" },
    value:       { type: "int", description: "Deal value in USD" },
    stage:       { type: "string" },
    probability: { type: "int", description: "Win probability 0-100" },
    created:     { type: "string" },
    close_date:  { type: "string" },
  });

  server.type("Activity", {
    id:               { type: "string" },
    type:             { type: "string", description: "email, call, meeting, note, or task" },
    subject:          { type: "string" },
    date:             { type: "string" },
    duration_minutes: { type: "int" },
    notes:            { type: "string" },
  });

  server.type("HealthFactor", {
    name:   { type: "string" },
    score:  { type: "int" },
    weight: { type: "float" },
  });

  server.type("HealthScore", {
    overall:          { type: "int" },
    engagement:       { type: "int" },
    satisfaction:     { type: "int" },
    growth_potential: { type: "int" },
    churn_risk:       { type: "int" },
    last_calculated:  { type: "string" },
    factors:          { type: "list:HealthFactor", cost: "high", description: "Detailed scoring factors from ML model" },
  });

  server.type("ForecastFactor", {
    name:       { type: "string" },
    impact:     { type: "int" },
    confidence: { type: "int" },
  });

  server.type("MonthlyProjection", {
    month:      { type: "string" },
    revenue:    { type: "int" },
    confidence: { type: "int" },
  });

  server.type("RevenueForecast", {
    current_arr:         { type: "int", description: "Current ARR in USD" },
    predicted_arr_12mo:  { type: "int", description: "Predicted ARR in 12 months" },
    confidence:          { type: "int" },
    model_version:       { type: "string" },
    factors:             { type: "list:ForecastFactor", cost: "high", description: "ML model factors driving prediction" },
    monthly_projection:  { type: "list:MonthlyProjection", cost: "high", description: "Month-by-month revenue projection" },
  });

  server.type("Company", {
    id:               { type: "string" },
    name:             { type: "string" },
    industry:         { type: "string" },
    size:             { type: "int", description: "Number of employees" },
    founded:          { type: "string" },
    website:          { type: "string" },
    contacts:         { type: "list:Contact", cost: "high", description: "All contacts at this company (DB join)" },
    deals:            { type: "list:Deal", cost: "high", description: "All deals with this company (DB join)" },
    activity_log:     { type: "list:Activity", cost: "high", description: "Full activity history (DB join, 15+ records)" },
    health_score:     { type: "HealthScore", cost: "high", description: "ML-computed health score (expensive inference)" },
    revenue_forecast: { type: "RevenueForecast", cost: "high", description: "ML revenue forecast (expensive inference)" },
  });

  // ── Actions ──────────────────────────────────────────────

  server.action("list_companies", {
    description: "List all companies in the CRM",
    input: {
      industry: { type: "string?", description: "Filter by industry" },
    },
    returns: "list:Company",
    safe: true,
    handler: async ({ industry }) => {
      cheapOp("list_companies");
      let companies = COMPANIES;
      if (industry) {
        companies = companies.filter(c => c.industry.toLowerCase() === (industry as string).toLowerCase());
      }
      return companies.map(c => ({
        ...c,
        contacts: [],
        deals: [],
        activity_log: [],
        health_score: { overall: 0, engagement: 0, satisfaction: 0, growth_potential: 0, churn_risk: 0, last_calculated: "", factors: [] },
        revenue_forecast: { current_arr: 0, predicted_arr_12mo: 0, confidence: 0, model_version: "", factors: [], monthly_projection: [] },
      }));
    },
    resolve: {
      contacts: async ({ industry }) => {
        incStat("resolver_runs");
        await mediumOp("resolve_contacts_list");
        // Would resolve per-item in real impl; here we return empty
        return [];
      },
      deals: async ({ industry }) => {
        incStat("resolver_runs");
        await expensiveOp("resolve_deals_list");
        return [];
      },
      activity_log: async ({ industry }) => {
        incStat("resolver_runs");
        await expensiveOp("resolve_activity_list");
        return [];
      },
      health_score: async () => {
        incStat("resolver_runs");
        await veryExpensiveOp("resolve_health_list");
        return { overall: 0, engagement: 0, satisfaction: 0, growth_potential: 0, churn_risk: 0, last_calculated: "", factors: [] };
      },
      revenue_forecast: async () => {
        incStat("resolver_runs");
        await veryExpensiveOp("resolve_forecast_list");
        return { current_arr: 0, predicted_arr_12mo: 0, confidence: 0, model_version: "", factors: [], monthly_projection: [] };
      },
    },
  });

  server.action("get_company", {
    description: "Get a single company by ID with all details",
    input: {
      id: { type: "string", required: true, description: "Company ID (e.g. comp_1)" },
    },
    returns: "Company",
    safe: true,
    handler: async ({ id }) => {
      cheapOp("get_company");
      const company = COMPANIES.find(c => c.id === id);
      if (!company) throw new Error(`Company ${id} not found`);
      return {
        ...company,
        contacts: [],
        deals: [],
        activity_log: [],
        health_score: { overall: 0, engagement: 0, satisfaction: 0, growth_potential: 0, churn_risk: 0, last_calculated: "", factors: [] },
        revenue_forecast: { current_arr: 0, predicted_arr_12mo: 0, confidence: 0, model_version: "", factors: [], monthly_projection: [] },
      };
    },
    resolve: {
      contacts: async ({ id }) => {
        incStat("resolver_runs");
        await mediumOp("resolve_contacts");
        return CONTACTS[id as string] ?? [];
      },
      deals: async ({ id }) => {
        incStat("resolver_runs");
        await expensiveOp("resolve_deals");
        return generateDeals(id as string);
      },
      activity_log: async ({ id }) => {
        incStat("resolver_runs");
        await expensiveOp("resolve_activity");
        return generateActivityLog(id as string);
      },
      health_score: async ({ id }) => {
        incStat("resolver_runs");
        await veryExpensiveOp("resolve_health");
        return generateHealthScore(id as string);
      },
      revenue_forecast: async ({ id }) => {
        incStat("resolver_runs");
        await veryExpensiveOp("resolve_forecast");
        return generateRevenueForecast(id as string);
      },
    },
  });

  server.action("search_contacts", {
    description: "Search contacts across all companies",
    input: {
      query: { type: "string", required: true, description: "Search by name, email, or role" },
    },
    returns: "list:Contact",
    safe: true,
    handler: async ({ query: q }) => {
      cheapOp("search_contacts");
      const term = (q as string).toLowerCase();
      const results: any[] = [];
      for (const contacts of Object.values(CONTACTS)) {
        for (const c of contacts) {
          if (c.name.toLowerCase().includes(term) || c.email.toLowerCase().includes(term) || c.role.toLowerCase().includes(term)) {
            results.push(c);
          }
        }
      }
      return results;
    },
  });

  server.action("get_pipeline_summary", {
    description: "Get a summary of the entire sales pipeline across all companies",
    input: {},
    returns: "list:Deal",
    safe: true,
    handler: async () => {
      await mediumOp("get_pipeline");
      const allDeals: any[] = [];
      for (const company of COMPANIES) {
        allDeals.push(...generateDeals(company.id));
      }
      return allDeals;
    },
  });

  return server;
}

// Run standalone
if (import.meta.main) {
  const port = parseInt(process.env.TQP_PORT ?? "3020", 10);
  const server = createCRMServer();
  server.listen({ transport: "http", port });
}
