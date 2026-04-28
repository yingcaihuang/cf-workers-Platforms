#!/usr/bin/env bash
# =============================================================================
# create-tenant.sh — 创建新租户（D1 + KV + Worker 脚本 + 注册元数据）
#
# 用法：
#   ./scripts/create-tenant.sh <tenant-name> [admin-worker-url]
#
# 示例：
#   ./scripts/create-tenant.sh my-tenant
#   ./scripts/create-tenant.sh my-tenant https://todo-admin-worker.xxx.workers.dev
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

DISPATCH_NAMESPACE="todo-platform"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLATFORM_KV_ID=$(grep -E '^id = "[0-9a-f]{32}"$' "$ROOT_DIR/packages/admin-worker/wrangler.toml" | head -1 | sed -E 's/id = "([0-9a-f]{32})"/\1/' || true)

TENANT_NAME="${1:-}"
ADMIN_URL_INPUT="${2:-}"
[[ -z "$TENANT_NAME" ]] && log_error "用法: $0 <tenant-name>"

# 验证租户名格式
if ! echo "$TENANT_NAME" | grep -qE '^[a-zA-Z0-9-]{3,63}$'; then
  log_error "租户名格式非法，仅允许字母、数字和连字符，长度 3–63 位"
fi

echo ""
echo -e "${BLUE}创建租户: $TENANT_NAME${NC}"
echo ""

# ── 1. 创建 D1 数据库 ─────────────────────────────────────────────────────────
log_info "创建 D1 数据库: todo-${TENANT_NAME}-db ..."
D1_OUTPUT=$(wrangler d1 create "todo-${TENANT_NAME}-db" 2>&1 || true)
echo "$D1_OUTPUT"

D1_ID=$(echo "$D1_OUTPUT" | grep -oE 'database_id = "[^"]+"' | grep -oE '"[^"]+"' | tr -d '"' | head -1 || true)

if [[ -z "$D1_ID" ]]; then
  # 从列表获取
  D1_ID=$(wrangler d1 list 2>/dev/null \
    | awk -v db="todo-${TENANT_NAME}-db" '$0 ~ db { if (match($0, /[0-9a-f-]{36}/)) print substr($0, RSTART, RLENGTH) }' \
    | head -1 || true)
fi

[[ -z "$D1_ID" ]] && log_error "无法获取 D1 数据库 ID"
log_success "D1 数据库创建成功 (id: $D1_ID)"

# ── 2. 初始化 D1 Schema ───────────────────────────────────────────────────────
log_info "初始化 D1 Schema..."
wrangler d1 execute "todo-${TENANT_NAME}-db" \
  --file "$ROOT_DIR/packages/user-worker/schema.sql" \
  --remote
log_success "D1 Schema 初始化完成"

# ── 3. 创建 KV 命名空间 ───────────────────────────────────────────────────────
log_info "创建 KV 命名空间: todo-${TENANT_NAME}-kv ..."
KV_OUTPUT=$(wrangler kv namespace create "todo-${TENANT_NAME}-kv" 2>&1 || true)
echo "$KV_OUTPUT"

KV_ID=$(echo "$KV_OUTPUT" | grep -oE '"id": "[^"]+"' | grep -oE '"[^"]+"' | tail -1 | tr -d '"' || true)

