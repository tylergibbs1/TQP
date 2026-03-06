// TQP Server for Hacker News — instrumented with stats tracking

import { TQP } from "../src/server";
import { incStat } from "./stats";

const HN_API = "https://hacker-news.firebaseio.com/v0";

async function hnFetch(path: string): Promise<any> {
  incStat("api_calls");
  const res = await fetch(`${HN_API}${path}`);
  return res.json();
}

async function fetchComments(ids: number[], depth: number = 0, maxDepth: number = 3): Promise<any[]> {
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
        replies,
        reply_count: (item.kids ?? []).length,
      };
    })
  );

  return comments.filter(Boolean);
}

export function createHNServer(): TQP {
  const server = new TQP({
    name: "hackernews",
    description: "Hacker News stories, comments, and users",
  });

  server.type("User", {
    id:        { type: "string" },
    karma:     { type: "int" },
    about:     { type: "string", cost: "high", description: "HTML bio (can be large)" },
    created:   { type: "string" },
    submitted: { type: "list:string", cost: "high", description: "IDs of up to 50 recent submitted items" },
  });

  server.type("Comment", {
    id:          { type: "string" },
    by:          { type: "string" },
    text:        { type: "string" },
    time:        { type: "string" },
    replies:     { type: "list:Comment", cost: "high" },
    reply_count: { type: "int" },
  });

  server.type("Story", {
    id:           { type: "string" },
    title:        { type: "string" },
    url:          { type: "string" },
    text:         { type: "string" },
    by:           { type: "string" },
    score:        { type: "int" },
    time:         { type: "string" },
    descendants:  { type: "int", description: "Total comment count" },
    comments:     { type: "list:Comment", cost: "high" },
    comment_count: { type: "int" },
  });

  server.action("top_stories", {
    description: "Get current top stories from Hacker News",
    input: {
      limit: { type: "int", default: 10 },
    },
    returns: "list:Story",
    safe: true,
    handler: async ({ limit }) => {
      const ids: number[] = await hnFetch("/topstories.json");
      const topIds = ids.slice(0, (limit as number) ?? 10);

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
            comments: [],
            comment_count: (item.kids ?? []).length,
          };
        })
      );

      return stories;
    },
    resolve: {
      comments: async ({ limit }) => {
        incStat("resolver_runs");
        return [];
      },
    },
  });

  server.action("get_story", {
    description: "Get a single story with full details",
    input: {
      id: { type: "string", required: true },
    },
    returns: "Story",
    safe: true,
    handler: async ({ id }) => {
      const item = await hnFetch(`/item/${id}.json`);
      if (!item) throw new Error(`Story ${id} not found`);

      return {
        id: String(item.id),
        title: item.title ?? "",
        url: item.url ?? "",
        text: item.text ?? "",
        by: item.by ?? "",
        score: item.score ?? 0,
        time: new Date((item.time ?? 0) * 1000).toISOString(),
        descendants: item.descendants ?? 0,
        comments: [],
        comment_count: (item.kids ?? []).length,
      };
    },
    resolve: {
      comments: async ({ id }) => {
        incStat("resolver_runs");
        const item = await hnFetch(`/item/${id}.json`);
        return fetchComments(item.kids ?? [], 0, 2);
      },
    },
  });

  server.action("get_user", {
    description: "Get a Hacker News user profile",
    input: {
      username: { type: "string", required: true },
    },
    returns: "User",
    safe: true,
    handler: async ({ username }) => {
      const user = await hnFetch(`/user/${username}.json`);
      if (!user) throw new Error(`User ${username} not found`);

      // Return cheap fields; expensive fields use lazy resolvers
      return {
        id: user.id ?? "",
        karma: user.karma ?? 0,
        about: "",
        created: new Date((user.created ?? 0) * 1000).toISOString(),
        submitted: [],
      };
    },
    resolve: {
      about: async ({ username }) => {
        incStat("resolver_runs");
        const user = await hnFetch(`/user/${username}.json`);
        return user.about ?? "";
      },
      submitted: async ({ username }) => {
        incStat("resolver_runs");
        const user = await hnFetch(`/user/${username}.json`);
        return (user.submitted ?? []).slice(0, 50).map(String);
      },
    },
  });

  server.action("get_comments", {
    description: "Get comments for a story",
    input: {
      story_id:  { type: "string", required: true },
      limit:     { type: "int", default: 20 },
      max_depth: { type: "int", default: 3 },
    },
    returns: "list:Comment",
    safe: true,
    handler: async ({ story_id, limit, max_depth }) => {
      const item = await hnFetch(`/item/${story_id}.json`);
      if (!item) throw new Error(`Story ${story_id} not found`);

      const kidIds = (item.kids ?? []).slice(0, (limit as number) ?? 20);
      return fetchComments(kidIds, 0, (max_depth as number) ?? 3);
    },
  });

  return server;
}

// Run standalone
if (import.meta.main) {
  const port = parseInt(process.env.TQP_PORT ?? "3010", 10);
  const server = createHNServer();
  server.listen({ transport: "http", port });
}
