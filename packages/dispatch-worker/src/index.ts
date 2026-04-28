import type { DispatchEnv } from "./types";
import type { TenantMeta } from "@todo-platform/shared";

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTenantAppHtml(tenantId: string): string {
  const safeTenantId = escapeHtml(tenantId);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Todo Console · ${safeTenantId}</title>
    <style>
      :root {
        --bg-1: #f8fbff;
        --bg-2: #e9f2ff;
        --card: #ffffffcc;
        --text: #13233a;
        --muted: #4d6280;
        --primary: #005fcc;
        --primary-2: #0d74ff;
        --ok: #0f9d58;
        --line: #d7e4f5;
        --danger: #d93025;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
        color: var(--text);
        background: radial-gradient(circle at 0% 0%, #d9e9ff 0%, transparent 40%),
          radial-gradient(circle at 100% 0%, #f8dcc4 0%, transparent 35%),
          linear-gradient(160deg, var(--bg-1), var(--bg-2));
      }
      .page {
        max-width: 900px;
        margin: 0 auto;
        padding: 28px 18px 64px;
      }
      .card {
        background: var(--card);
        backdrop-filter: blur(6px);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 18px;
        box-shadow: 0 12px 28px rgba(19, 35, 58, 0.08);
      }
      h1 {
        margin: 0 0 8px;
        font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
        letter-spacing: 0.2px;
      }
      .sub { color: var(--muted); margin: 0 0 16px; }
      .grid { display: grid; gap: 14px; }
      @media (min-width: 860px) {
        .grid { grid-template-columns: 1fr 2fr; }
      }
      label { font-size: 13px; color: var(--muted); display: block; margin-bottom: 6px; }
      input, textarea {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px 12px;
        font: inherit;
        background: #fff;
      }
      textarea { min-height: 84px; resize: vertical; }
      button {
        border: 0;
        border-radius: 10px;
        padding: 10px 14px;
        font: inherit;
        font-weight: 600;
        background: linear-gradient(135deg, var(--primary), var(--primary-2));
        color: #fff;
        cursor: pointer;
      }
      .ghost {
        background: #fff;
        color: var(--primary);
        border: 1px solid #b8d4ff;
      }
      .row { display: flex; gap: 10px; align-items: center; }
      .row > * { flex: 1; }
      .row button { flex: initial; }
      .meta {
        margin: 12px 0 0;
        font-size: 13px;
        color: var(--muted);
      }
      .meta code {
        padding: 2px 6px;
        background: #edf4ff;
        border-radius: 6px;
      }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
      .todo {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 10px;
        align-items: start;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px;
        background: #fff;
      }
      .todo.done .title { text-decoration: line-through; color: var(--muted); }
      .title { font-weight: 600; }
      .desc { color: var(--muted); font-size: 14px; white-space: pre-wrap; }
      .pill {
        border-radius: 999px;
        font-size: 12px;
        padding: 4px 10px;
        border: 1px solid #cde3ff;
        color: var(--primary);
        background: #f1f7ff;
      }
      .pill.done {
        color: var(--ok);
        border-color: #b9e5cf;
        background: #ebfbf2;
      }
      .error { color: var(--danger); font-size: 13px; margin-top: 8px; min-height: 18px; }
      .empty { color: var(--muted); text-align: center; padding: 28px 0; }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="card">
        <h1>Tenant Todo Console</h1>
        <p class="sub">为租户 <code>${safeTenantId}</code> 提供创建、展示与完成任务操作。</p>
        <div class="grid">
          <form id="create-form" class="card" style="padding:14px;">
            <label for="apiKey">API Key</label>
            <div class="row">
              <input id="apiKey" placeholder="输入 Bearer API Key" required />
              <button type="button" class="ghost" id="saveKey">保存</button>
            </div>
            <label for="title" style="margin-top:10px;">标题</label>
            <input id="title" placeholder="例如：发布周报" required />
            <label for="description" style="margin-top:10px;">描述</label>
            <textarea id="description" placeholder="可选"></textarea>
            <div class="row" style="margin-top:12px;">
              <button type="submit">新增任务</button>
              <button type="button" class="ghost" id="refresh">刷新列表</button>
            </div>
            <p class="meta">请求会自动带上 <code>X-Tenant-ID: ${safeTenantId}</code></p>
            <p id="error" class="error"></p>
          </form>

          <section class="card" style="padding:14px;">
            <div class="row" style="margin-bottom:8px;">
              <strong>Todo 列表</strong>
              <span id="count" class="pill">0 项</span>
            </div>
            <ul id="list"></ul>
            <div id="empty" class="empty" hidden>暂无任务，先创建一条吧。</div>
          </section>
        </div>
      </section>
    </main>

    <script>
      const tenantId = ${JSON.stringify(tenantId)};
      const keyStorage = "todo_api_key_" + tenantId;

      const apiKeyInput = document.getElementById("apiKey");
      const titleInput = document.getElementById("title");
      const descriptionInput = document.getElementById("description");
      const createForm = document.getElementById("create-form");
      const refreshBtn = document.getElementById("refresh");
      const saveKeyBtn = document.getElementById("saveKey");
      const errorEl = document.getElementById("error");
      const listEl = document.getElementById("list");
      const emptyEl = document.getElementById("empty");
      const countEl = document.getElementById("count");

      apiKeyInput.value = localStorage.getItem(keyStorage) || "";

      function setError(message) {
        errorEl.textContent = message || "";
      }

      function authHeaders() {
        const token = apiKeyInput.value.trim();
        if (!token) {
          throw new Error("请先输入 API Key");
        }
        return {
          "Content-Type": "application/json",
          "X-Tenant-ID": tenantId,
          Authorization: "Bearer " + token,
        };
      }

      function escape(value) {
        return value
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      async function loadTodos() {
        try {
          setError("");
          const res = await fetch("/todos", { headers: authHeaders() });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "加载失败");

          const todos = Array.isArray(data) ? data : [];
          countEl.textContent = todos.length + " 项";
          emptyEl.hidden = todos.length !== 0;
          listEl.innerHTML = todos
            .map((todo) => {
              const done = todo.status === "completed";
              return \
                '<li class="todo ' + (done ? 'done' : '') + '">' +
                '<input type="checkbox" data-id="' + escape(todo.id) + '" ' + (done ? 'checked' : '') + ' />' +
                '<div><div class="title">' + escape(todo.title || '') + '</div><div class="desc">' + escape(todo.description || '') + '</div></div>' +
                '<span class="pill ' + (done ? 'done' : '') + '">' + (done ? 'completed' : 'pending') + '</span>' +
                '</li>';
            })
            .join("");
        } catch (err) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      }

      async function createTodo(event) {
        event.preventDefault();
        const title = titleInput.value.trim();
        const description = descriptionInput.value.trim();
        if (!title) return setError("标题不能为空");

        try {
          setError("");
          const res = await fetch("/todos", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ title, description }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "创建失败");
          titleInput.value = "";
          descriptionInput.value = "";
          await loadTodos();
        } catch (err) {
          setError(err instanceof Error ? err.message : "创建失败");
        }
      }

      async function toggleTodo(target) {
        const checkbox = target;
        if (!(checkbox instanceof HTMLInputElement)) return;
        if (checkbox.type !== "checkbox") return;

        const todoId = checkbox.dataset.id;
        if (!todoId) return;
        const nextStatus = checkbox.checked ? "completed" : "pending";

        try {
          setError("");
          const res = await fetch("/todos/" + encodeURIComponent(todoId), {
            method: "PATCH",
            headers: authHeaders(),
            body: JSON.stringify({ status: nextStatus }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "更新失败");
          await loadTodos();
        } catch (err) {
          checkbox.checked = !checkbox.checked;
          setError(err instanceof Error ? err.message : "更新失败");
        }
      }

      saveKeyBtn.addEventListener("click", () => {
        localStorage.setItem(keyStorage, apiKeyInput.value.trim());
        setError("API Key 已保存到浏览器本地");
      });
      refreshBtn.addEventListener("click", loadTodos);
      createForm.addEventListener("submit", createTodo);
      listEl.addEventListener("change", (e) => toggleTodo(e.target));

      loadTodos();
    </script>
  </body>
</html>`;
}

async function resolveTenantId(
  request: Request,
  env: DispatchEnv
): Promise<{ tenantId: string } | { error: Response }> {
  // 6.1: Extract tenant ID from X-Tenant-ID header
  const tenantId = request.headers.get("X-Tenant-ID");
  if (tenantId) {
    return { tenantId };
  }

  // 6.2: Custom domain fallback — look up domain:{hostname} in Platform KV
  const hostname = new URL(request.url).hostname;
  const mappedTenantId = await env.PLATFORM_KV.get(`domain:${hostname}`);
  if (mappedTenantId) {
    return { tenantId: mappedTenantId };
  }

  return { error: jsonError("Missing X-Tenant-ID header", 400) };
}

async function resolveTenantFromDomain(
  request: Request,
  env: DispatchEnv
): Promise<string | null> {
  const hostname = new URL(request.url).hostname;
  return env.PLATFORM_KV.get(`domain:${hostname}`);
}

export default {
  async fetch(request: Request, env: DispatchEnv): Promise<Response> {
    try {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      const tenantFromDomain = await resolveTenantFromDomain(request, env);

      if (method === "GET" && url.pathname === "/") {
        if (tenantFromDomain) {
          return htmlResponse(renderTenantAppHtml(tenantFromDomain));
        }
        return htmlResponse([
          "<h1>Todo Platform</h1>",
          "<p>Domain mode: bind <code>domain:hostname -&gt; tenantId</code> in PLATFORM_KV and open <code>/</code>.</p>",
          "<p>Path mode: open <code>/app/&lt;tenant-id&gt;</code> or <code>/app?tenant=&lt;tenant-id&gt;</code>.</p>",
        ].join(""));
      }

      if (method === "GET" && url.pathname === "/app") {
        const tenantFromQuery = url.searchParams.get("tenant") ?? tenantFromDomain;
        if (!tenantFromQuery) {
          return htmlResponse("<h1>Missing tenant</h1><p>Use /app?tenant=my-tenant</p>", 400);
        }
        return htmlResponse(renderTenantAppHtml(tenantFromQuery));
      }

      if (method === "GET") {
        const appMatch = url.pathname.match(/^\/app\/([^/]+)$/);
        if (appMatch) {
          return htmlResponse(renderTenantAppHtml(decodeURIComponent(appMatch[1])));
        }
      }

      const resolved = await resolveTenantId(request, env);
      if ("error" in resolved) {
        return resolved.error;
      }

      const { tenantId } = resolved;

      // Look up tenant metadata from Platform KV
      const tenantMeta = await env.PLATFORM_KV.get<TenantMeta>(
        `tenant:${tenantId}`,
        "json"
      );

      if (!tenantMeta) {
        return jsonError(`Tenant '${tenantId}' not found`, 404);
      }

      // Each tenant worker is deployed with its own static bindings.
      // Wrangler 4 runtime no longer accepts dynamic `bindings` here.
      const userWorker = env.DISPATCHER.get(tenantId);

      return userWorker.fetch(request);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal server error";

      // Treat "Worker not found" as 404
      if (message.toLowerCase().includes("worker not found")) {
        return jsonError("Tenant worker not found", 404);
      }

      console.error("Dispatch worker error:", err);
      return jsonError("Internal server error", 500);
    }
  },
};
