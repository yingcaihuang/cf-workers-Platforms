import { validateTitle, validateStatus } from "../../shared/src/validation";
import type { Todo } from "../../shared/src/types";
import type { UserEnv } from "./types";

// Req 3.1, 3.2, 3.3, 3.4
async function authenticate(request: Request, env: UserEnv): Promise<boolean> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  const stored = await env.KV.get(`apikey:${token}`);
  return stored !== null;
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Req 4.1–4.8: POST /todos
async function handleCreateTodo(request: Request, env: UserEnv): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse("请求体必须为有效 JSON", 400);
  }

  const titleError = validateTitle(body.title);
  if (titleError) return errorResponse(titleError, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const description = typeof body.description === "string" ? body.description : "";

  const todo: Todo = {
    id,
    title: body.title as string,
    description,
    status: "pending",
    created_at: now,
    updated_at: now,
  };

  await env.DB.prepare(
    "INSERT INTO todos (id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(todo.id, todo.title, todo.description, todo.status, todo.created_at, todo.updated_at)
    .run();

  return jsonResponse(todo, 201);
}

// Req 5.1, 5.2: GET /todos
async function handleListTodos(request: Request, env: UserEnv): Promise<Response> {
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");

  let stmt: D1PreparedStatement;
  if (statusFilter !== null) {
    const statusError = validateStatus(statusFilter);
    if (statusError) return errorResponse(statusError, 400);
    stmt = env.DB.prepare(
      "SELECT * FROM todos WHERE status = ? ORDER BY created_at DESC"
    ).bind(statusFilter);
  } else {
    stmt = env.DB.prepare("SELECT * FROM todos ORDER BY created_at DESC");
  }

  const { results } = await stmt.all<Todo>();
  return jsonResponse(results ?? []);
}

// Req 5.3, 5.4, 5.5: GET /todos/:id
async function handleGetTodo(_request: Request, env: UserEnv, id: string): Promise<Response> {
  const todo = await env.DB.prepare("SELECT * FROM todos WHERE id = ?")
    .bind(id)
    .first<Todo>();

  if (!todo) return errorResponse("Todo 不存在", 404);
  return jsonResponse(todo);
}

// Req 6.1–6.8: PATCH /todos/:id
async function handleUpdateTodo(request: Request, env: UserEnv, id: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse("请求体必须为有效 JSON", 400);
  }

  const { title, description, status } = body;
  const hasTitle = "title" in body;
  const hasDescription = "description" in body;
  const hasStatus = "status" in body;

  if (!hasTitle && !hasDescription && !hasStatus) {
    return errorResponse("请求体不包含任何可更新字段", 400);
  }

  if (hasTitle) {
    const titleError = validateTitle(title);
    if (titleError) return errorResponse(titleError, 400);
  }

  if (hasStatus) {
    const statusError = validateStatus(status);
    if (statusError) return errorResponse(statusError, 400);
  }

  // Check existence
  const existing = await env.DB.prepare("SELECT * FROM todos WHERE id = ?")
    .bind(id)
    .first<Todo>();
  if (!existing) return errorResponse("Todo 不存在", 404);

  const now = new Date().toISOString();
  const newTitle = hasTitle ? (title as string) : existing.title;
  const newDescription = hasDescription ? (description as string) : existing.description;
  const newStatus = hasStatus ? (status as "pending" | "completed") : existing.status;

  await env.DB.prepare(
    "UPDATE todos SET title = ?, description = ?, status = ?, updated_at = ? WHERE id = ?"
  )
    .bind(newTitle, newDescription, newStatus, now, id)
    .run();

  const updated: Todo = {
    ...existing,
    title: newTitle,
    description: newDescription,
    status: newStatus,
    updated_at: now,
  };

  return jsonResponse(updated);
}

// Req 7.1–7.4: DELETE /todos/:id
async function handleDeleteTodo(_request: Request, env: UserEnv, id: string): Promise<Response> {
  const existing = await env.DB.prepare("SELECT id FROM todos WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return errorResponse("Todo 不存在", 404);

  await env.DB.prepare("DELETE FROM todos WHERE id = ?").bind(id).run();
  return new Response(null, { status: 204 });
}

export default {
  async fetch(request: Request, env: UserEnv): Promise<Response> {
    // Authenticate every request (Req 3.3, 3.4)
    const isAuthenticated = await authenticate(request, env);
    if (!isAuthenticated) {
      return errorResponse("Unauthorized", 401);
    }

    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    // Route: /todos
    if (path === "/todos") {
      if (method === "GET") return handleListTodos(request, env);   // Req 5.1
      if (method === "POST") return handleCreateTodo(request, env); // Req 4.1
    }

    // Route: /todos/:id
    const todoMatch = path.match(/^\/todos\/([^/]+)$/);
    if (todoMatch) {
      const id = todoMatch[1];
      if (method === "GET") return handleGetTodo(request, env, id);       // Req 5.3
      if (method === "PATCH") return handleUpdateTodo(request, env, id);  // Req 6.1
      if (method === "DELETE") return handleDeleteTodo(request, env, id); // Req 7.1
    }

    return errorResponse("Not found", 404);
  },
};
