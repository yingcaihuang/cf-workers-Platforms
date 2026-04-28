#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Cloudflare Workers Todo 多租户平台一键部署脚本
#
# 用法：
#   ./scripts/deploy.sh
#
# 前置条件：
#   - 已运行 wrangler login 完成登录
#   - 已安装项目依赖（npm install）
#   - 已全局安装 wrangler（npm install -g wrangler）
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
PLATFORM_KV_TITLE="todo-platform-kv"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 检查依赖 ──────────────────────────────────────────────────────────────────
check_deps() {
  log_info "检查依赖..."
  command -v node    >/dev/null 2>&1 || log_error "未找到 node，请先安装 Node.js"
  command -v wrangler >/dev/null 2>&1 || log_error "未找到 wrangler，请先安装: npm install -g wrangler"

  if ! wrangler whoami >/dev/null 2>&1; then
    log_error "未登录 Cloudflare，请先运行: wrangler login"
  fi
  log_success "依赖检查通过（已登录: $(wrangler whoami 2>/dev/null | grep -oE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+' | head -1 || echo '已登录')）"
}

# ── 获取 Account ID ───────────────────────────────────────────────────────────
get_account_id() {
  log_info "获取 Cloudflare Account ID..."
  ACCOUNT_ID=$(wrangler whoami 2>/dev/null \
    | grep -oE '[0-9a-f]{32}' \
    | head -1 || true)

  if [[ -z "$ACCOUNT_ID" ]]; then
    echo ""
    log_warn "无法自动获取 Account ID，请手动输入："
    read -rp "Cloudflare Account ID: " ACCOUNT_ID
    [[ -z "$ACCOUNT_ID" ]] && log_error "Account ID 不能为空"
  fi
  log_success "Account ID: $ACCOUNT_ID"
}

# ── 创建 Dispatch Namespace ───────────────────────────────────────────────────
create_dispatch_namespace() {
  log_info "创建 Dispatch Namespace: $DISPATCH_NAMESPACE ..."

  if wrangler dispatch-namespace list 2>/dev/null | grep -q "$DISPATCH_NAMESPACE"; then
    log_warn "Dispatch Namespace '$DISPATCH_NAMESPACE' 已存在，跳过"
  else
    wrangler dispatch-namespace create "$DISPATCH_NAMESPACE"
    log_success "Dispatch Namespace 创建成功"
  fi
}

