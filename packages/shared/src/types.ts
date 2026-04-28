export type TodoStatus = "pending" | "completed";

export interface Todo {
  id: string;
  title: string;
  description: string;
  status: TodoStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateTodoRequest {
  title: string;
  description?: string;
}

export interface UpdateTodoRequest {
  title?: string;
  description?: string;
  status?: TodoStatus;
}

export interface ErrorResponse {
  error: string;
}

export interface TenantMeta {
  tenantId: string;
  d1DatabaseId: string;
  kvNamespaceId: string;
  apiKey: string;
  createdAt: string;
  status: "active" | "deleted";
  customDomains: string[];
}

export interface CreateTenantRequest {
  name: string;
}

export interface CreateTenantResponse {
  tenantId: string;
  apiKey: string;
  createdAt: string;
}

export interface AdminEnv {
  PLATFORM_KV: KVNamespace;
  DISPATCH_NAMESPACE_NAME: string;
}

export interface DispatchEnv {
  DISPATCHER: DispatchNamespace;
  PLATFORM_KV: KVNamespace;
}

export interface UserEnv {
  DB: D1Database;
  KV: KVNamespace;
}
