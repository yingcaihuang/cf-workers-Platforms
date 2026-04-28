import { validateTenantName } from "../../shared/src/validation";
import type { AdminEnv, TenantMeta } from "./types";

// Admin Worker 职责：管理 Platform KV 中的租户元数据
// 所有 Cloudflare 资源（D1、KV、Worker 脚本）由 deploy.sh 通过 wrangler 命令创建
// Admin Worker 仅负责：租户元数据读写、API Key 生成、域名映射管理

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// POST /admin/tenants
// 注册租户元数据（D1/KV 资源已由 deploy.sh 创建并传入）
async function createTenant(request: Request, env: AdminEnv): Promise<Response> {
  let body: { name?: unknown; d1DatabaseId?: unknown; kvNamespaceId?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("请求体必须为有效 JSON", 400);
  }

  const nameError = validateTenantName(body.name);
  if (nameError) return errorResponse(nameError, 400);

  const tenantId = body.name as string;

  if (typeof body.d1DatabaseId !== "string" || !body.d1DatabaseId) {
    return errorResponse("d1DatabaseId 必填", 400);
  }
  if (typeof body.kvNamespaceId !== "string" || !body.kvNamespaceId) {
    return errorResponse("kvNamespaceId 必填", 400);
  }

  // Req 1.6: 检查租户是否已存在
  const existing = await env.PLATFORM_KV.get(`tenant:${tenantId}`);
  if (existing !== null) return errorResponse("租户已存在", 409);

  // Req 1.2: 生成 API Key
  const apiKey = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const tenantMeta: TenantMeta = {
    tenantId,
    d1DatabaseId: body.d1DatabaseId,
    kvNamespaceId: body.kvNamespaceId,
    apiKey,
    createdAt,
    status: "active",
    customDomains: [],
  };

  await env.PLATFORM_KV.put(`tenant:${tenantId}`, JSON.stringify(tenantMeta));

  return jsonResponse({ tenantId, apiKey, createdAt }, 201);
}

// GET /admin/tenants — Req 1.9
async function listTenants(env: AdminEnv): Promise<Response> {
  const list = await env.PLATFORM_KV.list({ prefix: "tenant:" });
  const tenants = await Promise.all(
    list.keys.map(async (key) => {
      const raw = await env.PLATFORM_KV.get(key.name);
      if (!raw) return null;
      const meta = JSON.parse(raw) as TenantMeta;
      return { tenantId: meta.tenantId, createdAt: meta.createdAt, status: meta.status };
    })
  );
  return jsonResponse(tenants.filter(Boolean));
}

// DELETE /admin/tenants/:tenantId — Req 1.8
// 仅更新 KV 状态；实际资源删除由 wrangler 命令完成
async function deleteTenant(tenantId: string, env: AdminEnv): Promise<Response> {
  const raw = await env.PLATFORM_KV.get(`tenant:${tenantId}`);
  if (!raw) return errorResponse("租户不存在", 404);

  const meta = JSON.parse(raw) as TenantMeta;
  const updatedMeta: TenantMeta = { ...meta, status: "deleted" };
  await env.PLATFORM_KV.put(`tenant:${tenantId}`, JSON.stringify(updatedMeta));

  return jsonResponse({ message: "租户已标记为删除，请运行 wrangler 命令清理云资源" });
}

// POST /admin/tenants/:tenantId/domains — Req 8.1–8.5
async function bindDomain(tenantId: string, request: Request, env: AdminEnv): Promise<Response> {
  const raw = await env.PLATFORM_KV.get(`tenant:${tenantId}`);
  if (!raw) return errorResponse("租户不存在", 404);

  let body: { domain?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("请求体必须为有效 JSON", 400);
  }

  const domain = body.domain;
  if (typeof domain !== "string" || !domain.trim()) {
    return errorResponse("domain 字段必填", 400);
  }

  // Req 8.4: 检查域名是否已被绑定
  const existingDomain = await env.PLATFORM_KV.get(`domain:${domain}`);
  if (existingDomain !== null) return errorResponse("域名已被绑定", 409);

  await env.PLATFORM_KV.put(`domain:${domain}`, tenantId);

  const meta = JSON.parse(raw) as TenantMeta;
  const updatedMeta: TenantMeta = {
    ...meta,
    customDomains: [...meta.customDomains, domain],
  };
  await env.PLATFORM_KV.put(`tenant:${tenantId}`, JSON.stringify(updatedMeta));

  return jsonResponse({ message: "域名绑定成功", domain });
}

// DELETE /admin/tenants/:tenantId/domains/:domain — Req 8.6
async function unbindDomain(tenantId: string, domain: string, env: AdminEnv): Promise<Response> {
  const raw = await env.PLATFORM_KV.get(`tenant:${tenantId}`);
  if (!raw) return errorResponse("租户不存在", 404);

  await env.PLATFORM_KV.delete(`domain:${domain}`);

  const meta = JSON.parse(raw) as TenantMeta;
  const updatedMeta: TenantMeta = {
    ...meta,
    customDomains: meta.customDomains.filter((d) => d !== domain),
  };
  await env.PLATFORM_KV.put(`tenant:${tenantId}`, JSON.stringify(updatedMeta));

  return jsonResponse({ message: "域名解绑成功" });
}

// ── Router ───────────────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: AdminEnv): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (method === "POST" && pathname === "/admin/tenants") {
      return createTenant(request, env);
    }
    if (method === "GET" && pathname === "/admin/tenants") {
      return listTenants(env);
    }

    const tenantMatch = pathname.match(/^\/admin\/tenants\/([^/]+)(\/.*)?$/);
    if (tenantMatch) {
      const tenantId = tenantMatch[1];
      const rest = tenantMatch[2] ?? "";

      if (method === "DELETE" && rest === "") {
        return deleteTenant(tenantId, env);
      }
      if (method === "POST" && rest === "/domains") {
        return bindDomain(tenantId, request, env);
      }
      const domainMatch = rest.match(/^\/domains\/(.+)$/);
      if (method === "DELETE" && domainMatch) {
        return unbindDomain(tenantId, decodeURIComponent(domainMatch[1]), env);
      }
    }

    return errorResponse("Not Found", 404);
  },
};
