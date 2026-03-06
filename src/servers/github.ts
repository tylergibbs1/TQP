// TQP Reference Server: GitHub
// Exposes GitHub API operations as a TQP server.
// Requires GITHUB_TOKEN environment variable.

import { TQP } from "../server";

const GITHUB_API = "https://api.github.com";

function githubFetch(path: string): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "tqp-github-server",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${GITHUB_API}${path}`, { headers });
}

export function createGitHubServer(): TQP {
  const server = new TQP({
    name: "github",
    description: "GitHub repository and issue management",
  });

  server.type("User", {
    id:     { type: "string" },
    login:  { type: "string" },
    name:   { type: "string" },
    avatar: { type: "string" },
  });

  server.type("Comment", {
    id:         { type: "string" },
    body:       { type: "string" },
    author:     { type: "User" },
    created_at: { type: "string" },
  });

  server.type("Issue", {
    id:       { type: "string" },
    number:   { type: "int" },
    title:    { type: "string" },
    body:     { type: "string", cost: "high" },
    state:    { type: "string", enum: ["open", "closed"] },
    labels:   { type: "list:string" },
    author:   { type: "User" },
    comments: { type: "list:Comment", cost: "high" },
  });

  server.type("Repo", {
    id:          { type: "string" },
    name:        { type: "string" },
    full_name:   { type: "string" },
    description: { type: "string" },
    stars:       { type: "int" },
    language:    { type: "string" },
    owner:       { type: "User" },
    issues:      { type: "list:Issue", cost: "high" },
    readme:      { type: "string", cost: "high" },
  });

  server.action("get_repo", {
    description: "Get a repository by owner and name",
    input: {
      owner: { type: "string", required: true },
      name:  { type: "string", required: true },
    },
    returns: "Repo",
    safe: true,
    handler: async ({ owner, name }) => {
      const res = await githubFetch(`/repos/${owner}/${name}`);
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      const repo = (await res.json()) as any;
      return {
        id: String(repo.id),
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description ?? "",
        stars: repo.stargazers_count,
        language: repo.language ?? "",
        owner: {
          id: String(repo.owner.id),
          login: repo.owner.login,
          name: repo.owner.login,
          avatar: repo.owner.avatar_url,
        },
        issues: [],
        readme: "",
      };
    },
    resolve: {
      readme: async ({ owner, name }) => {
        try {
          const res = await githubFetch(`/repos/${owner}/${name}/readme`);
          if (!res.ok) return "";
          const data = (await res.json()) as any;
          return Buffer.from(data.content, "base64").toString();
        } catch {
          return "";
        }
      },
      issues: async ({ owner, name }) => {
        const res = await githubFetch(`/repos/${owner}/${name}/issues?state=open&per_page=10`);
        if (!res.ok) return [];
        const issues = (await res.json()) as any[];
        return issues.map((i: any) => ({
          id: String(i.id),
          number: i.number,
          title: i.title,
          body: i.body ?? "",
          state: i.state,
          labels: i.labels.map((l: any) => l.name),
          author: {
            id: String(i.user.id),
            login: i.user.login,
            name: i.user.login,
            avatar: i.user.avatar_url,
          },
          comments: [],
        }));
      },
    },
  });

  server.action("list_issues", {
    description: "List issues for a repository",
    input: {
      owner: { type: "string", required: true },
      name:  { type: "string", required: true },
      state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
      limit: { type: "int", default: 30 },
    },
    returns: "list:Issue",
    safe: true,
    handler: async ({ owner, name, state, limit }) => {
      const perPage = Math.min((limit as number) ?? 30, 100);
      const res = await githubFetch(
        `/repos/${owner}/${name}/issues?state=${state ?? "open"}&per_page=${perPage}`
      );
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      const issues = (await res.json()) as any[];

      return issues
        .filter((i: any) => !i.pull_request) // Exclude PRs
        .map((i: any) => ({
          id: String(i.id),
          number: i.number,
          title: i.title,
          body: i.body ?? "",
          state: i.state,
          labels: i.labels.map((l: any) => l.name),
          author: {
            id: String(i.user.id),
            login: i.user.login,
            name: i.user.login,
            avatar: i.user.avatar_url,
          },
          comments: [],
        }));
    },
  });

  server.action("create_issue", {
    description: "Create a new issue",
    input: {
      owner:  { type: "string", required: true },
      name:   { type: "string", required: true },
      title:  { type: "string", required: true },
      body:   { type: "string" },
      labels: { type: "list:string" },
    },
    returns: "Issue",
    safe: false,
    dry_run: true,
    handler: async ({ owner, name, title, body, labels }, ctx) => {
      if (ctx.dry_run) {
        return {
          id: "dry_run",
          number: 0,
          title: title as string,
          body: (body as string) ?? "",
          state: "open",
          labels: (labels as string[]) ?? [],
          author: { id: "0", login: "you", name: "you", avatar: "" },
          comments: [],
        };
      }

      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN required for mutations");

      const res = await fetch(`${GITHUB_API}/repos/${owner}/${name}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "tqp-github-server",
        },
        body: JSON.stringify({ title, body, labels }),
      });

      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      const issue = (await res.json()) as any;

      return {
        id: String(issue.id),
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        state: issue.state,
        labels: issue.labels.map((l: any) => l.name),
        author: {
          id: String(issue.user.id),
          login: issue.user.login,
          name: issue.user.login,
          avatar: issue.user.avatar_url,
        },
        comments: [],
      };
    },
  });

  server.action("close_issue", {
    description: "Close an existing issue",
    input: {
      owner:        { type: "string", required: true },
      name:         { type: "string", required: true },
      issue_number: { type: "int", required: true },
    },
    returns: "Issue",
    safe: false,
    confirm: true,
    handler: async ({ owner, name, issue_number }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN required for mutations");

      const res = await fetch(
        `${GITHUB_API}/repos/${owner}/${name}/issues/${issue_number}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": "tqp-github-server",
          },
          body: JSON.stringify({ state: "closed" }),
        }
      );

      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      const issue = (await res.json()) as any;

      return {
        id: String(issue.id),
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        state: issue.state,
        labels: issue.labels.map((l: any) => l.name),
        author: {
          id: String(issue.user.id),
          login: issue.user.login,
          name: issue.user.login,
          avatar: issue.user.avatar_url,
        },
        comments: [],
      };
    },
  });

  return server;
}

// Run standalone
if (import.meta.main) {
  const port = parseInt(process.env.TQP_PORT ?? "3000", 10);
  const server = createGitHubServer();
  server.listen({ transport: "http", port });
}
