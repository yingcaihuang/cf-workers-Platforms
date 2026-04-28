import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "./index";
import type { UserEnv } from "./types";
import type { Todo } from "../../shared/src/types";

// ---------------------------------------------------------------------------
// Minimal in-memory D1 mock
// ---------------------------------------------------------------------------
function makeD1(): D1Database {
  const rows: Record<string, Todo> = {};

  const db = {
    _rows: rows,
    prepare(sql: string) {
      return {
        _sql: sql,
        _bindings: [] as unknown[],
        bind(...args: unknown[]) {
          this._bindings = args;
          return this;
        },
        async run() {
          const sql = this._sql.trim().toUpperCase();
          const b = this._bindings;
          if (sql.startsWith("INSERT INTO TODOS")) {
            const [id, title, description, status, created_at, updated_at] = b as string[];
            rows[id] = { id, title, description, status: status as Todo["status"], created_at, updated_at };
          } else if (sql.startsWith("UPDATE TODOS SET")) {
            const [title, description, status, updated_at, id] = b as string[];
            if (rows[id]) {
              rows[id] = { ...rows[id], title, description, status: status as Todo["status"], updated_at };
            }
          } else if (sql.startsWith("DELETE FROM TODOS")) {
            const [id] = b as string[];
            delete rows[id];
          }
          return { success: true, results: [], meta: {} };
        },
        async first<T>(): Promise<T | null> {
          const sql = this._sql.trim().toUpperCase();
          const b = this._bindings;
          if (sql.includes("WHERE ID = ?")) {
            const [id] = b as string[];
            return (rows[id] ?? null) as T | null;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          const sql = this._sql.trim().toUpperCase();
          const b = this._bindings;
          let list = Object.values(rows) as unknown as T[];
          if (sql.includes("WHERE STATUS = ?")) {
            const [status] = b as string[];
            list = list.filter((r) => (r as unknown as Todo).status === status);
          }
          // Sort by created_at DESC
          list.sort((a, b) => {
            const ta = (a as unknown as Todo).created_at;
            const tb = (b as unknown as Todo).created_at;
            return tb.localeCompare(ta);
          });
          return { results: list };
        },
      };
    },
  } as unknown as D1Database;

  return db;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeEnv(kvData: Record<string, string> = {}, db?: D1Database): UserEnv {
  return {
    DB: db ?? makeD1(),
    KV: {
      get: vi.fn(async (key: string) => kvData[key] ?? null),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace,
  };
}

const VALID_TOKEN = "valid-token";
const KV_DATA = { [`apikey:${VALID_TOKEN}`]: "valid" };

function makeRequest(
  path: string,
  options: RequestInit & { token?: string } = {}
): Request {
  const { token, ...init } = options;
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
  return new Request(`https://example.com${path}`, { ...init, headers });
}

async function authedRequest(
  path: string,
  options: RequestInit = {}
): Promise<{ req: Request; env: UserEnv }> {
  const db = makeD1();
  const env = makeEnv(KV_DATA, db);
  const req = makeRequest(path, { ...options, token: VALID_TOKEN });
  return { req, env };
}

// ---------------------------------------------------------------------------
// Authentication middleware (Req 3.1–3.4)
// ---------------------------------------------------------------------------
describe("authenticate middleware", () => {
  it("returns 401 when Authorization header is missing (Req 3.3)", async () => {
    const env = makeEnv();
    const req = new Request("https://example.com/todos");
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header has wrong format (Req 3.3)", async () => {
    const env = makeEnv();
    const req = new Request("https://example.com/todos", {
      headers: { Authorization: "Basic sometoken" },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is 'Bearer ' with no token (Req 3.3)", async () => {
    const env = makeEnv();
    const req = new Request("https://example.com/todos", {
      headers: { Authorization: "Bearer " },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is not in KV (Req 3.4)", async () => {
    const env = makeEnv({});
    const req = makeRequest("/todos", { token: "invalid-token" });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("passes authentication when token is valid (Req 3.1, 3.2)", async () => {
    const env = makeEnv(KV_DATA);
    const req = makeRequest("/todos", { token: VALID_TOKEN });
    const res = await worker.fetch(req, env);
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Routing framework
// ---------------------------------------------------------------------------
describe("routing framework", () => {
  it("returns 404 for unmatched routes", async () => {
    const { req, env } = await authedRequest("/unknown");
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });

  it("returns 404 for /todos/id/extra path segments", async () => {
    const { req, env } = await authedRequest("/todos/some-id/extra");
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /todos — Create Todo (Req 4.1–4.8)
// ---------------------------------------------------------------------------
describe("POST /todos", () => {
  it("creates a todo and returns 201 with full object (Req 4.1–4.5)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const req = makeRequest("/todos", {
      method: "POST",
      token: VALID_TOKEN,
      body: JSON.stringify({ title: "Buy milk", description: "2 litres" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(201);
    const todo = await res.json() as Todo;
    expect(todo.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(todo.title).toBe("Buy milk");
    expect(todo.description).toBe("2 litres");
    expect(todo.status).toBe("pending");
    expect(todo.created_at).toBeTruthy();
    expect(todo.updated_at).toBe(todo.created_at);
  });

  it("defaults description to empty string when not provided (Req 4.8)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const req = makeRequest("/todos", {
      method: "POST",
      token: VALID_TOKEN,
      body: JSON.stringify({ title: "No desc" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(201);
    const todo = await res.json() as Todo;
    expect(todo.description).toBe("");
  });

  it("returns 400 when title is missing (Req 4.6)", async () => {
    const { req, env } = await authedRequest("/todos");
    const r = makeRequest("/todos", {
      method: "POST",
      token: VALID_TOKEN,
      body: JSON.stringify({ description: "no title" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(r, env);
    expect(res.status).toBe(400);
  });

  it("returns 400 when title is blank whitespace (Req 4.6)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const req = makeRequest("/todos", {
      method: "POST",
      token: VALID_TOKEN,
      body: JSON.stringify({ title: "   " }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 400 when title exceeds 255 characters (Req 4.7)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const req = makeRequest("/todos", {
      method: "POST",
      token: VALID_TOKEN,
      body: JSON.stringify({ title: "a".repeat(256) }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /todos — List Todos (Req 5.1, 5.2)
// ---------------------------------------------------------------------------
describe("GET /todos", () => {
  async function seedTodos(env: UserEnv): Promise<Todo[]> {
    const todos: Todo[] = [];
    for (const [title, status] of [
      ["Task A", "pending"],
      ["Task B", "completed"],
      ["Task C", "pending"],
    ] as [string, string][]) {
      const req = makeRequest("/todos", {
        method: "POST",
        token: VALID_TOKEN,
        body: JSON.stringify({ title, status }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await worker.fetch(req, env);
      todos.push(await res.json() as Todo);
    }
    return todos;
  }

  it("returns all todos ordered by created_at DESC (Req 5.1)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    await seedTodos(env);
    const req = makeRequest("/todos", { token: VALID_TOKEN });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const list = await res.json() as Todo[];
    expect(list.length).toBe(3);
  });

  it("filters by status=pending (Req 5.2)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    await seedTodos(env);
    const req = makeRequest("/todos?status=pending", { token: VALID_TOKEN });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const list = await res.json() as Todo[];
    expect(list.every((t) => t.status === "pending")).toBe(true);
  });

  it("filters by status=completed (Req 5.2)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    await seedTodos(env);
    const req = makeRequest("/todos?status=completed", { token: VALID_TOKEN });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const list = await res.json() as Todo[];
    expect(list.every((t) => t.status === "completed")).toBe(true);
  });

  it("returns 400 for invalid status filter", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const req = makeRequest("/todos?status=invalid", { token: VALID_TOKEN });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it("returns empty array when no todos exist", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const req = makeRequest("/todos", { token: VALID_TOKEN });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /todos/:id — Get single Todo (Req 5.3–5.5)
// ---------------------------------------------------------------------------
describe("GET /todos/:id", () => {
  it("returns the todo when it exists (Req 5.3)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const createReq = makeRequest("/todos", {
      method: "POST",
      token: VALID_TOKEN,
      body: JSON.stringify({ title: "Find me" }),
      headers: { "Content-Type": "application/json" },
    });
    const createRes = await worker.fetch(createReq, env);
    const created = await createRes.json() as Todo;

    const getReq = makeRequest(`/todos/${created.id}`, { token: VALID_TOKEN });
    const getRes = await worker.fetch(getReq, env);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual(created);
  });

  it("returns 404 when todo does not exist (Req 5.4)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const req = makeRequest("/todos/nonexistent-id", { token: VALID_TOKEN });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /todos/:id — Update Todo (Req 6.1–6.8)
// ---------------------------------------------------------------------------
describe("PATCH /todos/:id", () => {
  async function createTodo(env: UserEnv, title = "Original"): Promise<Todo> {
    const req = makeRequest("/todos", {
      method: "POST",
      token: VALID_TOKEN,
      body: JSON.stringify({ title }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    return res.json() as Promise<Todo>;
  }

  it("updates title and returns 200 with updated todo (Req 6.1, 6.4)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const todo = await createTodo(env);
    const req = makeRequest(`/todos/${todo.id}`, {
      method: "PATCH",
      token: VALID_TOKEN,
      body: JSON.stringify({ title: "Updated" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const updated = await res.json() as Todo;
    expect(updated.title).toBe("Updated");
    expect(updated.status).toBe("pending"); // unchanged
  });

  it("updates status to completed (Req 6.2)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const todo = await createTodo(env);
    const req = makeRequest(`/todos/${todo.id}`, {
      method: "PATCH",
      token: VALID_TOKEN,
      body: JSON.stringify({ status: "completed" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const updated = await res.json() as Todo;
    expect(updated.status).toBe("completed");
    expect(updated.title).toBe("Original"); // unchanged
  });

  it("updates updated_at on success (Req 6.3)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const todo = await createTodo(env);
    // Small delay to ensure updated_at differs
    await new Promise((r) => setTimeout(r, 5));
    const req = makeRequest(`/todos/${todo.id}`, {
      method: "PATCH",
      token: VALID_TOKEN,
      body: JSON.stringify({ title: "New title" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    const updated = await res.json() as Todo;
    expect(updated.updated_at >= todo.updated_at).toBe(true);
  });

  it("returns 400 for empty body (Req 6.8)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const todo = await createTodo(env);
    const req = makeRequest(`/todos/${todo.id}`, {
      method: "PATCH",
      token: VALID_TOKEN,
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid status (Req 6.5)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const todo = await createTodo(env);
    const req = makeRequest(`/todos/${todo.id}`, {
      method: "PATCH",
      token: VALID_TOKEN,
      body: JSON.stringify({ status: "invalid" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 400 when title exceeds 255 chars (Req 6.6)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const todo = await createTodo(env);
    const req = makeRequest(`/todos/${todo.id}`, {
      method: "PATCH",
      token: VALID_TOKEN,
      body: JSON.stringify({ title: "x".repeat(256) }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 404 when todo does not exist (Req 6.7)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const req = makeRequest("/todos/nonexistent", {
      method: "PATCH",
      token: VALID_TOKEN,
      body: JSON.stringify({ title: "x" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /todos/:id — Delete Todo (Req 7.1–7.4)
// ---------------------------------------------------------------------------
describe("DELETE /todos/:id", () => {
  async function createTodo(env: UserEnv): Promise<Todo> {
    const req = makeRequest("/todos", {
      method: "POST",
      token: VALID_TOKEN,
      body: JSON.stringify({ title: "To delete" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, env);
    return res.json() as Promise<Todo>;
  }

  it("deletes todo and returns 204 (Req 7.1, 7.2)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const todo = await createTodo(env);
    const req = makeRequest(`/todos/${todo.id}`, {
      method: "DELETE",
      token: VALID_TOKEN,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("returns 404 after deletion (Req 7.2, 7.3)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const todo = await createTodo(env);
    const delReq = makeRequest(`/todos/${todo.id}`, {
      method: "DELETE",
      token: VALID_TOKEN,
    });
    await worker.fetch(delReq, env);

    const getReq = makeRequest(`/todos/${todo.id}`, { token: VALID_TOKEN });
    const getRes = await worker.fetch(getReq, env);
    expect(getRes.status).toBe(404);
  });

  it("returns 404 when todo does not exist (Req 7.3)", async () => {
    const db = makeD1();
    const env = makeEnv(KV_DATA, db);
    const req = makeRequest("/todos/nonexistent", {
      method: "DELETE",
      token: VALID_TOKEN,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });
});
