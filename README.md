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

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/<your-org-or-user>/<your-repo>)

Replace the repository URL in the link above with your actual GitHub repository URL.

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