if [[ -z "$KV_ID" ]]; then
  KV_ID=$(wrangler kv namespace list 2>/dev/null \
    | node -e "
        const chunks = [];
        process.stdin.on('data', d => chunks.push(d));
        process.stdin.on('end', () => {
          try {
            const list = JSON.parse(chunks.join(''));
            const found = list.find(ns => ns.title === 'todo-${TENANT_NAME}-kv');
            console.log(found ? found.id : '');
          } catch { console.log(''); }
        });
      " 2>/dev/null || true)
fi

[[ -z "$KV_ID" ]] && log_error "无法获取 KV 命名空间 ID"
log_success "KV 命名空间创建成功 (id: $KV_ID)"

# ── 4. 上传 User Worker 脚本到 Dispatch Namespace ─────────────────────────────
log_info "上传 User Worker 脚本到 Dispatch Namespace..."

USER_WORKER_BUNDLE="$ROOT_DIR/.build/user-worker/index.js"
[[ ! -f "$USER_WORKER_BUNDLE" ]] && log_error "User Worker bundle 不存在，请先运行 ./scripts/deploy.sh"

# 创建临时 wrangler.toml 用于上传到 dispatch namespace
TEMP_DIR=$(mktemp -d)
cp "$USER_WORKER_BUNDLE" "$TEMP_DIR/index.js"

cat > "$TEMP_DIR/wrangler.toml" <<EOF
name = "$TENANT_NAME"
main = "index.js"
compatibility_date = "2024-06-10"

[observability.logs]
enabled = true
invocation_logs = true

[observability.traces]
enabled = true

[[d1_databases]]
binding = "DB"
database_name = "todo-${TENANT_NAME}-db"
database_id = "$D1_ID"

[[kv_namespaces]]
binding = "KV"
id = "$KV_ID"
EOF

cd "$TEMP_DIR"
wrangler deploy --dispatch-namespace "$DISPATCH_NAMESPACE"
cd "$ROOT_DIR"
rm -rf "$TEMP_DIR"

log_success "User Worker 脚本上传完成"

# ── 5. 注册租户元数据到 Admin Worker ─────────────────────────────────────────
log_info "注册租户元数据..."

# 从 wrangler deployments list 获取 Admin Worker 的实际 URL
ADMIN_URL="$ADMIN_URL_INPUT"

if [[ -z "$ADMIN_URL" ]]; then
  ADMIN_URL=$(wrangler deployments list --name todo-admin-worker 2>/dev/null \
    | grep -oE 'https://todo-admin-worker\.[^ ]+\.workers\.dev' | head -1 || true)
fi

# 备用：从 wrangler deploy dry-run 获取
if [[ -z "$ADMIN_URL" ]]; then
  cd "$ROOT_DIR/packages/admin-worker"
  ADMIN_URL=$(wrangler deploy --dry-run 2>&1 \
    | grep -oE 'https://todo-admin-worker\.[^ ]+\.workers\.dev' | head -1 || true)
  cd "$ROOT_DIR"
fi

if [[ -z "$ADMIN_URL" ]]; then
  echo ""
  log_warn "无法自动获取 Admin Worker URL，请手动输入："
  read -rp "Admin Worker URL (如 https://todo-admin-worker.nfr-gcr-eastasia.workers.dev): " ADMIN_URL
fi

# 从 ADMIN_URL 提取子域用于后续 Dispatch URL
SUBDOMAIN=$(echo "$ADMIN_URL" | sed 's|https://todo-admin-worker\.||' | sed 's|\.workers\.dev||' || true)

REGISTER_RESPONSE=$(curl -s -X POST "$ADMIN_URL/admin/tenants" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$TENANT_NAME\",\"d1DatabaseId\":\"$D1_ID\",\"kvNamespaceId\":\"$KV_ID\"}")

echo "$REGISTER_RESPONSE"

API_KEY=$(echo "$REGISTER_RESPONSE" | node -e "
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', () => {
    try { console.log(JSON.parse(chunks.join('')).apiKey ?? ''); }
    catch { console.log(''); }
  });
" 2>/dev/null || true)

# 幂等支持：租户已存在时，从 Platform KV 回读已有 API Key
if [[ -z "$API_KEY" ]]; then
  if echo "$REGISTER_RESPONSE" | grep -q "租户已存在"; then
    log_warn "租户已存在，尝试读取已有 API Key..."
    if [[ -n "$PLATFORM_KV_ID" ]]; then
      TENANT_META=$(wrangler kv key get --namespace-id "$PLATFORM_KV_ID" --remote "tenant:${TENANT_NAME}" 2>/dev/null || true)
      API_KEY=$(echo "$TENANT_META" | node -e "
        const chunks = [];
        process.stdin.on('data', d => chunks.push(d));
        process.stdin.on('end', () => {
          try { console.log(JSON.parse(chunks.join('')).apiKey ?? ''); }
          catch { console.log(''); }
        });
      " 2>/dev/null || true)
    fi
  fi
fi

[[ -z "$API_KEY" ]] && log_error "租户注册失败，且无法获取已有 API Key，请检查上方响应"

# ── 6. 将 API Key 写入租户 KV ─────────────────────────────────────────────────
log_info "将 API Key 写入租户 KV..."
wrangler kv key put "apikey:${API_KEY}" "valid" \
  --namespace-id "$KV_ID" \
  --remote
log_success "API Key 写入完成"

# ── 完成 ──────────────────────────────────────────────────────────────────────
DISPATCH_URL="https://todo-dispatch-worker.${SUBDOMAIN}.workers.dev"

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  租户 '$TENANT_NAME' 创建成功！${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  API Key:   ${YELLOW}$API_KEY${NC}"
echo -e "  D1 ID:     $D1_ID"
echo -e "  KV ID:     $KV_ID"
echo ""
echo -e "${YELLOW}测试命令：${NC}"
echo ""
echo "  # 创建 Todo"
echo "  curl -X POST $DISPATCH_URL/todos \\"
echo "    -H 'X-Tenant-ID: $TENANT_NAME' \\"
echo "    -H 'Authorization: Bearer $API_KEY' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"title\": \"我的第一个任务\"}'"
echo ""
echo "  # 查询 Todo 列表"
echo "  curl $DISPATCH_URL/todos \\"
echo "    -H 'X-Tenant-ID: $TENANT_NAME' \\"
echo "    -H 'Authorization: Bearer $API_KEY'"
echo ""
