/**
 * Integration tests for the Dispatch Worker → User Worker pipeline.
 *
 * These tests use Miniflare v3 to create real in-memory D1 and KV instances,
 * then wire them together via a mock DISPATCHER that simulates the
 * Workers for Platforms binding-injection mechanism.
 *
 * Tasks covered:
 *   9.1 – End-to-end flow: Dispatch Worker → User Worker
 *   9.2 – Cross-tenant data isolation (Property 8)
 *   9.3 – Custom domain routing (no X-Tenant-ID header)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Miniflare } from "miniflare";
import dispatchWorker from "./index";
import userWorker from "../../user-worker/src/index";
import type { TenantMeta } from "../../shared/src/types";
import type { DispatchEnv } from "./types";

// ---------------------------------------------------------------------------
// Schema SQL statements (mirrors packages/user-worker/schema.sql)
// Miniflare's exec() only supports one statement at a time, so we use batch().
// ---------------------------------------------------------------------------
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS todos (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'completed')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status)`,
  `CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos(created_at DESC)`,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal TenantMeta object for seeding PLATFORM_KV. */
function makeTenantMeta(tenantId: string, apiKey: string): TenantMeta {
  return {
    tenantId,
    d1DatabaseId: `db-${tenantId}`,
    kvNamespaceId: `kv-${tenantId}`,
    apiKey,
    createdAt: new Date().toISOString(),
    status: "active",
    customDomains: [],
  };
}

/** Build a Request with optional headers. */
function makeRequest(
  url: string,
  options: RequestInit & { token?: string; tenantId?: string } = {}
): Request {
  const { token, tenantId, ...init } = options;
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (tenantId) headers.set("X-Tenant-ID", tenantId);
  return new Request(url, { ...init, headers });
}

// ---------------------------------------------------------------------------
// Test fixture setup
// ---------------------------------------------------------------------------

interface TenantFixture {
  tenantId: string;
  apiKey: string;
  db: D1Database;
  kv: KVNamespace;
}

interface TestContext {
  mf: Miniflare;
  platformKv: KVNamespace;
  tenants: Map<string, TenantFixture>;
  /** Build a DispatchEnv with a mock DISPATCHER backed by real Miniflare instances. */
  buildEnv(): DispatchEnv;
}

async function setupTestContext(
  tenantIds: string[],
  apiKeys: string[]
): Promise<TestContext> {
  // Allocate one D1 and one KV binding per tenant, plus PLATFORM_KV
  const d1Names = tenantIds.map((id) => `DB_${id.toUpperCase().replace(/-/g, "_")}`);
  const kvNames = [
    ...tenantIds.map((id) => `KV_${id.toUpperCase().replace(/-/g, "_")}`),
    "PLATFORM_KV",
  ];

  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch: () => new Response('ok') }",
    d1Databases: d1Names,
    kvNamespaces: kvNames,
  });

  const platformKv = await mf.getKVNamespace("PLATFORM_KV");
  const tenants = new Map<string, TenantFixture>();

  for (let i = 0; i < tenantIds.length; i++) {
    const tenantId = tenantIds[i];
    const apiKey = apiKeys[i];
    const dbName = d1Names[i];
    const kvName = `KV_${tenantId.toUpperCase().replace(/-/g, "_")}`;

    const db = await mf.getD1Database(dbName);
    const kv = await mf.getKVNamespace(kvName);

    // Initialise the schema — exec() only handles one statement at a time in Miniflare
    await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));

    // Seed the tenant's KV with its API key
    await kv.put(`apikey:${apiKey}`, "valid");

    // Seed PLATFORM_KV with the tenant metadata
    const meta = makeTenantMeta(tenantId, apiKey);
    await platformKv.put(`tenant:${tenantId}`, JSON.stringify(meta));

    tenants.set(tenantId, { tenantId, apiKey, db, kv });
  }

  function buildEnv(): DispatchEnv {
    // Mock DISPATCHER: ignores the `bindings` parameter and instead looks up
    // the real Miniflare D1/KV instances from the local map.
    const mockDispatcher = {
      get(tenantId: string, _options: unknown) {
        return {
          fetch(request: Request) {
            const resources = tenants.get(tenantId);
            if (!resources) {
              throw new Error(`Worker not found: ${tenantId}`);
            }
            return userWorker.fetch(request, {
              DB: resources.db,
              KV: resources.kv,
            });
          },
        };
      },
    } as unknown as DispatchNamespace;

    return {
      DISPATCHER: mockDispatcher,
      PLATFORM_KV: platformKv,
    };
  }

  return { mf, platformKv, tenants, buildEnv };
}

