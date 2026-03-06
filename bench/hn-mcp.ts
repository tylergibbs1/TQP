#!/usr/bin/env bun
// MCP Hacker News Server — Best Practices Edition (instrumented)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { incStat } from "./stats";

const HN_API = "https://hacker-news.firebaseio.com/v0";

async function hnFetch(path: string): Promise<any> {
  incStat("api_calls");
  const res = await fetch(`${HN_API}${path}`);
  return res.json();
}

async function fetchComments(ids: number[], depth = 0, maxDepth = 3): Promise<any[]> {
  if (depth >= maxDepth || !ids || ids.length === 0) return [];
  const comments = await Promise.all(
    ids.map(async (id) => {
      const item = await hnFetch(`/item/${id}.json`);
      if (!item || item.deleted || item.dead) return null;
      const replies = await fetchComments(item.kids ?? [], depth + 1, maxDepth);
      return {
        id: String(item.id),
        by: item.by ?? "[deleted]",
        text: item.text ?? "",
        time: new Date((item.time ?? 0) * 1000).toISOString(),
        reply_count: (item.kids ?? []).length,
        replies,
      };
    })
  );
  return comments.filter(Boolean);
}

const server = new McpServer({
  name: "hackernews-mcp",
  version: "0.1.0",
});

server.registerTool("top_stories", {
  description:
    "Get current top stories from Hacker News. Returns story metadata only (no comments). " +
    "Each story includes: id (string), title (string), url (string), text (string, may be empty for link posts), " +
    "by (string, author username), score (int), time (ISO 8601), descendants (int, total comment count), " +
    "comment_count (int, top-level comments). Use get_comments to fetch comments for a specific story.",
  inputSchema: {
    limit: z.number().default(10).describe("Number of stories to return (max 30)"),
  },
}, async ({ limit }) => {
  const ids: number[] = await hnFetch("/topstories.json");
  const topIds = ids.slice(0, Math.min(limit, 30));

  const stories = await Promise.all(
    topIds.map(async (id) => {
      const item = await hnFetch(`/item/${id}.json`);
      return {
        id: String(item.id),
        title: item.title ?? "",
        url: item.url ?? "",
        text: item.text ?? "",
        by: item.by ?? "",
        score: item.score ?? 0,
        time: new Date((item.time ?? 0) * 1000).toISOString(),
        descendants: item.descendants ?? 0,
        comment_count: (item.kids ?? []).length,
      };
    })
  );

  return { content: [{ type: "text" as const, text: JSON.stringify(stories, null, 2) }] };
});

server.registerTool("get_story", {
  description:
    "Get a single story with full metadata (no comments). " +
    "Returns: id (string), title (string), url (string), text (string), by (string, author username), " +
    "score (int), time (ISO 8601), descendants (int, total comment count), comment_count (int). " +
    "Use get_comments to fetch the comment thread separately.",
  inputSchema: {
    id: z.string().describe("Story ID"),
  },
}, async ({ id }) => {
  const item = await hnFetch(`/item/${id}.json`);
  if (!item) throw new Error(`Story ${id} not found`);
  const story = {
    id: String(item.id),
    title: item.title ?? "",
    url: item.url ?? "",
    text: item.text ?? "",
    by: item.by ?? "",
    score: item.score ?? 0,
    time: new Date((item.time ?? 0) * 1000).toISOString(),
    descendants: item.descendants ?? 0,
    comment_count: (item.kids ?? []).length,
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(story, null, 2) }] };
});

// MCP best practice: always returns full user object (no field selection)
server.registerTool("get_user", {
  description:
    "Get a Hacker News user profile. " +
    "Returns: id (string, username), karma (int), about (string, HTML bio), " +
    "created (ISO 8601), submitted (array of up to 50 recent item ID strings).",
  inputSchema: {
    username: z.string().describe("Username"),
  },
}, async ({ username }) => {
  const user = await hnFetch(`/user/${username}.json`);
  if (!user) throw new Error(`User ${username} not found`);
  const result = {
    id: user.id ?? "",
    karma: user.karma ?? 0,
    about: user.about ?? "",
    created: new Date((user.created ?? 0) * 1000).toISOString(),
    submitted: (user.submitted ?? []).slice(0, 50).map(String),
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
});

server.registerTool("get_comments", {
  description:
    "Get comments for a story with nested replies. " +
    "Returns an array of comment objects, each containing: id (string), by (string, author), " +
    "text (string, HTML content), time (ISO 8601), reply_count (int), " +
    "replies (array of nested comment objects, same structure). " +
    "Use limit and max_depth to control response size.",
  inputSchema: {
    story_id: z.string().describe("Story ID to get comments for"),
    limit: z.number().default(20).describe("Max number of top-level comments to return"),
    max_depth: z.number().default(3).describe("Max nesting depth for replies (1 = top-level only)"),
  },
}, async ({ story_id, limit, max_depth }) => {
  const item = await hnFetch(`/item/${story_id}.json`);
  if (!item) throw new Error(`Story ${story_id} not found`);
  const kidIds = (item.kids ?? []).slice(0, limit);
  const comments = await fetchComments(kidIds, 0, max_depth);
  return { content: [{ type: "text" as const, text: JSON.stringify(comments, null, 2) }] };
});

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);
