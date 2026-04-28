const TENANT_NAME_REGEX = /^[a-zA-Z0-9-]{3,63}$/;
const VALID_STATUSES = new Set(["pending", "completed"]);

export function validateTitle(title: unknown): string | null {
  if (typeof title !== "string") return "title 必须为字符串";
  if (title.trim().length === 0) return "title 不能为空或纯空白";
  if (title.length > 255) return "title 长度不能超过 255 个字符";
  return null;
}

export function validateTenantName(name: unknown): string | null {
  if (typeof name !== "string" || !TENANT_NAME_REGEX.test(name)) {
    return "租户名称必须为 3–63 位字母、数字或连字符";
  }
  return null;
}

export function validateStatus(status: unknown): string | null {
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
    return "status 必须为 pending 或 completed";
  }
  return null;
}
