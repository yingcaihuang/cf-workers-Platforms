#!/usr/bin/env bash
# =============================================================================
# teardown.sh — 清理所有已部署的 Cloudflare 资源
#
# 用法：
#   ./scripts/teardown.sh
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

DISPATCH_NAMESPACE="todo-platform"
PLATFORM_KV_TITLE="todo-platform-kv"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo -e "${RED}════════════════════════════════════════════════════════${NC}"
echo -e "${RED}  警告：此操作将删除所有已部署的 Workers 和云资源${NC}"
echo -e "${RED}════════════════════════════════════════════════════════${NC}"
echo ""
read -rp "确认删除？输入 yes 继续: " CONFIRM
[[ "$CONFIRM" != "yes" ]] && echo "已取消" && exit 0

# 删除 Workers
log_info "删除 Dispatch Worker..."
cd "$ROOT_DIR/packages/dispatch-worker"
wrangler delete --name todo-dispatch-worker --force 2>/dev/null || log_warn "Dispatch Worker 不存在或已删除"

log_info "删除 Admin Worker..."
cd "$ROOT_DIR/packages/admin-worker"
wrangler delete --name todo-admin-worker --force 2>/dev/null || log_warn "Admin Worker 不存在或已删除"

# 删除 Platform KV
log_info "删除 Platform KV Namespace..."
KV_ID=$(wrangler kv namespace list 2>/dev/null \
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

if [[ -n "$KV_ID" ]]; then
  wrangler kv namespace delete --namespace-id "$KV_ID" --force 2>/dev/null || log_warn "KV 删除失败"
  log_success "Platform KV 已删除"
else
  log_warn "Platform KV 不存在或已删除"
fi

# 删除 Dispatch Namespace
log_info "删除 Dispatch Namespace..."
wrangler dispatch-namespace delete "$DISPATCH_NAMESPACE" --force 2>/dev/null || log_warn "Dispatch Namespace 不存在或已删除"

# 清理构建产物
log_info "清理构建产物..."
rm -rf "$ROOT_DIR/.build"

# 还原 wrangler.toml 中的 placeholder
log_info "还原 wrangler.toml..."
for toml in \
  "$ROOT_DIR/packages/dispatch-worker/wrangler.toml" \
  "$ROOT_DIR/packages/admin-worker/wrangler.toml"; do
  sed -i.bak 's/id = "[0-9a-f]\{32\}"/id = "placeholder"/' "$toml" 2>/dev/null || true
  rm -f "${toml}.bak"
done

echo ""
log_success "清理完成"