# ── 创建 Platform KV ──────────────────────────────────────────────────────────
create_platform_kv() {
  log_info "创建 Platform KV: $PLATFORM_KV_TITLE ..."

  PLATFORM_KV_ID=$(wrangler kv namespace list 2>/dev/null \
    | node -e "
        const chunks = [];
        process.stdin.on('data', d => chunks.push(d));
        process.stdin.on('end', () => {
          try {
            const list = JSON.parse(chunks.join(''));
            const found = list.find(ns => ns.title === '$PLATFORM_KV_TITLE');
            console.log(found ? found.id : '');
          } catch { console.log(''); }
        });
      " 2>/dev/null || true)

  if [[ -n "$PLATFORM_KV_ID" ]]; then
    log_warn "Platform KV 已存在 (id: $PLATFORM_KV_ID)，跳过"
  else
    KV_OUTPUT=$(wrangler kv namespace create "$PLATFORM_KV_TITLE" 2>&1)
    echo "$KV_OUTPUT"
    PLATFORM_KV_ID=$(wrangler kv namespace list 2>/dev/null \
      | node -e "
          const chunks = [];
          process.stdin.on('data', d => chunks.push(d));
          process.stdin.on('end', () => {
            try {
              const list = JSON.parse(chunks.join(''));
              const found = list.find(ns => ns.title === '$PLATFORM_KV_TITLE');
              console.log(found ? found.id : '');
            } catch { console.log(''); }
          });
        " 2>/dev/null || true)
    [[ -z "$PLATFORM_KV_ID" ]] && log_error "无法获取 Platform KV ID"
    log_success "Platform KV 创建成功 (id: $PLATFORM_KV_ID)"
  fi
}

# ── 更新 wrangler.toml 中的 KV ID ─────────────────────────────────────────────
update_wrangler_configs() {
  log_info "更新 wrangler.toml 中的 Platform KV ID..."

  for toml in \
    "$ROOT_DIR/packages/dispatch-worker/wrangler.toml" \
    "$ROOT_DIR/packages/admin-worker/wrangler.toml"; do
    # 替换 placeholder（只替换一次，避免重复执行时误替换）
    if grep -q 'id = "placeholder"' "$toml"; then
      sed -i.bak "s/id = \"placeholder\"/id = \"$PLATFORM_KV_ID\"/" "$toml"
      rm -f "${toml}.bak"
      log_success "已更新: $toml"
    else
      log_warn "已是最新，跳过: $toml"
    fi
  done
}

# ── 构建 User Worker bundle ───────────────────────────────────────────────────
build_user_worker() {
  log_info "构建 User Worker bundle..."
  mkdir -p "$ROOT_DIR/.build/user-worker"

  cd "$ROOT_DIR/packages/user-worker"

  # wrangler deploy --dry-run 输出编译后的 bundle
  wrangler deploy --dry-run --outdir "$ROOT_DIR/.build/user-worker" 2>/dev/null || true

  USER_WORKER_BUNDLE="$ROOT_DIR/.build/user-worker/index.js"

  if [[ ! -f "$USER_WORKER_BUNDLE" ]]; then
    log_warn "dry-run 未生成 bundle，尝试 esbuild..."
    command -v esbuild >/dev/null 2>&1 || log_error "未找到 esbuild，请安装: npm install -g esbuild"
    esbuild src/index.ts \
      --bundle \
      --format=esm \
      --platform=browser \
      --target=es2022 \
      --outfile="$USER_WORKER_BUNDLE"
  fi

  [[ ! -f "$USER_WORKER_BUNDLE" ]] && log_error "User Worker bundle 构建失败"
  log_success "User Worker bundle 构建完成: $USER_WORKER_BUNDLE"
  cd "$ROOT_DIR"
}

# ── 部署 Dispatch Worker ──────────────────────────────────────────────────────
deploy_dispatch_worker() {
  log_info "部署 Dispatch Worker..."
  cd "$ROOT_DIR/packages/dispatch-worker"
  wrangler deploy
  cd "$ROOT_DIR"
  log_success "Dispatch Worker 部署完成"
}

# ── 部署 Admin Worker ─────────────────────────────────────────────────────────
deploy_admin_worker() {
  log_info "部署 Admin Worker..."
  cd "$ROOT_DIR/packages/admin-worker"
  wrangler deploy
  cd "$ROOT_DIR"
  log_success "Admin Worker 部署完成"
}

# ── 获取 Worker 子域 ──────────────────────────────────────────────────────────
get_worker_urls() {
  # 从刚部署的 Admin Worker 实际 URL 提取子域
  cd "$ROOT_DIR/packages/admin-worker"
  ADMIN_URL=$(wrangler deploy --dry-run 2>&1 \
    | grep -oE 'https://todo-admin-worker\.[^ ]+\.workers\.dev' | head -1 || true)
  cd "$ROOT_DIR"

  if [[ -n "$ADMIN_URL" ]]; then
    SUBDOMAIN=$(echo "$ADMIN_URL" | sed 's|https://todo-admin-worker\.||' | sed 's|\.workers\.dev||')
  else
    SUBDOMAIN="<your-subdomain>"
    ADMIN_URL="https://todo-admin-worker.${SUBDOMAIN}.workers.dev"
  fi

  DISPATCH_URL="https://todo-dispatch-worker.${SUBDOMAIN}.workers.dev"
}

# ── 打印部署摘要 ──────────────────────────────────────────────────────────────
print_summary() {
  echo ""
  echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  部署完成！${NC}"
  echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  Platform KV ID:  ${BLUE}$PLATFORM_KV_ID${NC}"
  echo -e "  Dispatch Worker: ${BLUE}$DISPATCH_URL${NC}"
  echo -e "  Admin Worker:    ${BLUE}$ADMIN_URL${NC}"
  echo ""
  echo -e "${YELLOW}快速测试：${NC}"
  echo ""
  echo "  # 1. 创建租户（脚本会自动创建 D1/KV 并注册到 Admin Worker）"
  echo "  ./scripts/create-tenant.sh my-tenant"
  echo ""
  echo "  # 或手动创建租户："
  echo "  curl -X POST $ADMIN_URL/admin/tenants \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -d '{\"name\":\"my-tenant\",\"d1DatabaseId\":\"<d1-id>\",\"kvNamespaceId\":\"<kv-id>\"}'"
  echo ""
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  Cloudflare Workers Todo 平台 — 一键部署${NC}"
  echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
  echo ""

  check_deps
  get_account_id
  create_dispatch_namespace
  create_platform_kv
  update_wrangler_configs
  build_user_worker
  deploy_dispatch_worker
  deploy_admin_worker
  get_worker_urls
  print_summary
}

main "$@"
