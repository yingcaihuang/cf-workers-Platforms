# Cloudflare Workers Todo Platform

Multi-tenant Todo API platform built on Cloudflare Workers for Platforms.

## Stack
- Cloudflare Workers
- Workers for Platforms (Dispatch Namespace)
- D1
- KV
- TypeScript + Vitest

## Project Structure
- packages/admin-worker: tenant metadata management
- packages/dispatch-worker: tenant routing and dispatch
- packages/user-worker: tenant Todo API implementation
- packages/shared: shared types/validation
- scripts/: deploy/create/teardown helpers

## Prerequisites
- Node.js 18+
- Wrangler CLI
- Cloudflare login (`wrangler login`)

## Install
```bash
npm install
```

## Test
```bash
npm test
```

## Deploy Platform
```bash
npm run deploy
```

## One-Click Deploy to Cloudflare

⚠️ 重要提示：请严格按顺序部署（User Worker -> Admin Worker -> Dispatch Worker），否则会出现临时 404/500 或绑定失败。

Important: Deployment Order

Recommended order:
1. User Worker
2. Admin Worker
3. Dispatch Worker

Why this order matters:
- User Worker is the tenant runtime target. Dispatch will forward requests to tenant workers, so runtime should be ready first.
- Admin Worker is used by `scripts/create-tenant.sh` to register tenant metadata and domain mappings.
- Dispatch Worker is the entry gateway and depends on platform KV metadata + tenant runtime availability.

If you deploy in a different order, the platform may still eventually work, but you can temporarily see:
- 404/500 when dispatching to tenant workers not deployed yet.
- tenant creation/domain binding failures if Admin Worker is not ready.
- empty or inconsistent routing behavior during partial rollout.

User Worker:
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yingcaihuang/cf-workers-Platforms/tree/main/packages/user-worker)

Admin Worker:
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yingcaihuang/cf-workers-Platforms/tree/main/packages/admin-worker)

Dispatch Worker:
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yingcaihuang/cf-workers-Platforms/tree/main/packages/dispatch-worker)

Note: Deploy Button does not fully support deploying multiple Workers in one monorepo at once.
Use the buttons above for single Worker quick deploy, or run `npm run deploy` for full platform deployment.

## Create Tenant
```bash
npm run tenant:create -- my-tenant https://todo-admin-worker.<your-subdomain>.workers.dev
```

## Quick API Check
```bash
curl -X POST "https://todo-dispatch-worker.<your-subdomain>.workers.dev/todos" \
  -H "X-Tenant-ID: my-tenant" \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"title":"first task"}'

curl "https://todo-dispatch-worker.<your-subdomain>.workers.dev/todos" \
  -H "X-Tenant-ID: my-tenant" \
  -H "Authorization: Bearer <api-key>"
```

## Tenant-specific Tail
```bash
wrangler tail todo-dispatch-worker --format pretty --header "x-tenant-id: my-tenant"
```