// ---------------------------------------------------------------------------
// 9.1 – End-to-end integration: Dispatch Worker → User Worker
// Requirements: 2.1, 2.2, 2.6, 3.1, 3.2
// ---------------------------------------------------------------------------
describe("9.1 End-to-end: Dispatch Worker → User Worker", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestContext(["tenant-a"], ["secret-key-a"]);
  });

  afterEach(async () => {
    await ctx.mf.dispose();
  });

  it("returns 400 when X-Tenant-ID header is missing and no domain mapping exists (Req 2.1)", async () => {
    const env = ctx.buildEnv();
    const req = makeRequest("https://example.com/todos");
    const res = await dispatchWorker.fetch(req, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/X-Tenant-ID/i);
  });

  it("returns 404 when tenant does not exist in PLATFORM_KV (Req 2.2)", async () => {
    const env = ctx.buildEnv();
    const req = makeRequest("https://example.com/todos", {
      tenantId: "nonexistent-tenant",
    });
    const res = await dispatchWorker.fetch(req, env);
    expect(res.status).toBe(404);
  });

  it("returns 401 when API key is invalid (Req 3.1, 3.2)", async () => {
    const env = ctx.buildEnv();
    const req = makeRequest("https://example.com/todos", {
      tenantId: "tenant-a",
      token: "wrong-key",
    });
    const res = await dispatchWorker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("creates a todo via POST /todos and retrieves it via GET /todos (Req 2.6)", async () => {
    const env = ctx.buildEnv();

    // Create a todo
    const createReq = makeRequest("https://example.com/todos", {
      method: "POST",
      tenantId: "tenant-a",
      token: "secret-key-a",
      body: JSON.stringify({ title: "Integration test todo", description: "E2E" }),
      headers: { "Content-Type": "application/json" },
    });
    const createRes = await dispatchWorker.fetch(createReq, env);
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { id: string; title: string; status: string };
    expect(created.title).toBe("Integration test todo");
    expect(created.status).toBe("pending");

    // List todos
    const listReq = makeRequest("https://example.com/todos", {
      tenantId: "tenant-a",
      token: "secret-key-a",
    });
    const listRes = await dispatchWorker.fetch(listReq, env);
    expect(listRes.status).toBe(200);
    const todos = await listRes.json() as { id: string }[];
    expect(todos.some((t) => t.id === created.id)).toBe(true);
  });

  it("completes the full CRUD lifecycle through the dispatch layer", async () => {
    const env = ctx.buildEnv();
    const headers = { "Content-Type": "application/json" };
    const base = { tenantId: "tenant-a", token: "secret-key-a" };

    // Create
    const createRes = await dispatchWorker.fetch(
      makeRequest("https://example.com/todos", {
        method: "POST",
        ...base,
        body: JSON.stringify({ title: "Lifecycle todo" }),
        headers,
      }),
      env
    );
    expect(createRes.status).toBe(201);
    const todo = await createRes.json() as { id: string; title: string; status: string };

    // Read
    const getRes = await dispatchWorker.fetch(
      makeRequest(`https://example.com/todos/${todo.id}`, base),
      env
    );
    expect(getRes.status).toBe(200);

    // Update
    const patchRes = await dispatchWorker.fetch(
      makeRequest(`https://example.com/todos/${todo.id}`, {
        method: "PATCH",
        ...base,
        body: JSON.stringify({ status: "completed" }),
        headers,
      }),
      env
    );
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json() as { status: string };
    expect(updated.status).toBe("completed");

    // Delete
    const deleteRes = await dispatchWorker.fetch(
      makeRequest(`https://example.com/todos/${todo.id}`, {
        method: "DELETE",
        ...base,
      }),
      env
    );
    expect(deleteRes.status).toBe(204);

    // Confirm gone
    const afterDeleteRes = await dispatchWorker.fetch(
      makeRequest(`https://example.com/todos/${todo.id}`, base),
      env
    );
    expect(afterDeleteRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 9.2 – Cross-tenant data isolation (Property 8)
// Requirements: 5.5, 7.4, 9.1, 9.2, 9.3
// ---------------------------------------------------------------------------
describe("9.2 Cross-tenant data isolation", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestContext(
      ["tenant-a", "tenant-b"],
      ["key-for-a", "key-for-b"]
    );
  });

  afterEach(async () => {
    await ctx.mf.dispose();
  });

  it("Tenant B cannot read Tenant A's todos (Property 8, Req 5.5)", async () => {
    const env = ctx.buildEnv();

    // Tenant A creates a todo
    const createRes = await dispatchWorker.fetch(
      makeRequest("https://example.com/todos", {
        method: "POST",
        tenantId: "tenant-a",
        token: "key-for-a",
        body: JSON.stringify({ title: "Tenant A secret" }),
        headers: { "Content-Type": "application/json" },
      }),
      env
    );
    expect(createRes.status).toBe(201);
    const tenantATodo = await createRes.json() as { id: string };

    // Tenant B lists todos — should see an empty list
    const listRes = await dispatchWorker.fetch(
      makeRequest("https://example.com/todos", {
        tenantId: "tenant-b",
        token: "key-for-b",
      }),
      env
    );
    expect(listRes.status).toBe(200);
    const tenantBTodos = await listRes.json() as { id: string }[];
    expect(tenantBTodos.some((t) => t.id === tenantATodo.id)).toBe(false);
    expect(tenantBTodos.length).toBe(0);
  });

  it("Tenant B cannot fetch Tenant A's todo by ID (Property 8, Req 5.5)", async () => {
    const env = ctx.buildEnv();

    // Tenant A creates a todo
    const createRes = await dispatchWorker.fetch(
      makeRequest("https://example.com/todos", {
        method: "POST",
        tenantId: "tenant-a",
        token: "key-for-a",
        body: JSON.stringify({ title: "Private todo" }),
        headers: { "Content-Type": "application/json" },
      }),
      env
    );
    const tenantATodo = await createRes.json() as { id: string };

    // Tenant B tries to GET the same ID — should get 404 (not found in B's DB)
    const getRes = await dispatchWorker.fetch(
      makeRequest(`https://example.com/todos/${tenantATodo.id}`, {
        tenantId: "tenant-b",
        token: "key-for-b",
      }),
      env
    );
    expect(getRes.status).toBe(404);
  });

  it("Tenant B cannot modify Tenant A's todo (Property 8, Req 7.4)", async () => {
    const env = ctx.buildEnv();

    // Tenant A creates a todo
    const createRes = await dispatchWorker.fetch(
      makeRequest("https://example.com/todos", {
        method: "POST",
        tenantId: "tenant-a",
        token: "key-for-a",
        body: JSON.stringify({ title: "Immutable todo" }),
        headers: { "Content-Type": "application/json" },
      }),
      env
    );
    const tenantATodo = await createRes.json() as { id: string };

    // Tenant B tries to PATCH the same ID
    const patchRes = await dispatchWorker.fetch(
      makeRequest(`https://example.com/todos/${tenantATodo.id}`, {
        method: "PATCH",
        tenantId: "tenant-b",
        token: "key-for-b",
        body: JSON.stringify({ title: "Hacked!" }),
        headers: { "Content-Type": "application/json" },
      }),
      env
    );
    expect(patchRes.status).toBe(404);

    // Verify Tenant A's todo is unchanged
    const getRes = await dispatchWorker.fetch(
      makeRequest(`https://example.com/todos/${tenantATodo.id}`, {
        tenantId: "tenant-a",
        token: "key-for-a",
      }),
      env
    );
    expect(getRes.status).toBe(200);
    const original = await getRes.json() as { title: string };
    expect(original.title).toBe("Immutable todo");
  });

  it("Tenant B cannot delete Tenant A's todo (Property 8, Req 7.4)", async () => {
    const env = ctx.buildEnv();

    // Tenant A creates a todo
    const createRes = await dispatchWorker.fetch(
      makeRequest("https://example.com/todos", {
        method: "POST",
        tenantId: "tenant-a",
        token: "key-for-a",
        body: JSON.stringify({ title: "Persistent todo" }),
        headers: { "Content-Type": "application/json" },
      }),
      env
    );
    const tenantATodo = await createRes.json() as { id: string };

    // Tenant B tries to DELETE the same ID
    const deleteRes = await dispatchWorker.fetch(
      makeRequest(`https://example.com/todos/${tenantATodo.id}`, {
        method: "DELETE",
        tenantId: "tenant-b",
        token: "key-for-b",
      }),
      env
    );
    expect(deleteRes.status).toBe(404);

    // Verify Tenant A's todo still exists
    const getRes = await dispatchWorker.fetch(
      makeRequest(`https://example.com/todos/${tenantATodo.id}`, {
        tenantId: "tenant-a",
        token: "key-for-a",
      }),
      env
    );
    expect(getRes.status).toBe(200);
  });

  it("each tenant's API key only works for their own tenant (Req 9.1, 9.2)", async () => {
    const env = ctx.buildEnv();

    // Tenant A's key should be rejected when used against Tenant B's worker
    const res = await dispatchWorker.fetch(
      makeRequest("https://example.com/todos", {
        tenantId: "tenant-b",
        token: "key-for-a", // wrong key for tenant-b
      }),
      env
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 9.3 – Custom domain routing (no X-Tenant-ID header)
// Requirements: 2.5, 8.2
// ---------------------------------------------------------------------------
describe("9.3 Custom domain routing", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestContext(["tenant-a"], ["domain-key-a"]);
  });

  afterEach(async () => {
    await ctx.mf.dispose();
  });

  it("routes to the correct tenant via custom domain without X-Tenant-ID (Req 2.5, 8.2)", async () => {
    const env = ctx.buildEnv();

    // Register the custom domain mapping in PLATFORM_KV
    await ctx.platformKv.put("domain:custom.example.com", "tenant-a");

    // Make a request using the custom domain hostname, no X-Tenant-ID header
    const req = makeRequest("https://custom.example.com/todos", {
      token: "domain-key-a",
      // intentionally no tenantId
    });
    const res = await dispatchWorker.fetch(req, env);
    expect(res.status).toBe(200);
    const todos = await res.json() as unknown[];
    expect(Array.isArray(todos)).toBe(true);
  });

  it("creates a todo via custom domain and retrieves it (Req 2.5, 8.2)", async () => {
    const env = ctx.buildEnv();
    await ctx.platformKv.put("domain:custom.example.com", "tenant-a");

    // Create via custom domain
    const createRes = await dispatchWorker.fetch(
      makeRequest("https://custom.example.com/todos", {
        method: "POST",
        token: "domain-key-a",
        body: JSON.stringify({ title: "Domain routed todo" }),
        headers: { "Content-Type": "application/json" },
      }),
      env
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { id: string; title: string };
    expect(created.title).toBe("Domain routed todo");

    // Retrieve via custom domain
    const getRes = await dispatchWorker.fetch(
      makeRequest(`https://custom.example.com/todos/${created.id}`, {
        token: "domain-key-a",
      }),
      env
    );
    expect(getRes.status).toBe(200);
  });

  it("returns 400 when domain has no mapping and no X-Tenant-ID (Req 2.5)", async () => {
    const env = ctx.buildEnv();
    // No domain mapping registered for this hostname

    const req = makeRequest("https://unknown.example.com/todos", {
      token: "domain-key-a",
    });
    const res = await dispatchWorker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it("X-Tenant-ID header takes precedence over domain mapping (Req 2.5)", async () => {
    const env = ctx.buildEnv();
    await ctx.platformKv.put("domain:custom.example.com", "tenant-a");

    // Request with both custom domain AND X-Tenant-ID pointing to a nonexistent tenant
    const req = makeRequest("https://custom.example.com/todos", {
      tenantId: "nonexistent-tenant",
      token: "domain-key-a",
    });
    const res = await dispatchWorker.fetch(req, env);
    // Should use X-Tenant-ID (nonexistent-tenant) → 404, not the domain mapping
    expect(res.status).toBe(404);
  });
});
