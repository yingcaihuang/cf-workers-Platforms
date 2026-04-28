import type { DispatchEnv } from "./types";
import type { TenantMeta } from "@todo-platform/shared";

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

export default {
  async fetch(request: Request, env: DispatchEnv): Promise<Response> {
    try {
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
