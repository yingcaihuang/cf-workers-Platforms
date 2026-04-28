# 实现计划：Cloudflare Workers Todo 多租户平台

## 概述

基于 TypeScript + Cloudflare Workers for Platforms 实现多租户 Todo List 平台，分为三个 Worker 组件逐步构建：User Worker（Todo 业务逻辑）、Dispatch Worker（请求路由）、Admin Worker（租户生命周期管理）。

## 任务

- [x] 1. 初始化项目结构与公共类型定义
  - 使用 Wrangler 初始化 monorepo 结构，创建 `packages/user-worker`、`packages/dispatch-worker`、`packages/admin-worker` 三个子包
  - 在共享模块中定义 `Todo`、`TenantMeta`、`CreateTodoRequest`、`UpdateTodoRequest`、`ErrorResponse` 等 TypeScript 接口
  - 配置 Vitest 测试框架（含 `vitest.config.ts` 和 `vitest.integration.config.ts`）
  - 安装 `fast-check`、`miniflare` 依赖
  - _需求：4、5、6、7、9_

- [x] 2. 实现输入验证工具函数
  - [x] 2.1 实现 `validateTitle`、`validateTenantName`、`validateStatus` 验证函数
    - 按设计文档中的规则实现：title 非空白且 ≤ 255 字符，租户名 `/^[a-zA-Z0-9-]{3,63}$/`，status 枚举校验
    - _需求：1.1、1.7、4.6、4.7、6.5、6.6_

  - [ ]* 2.2 为验证函数编写单元测试
    - 覆盖空字符串、纯空白、超长字符串、格式非法的租户名等边界值
    - _需求：1.7、4.6、4.7、6.5、6.6_

- [x] 3. 实现 User Worker — 认证中间件与路由框架
  - [x] 3.1 实现 `authenticate` 中间件
    - 从 `Authorization` Header 提取 Bearer Token，在 `env.KV` 中查询 `apikey:{token}` 验证有效性
    - 缺少 Header 或格式错误返回 401，token 无效返回 401
    - _需求：3.1、3.2、3.3、3.4_

  - [x] 3.2 实现 User Worker 路由分发框架
    - 解析请求 Method 和 Path，分发至对应处理函数；未匹配路由返回 404
    - _需求：4.1、5.1、5.3、6.1、7.1_

  - [ ]* 3.3 为认证中间件编写单元测试
    - 覆盖缺少 Header、格式错误、无效 token、有效 token 四种场景
    - _需求：3.3、3.4_

  - [ ]* 3.4 为属性 7（无效 API Key 被拒绝）编写属性测试
    - **属性 7：无效 API Key 被拒绝**
    - **验证：需求 3.3、3.4**

- [x] 4. 实现 User Worker — Todo CRUD 接口
  - [x] 4.1 实现 D1 数据库 Schema 初始化脚本
    - 编写建表 SQL（含 `todos` 表、`idx_todos_status` 和 `idx_todos_created_at` 索引）
    - _需求：1.5、9.1_

  - [x] 4.2 实现 POST `/todos`（创建 Todo）
    - 验证 `title` 字段，生成 UUID v4 `id`，`status` 初始化为 `pending`，`created_at`/`updated_at` 设为当前 UTC ISO 8601，插入 D1，返回 201 + 完整 Todo 对象
    - _需求：4.1、4.2、4.3、4.4、4.5、4.6、4.7、4.8_

  - [ ]* 4.3 为属性 1（Todo 创建后可查询到）编写属性测试
    - **属性 1：Todo 创建后可查询到**
    - **验证：需求 4.1、4.2、4.3、4.4、4.5、5.3**

  - [ ]* 4.4 为属性 2（空白 title 被拒绝）编写属性测试
    - **属性 2：空白 title 被拒绝**
    - **验证：需求 4.6**

  - [ ]* 4.5 为属性 3（title 长度超限被拒绝）编写属性测试（创建场景）
    - **属性 3：title 长度超限被拒绝（创建）**
    - **验证：需求 4.7**

  - [x] 4.6 实现 GET `/todos`（查询 Todo 列表）
    - 默认按 `created_at` 降序返回全部 Todo；支持 `?status=pending|completed` 过滤
    - _需求：5.1、5.2_

  - [ ]* 4.7 为属性 5（状态过滤正确性）编写属性测试
    - **属性 5：状态过滤正确性**
    - **验证：需求 5.2**

  - [x] 4.8 实现 GET `/todos/:id`（查询单条 Todo）
    - 从 D1 查询指定 id，不存在返回 404
    - _需求：5.3、5.4、5.5_

  - [x] 4.9 实现 PATCH `/todos/:id`（更新 Todo）
    - 支持部分更新 `title`、`description`、`status`；更新 `updated_at`；空请求体返回 400；字段校验失败返回 400；id 不存在返回 404；返回 200 + 完整更新后 Todo
    - _需求：6.1、6.2、6.3、6.4、6.5、6.6、6.7、6.8_

  - [ ]* 4.10 为属性 4（Todo 更新后字段正确反映）编写属性测试
    - **属性 4：Todo 更新后字段正确反映**
    - **验证：需求 6.1、6.2、6.3、6.4**

  - [ ]* 4.11 为属性 3（title 长度超限被拒绝）编写属性测试（更新场景）
    - **属性 3：title 长度超限被拒绝（更新）**
    - **验证：需求 6.6**

  - [x] 4.12 实现 DELETE `/todos/:id`（删除 Todo）
    - 从 D1 删除指定 id，不存在返回 404，成功返回 204 空响应体
    - _需求：7.1、7.2、7.3、7.4_

  - [ ]* 4.13 为属性 6（删除后不可查询）编写属性测试
    - **属性 6：删除后不可查询**
    - **验证：需求 7.1、7.2、7.3**

- [x] 5. 检查点 — User Worker 基础功能验证
  - 确保所有单元测试和属性测试通过，如有疑问请向用户确认。

- [x] 6. 实现 Dispatch Worker
  - [x] 6.1 实现租户识别与请求路由核心逻辑
    - 从 `X-Tenant-ID` Header 提取租户 ID；从 `PLATFORM_KV` 读取 `tenant:{tenantId}` 元数据；通过 `dispatchNamespace.get(tenantId, { bindings: { DB, KV } })` 注入绑定并转发请求
    - 缺少 Header 返回 400，租户不存在返回 404，其他异常返回 500
    - _需求：2.1、2.2、2.3、2.4、2.6、9.4_

  - [x] 6.2 实现自定义域名回退路由
    - 当缺少 `X-Tenant-ID` Header 时，从 `PLATFORM_KV` 查询 `domain:{hostname}` 映射获取 tenantId，再执行正常路由流程
    - _需求：2.5_

  - [ ]* 6.3 为 Dispatch Worker 路由逻辑编写单元测试
    - 覆盖 Header 存在/缺失、租户存在/不存在、自定义域名路由等场景
    - _需求：2.1、2.2、2.3、2.4、2.5_

- [x] 7. 实现 Admin Worker — 租户生命周期管理
  - [x] 7.1 实现 POST `/admin/tenants`（创建租户）
    - 验证租户名称格式；检查 Platform KV 中是否已存在；调用 Cloudflare REST API 创建 D1 数据库和 KV 命名空间；上传 User Worker 脚本（含绑定）；执行建表 SQL；生成 UUID v4 API Key；将 API Key 写入租户 KV（`apikey:{token}` → `"valid"`）；将 `TenantMeta` 写入 Platform KV；返回 201
    - _需求：1.1、1.2、1.3、1.4、1.5、1.6、1.7_

  - [x] 7.2 实现 GET `/admin/tenants`（查询租户列表）
    - 从 Platform KV 列出所有 `tenant:` 前缀的键，返回租户名称、创建时间及状态
    - _需求：1.9_

  - [x] 7.3 实现 DELETE `/admin/tenants/:tenantId`（删除租户）
    - 调用 Cloudflare REST API 删除 D1 数据库、KV 命名空间及 User Worker 绑定；更新 Platform KV 中租户状态为 `deleted`
    - _需求：1.8_

  - [x] 7.4 实现 POST `/admin/tenants/:tenantId/domains`（绑定自定义域名）
    - 验证租户存在；检查域名是否已被其他租户绑定（`domain:{hostname}` 键）；调用 Cloudflare Workers for Platforms API 绑定域名路由；在 Platform KV 写入 `domain:{hostname}` → `tenantId` 映射；更新 `TenantMeta.customDomains`；返回 200
    - _需求：8.1、8.2、8.3、8.4、8.5_

  - [x] 7.5 实现 DELETE `/admin/tenants/:tenantId/domains/:domain`（解绑自定义域名）
    - 调用 Cloudflare API 移除域名路由；删除 Platform KV 中 `domain:{hostname}` 键；更新 `TenantMeta.customDomains`
    - _需求：8.6_

  - [ ]* 7.6 为 Admin Worker 关键路径编写单元测试
    - 覆盖租户名称格式校验、重复租户名 409、租户不存在 404、域名冲突 409 等场景
    - _需求：1.1、1.6、1.7、8.4、8.5_

- [x] 8. 检查点 — 完整流程集成验证
  - 确保所有测试通过，如有疑问请向用户确认。

- [x] 9. 编写集成测试
  - [ ]* 9.1 编写端到端集成测试（Dispatch → User Worker 完整流程）
    - 使用 Miniflare 模拟 D1 和 KV 绑定，验证完整请求链路
    - _需求：2.1、2.2、2.6、3.1、3.2_

  - [ ]* 9.2 编写跨租户数据隔离集成测试
    - 验证属性 8：租户 A 的操作无法读取或修改租户 B 的数据
    - **属性 8：租户数据隔离**
    - **验证：需求 5.5、7.4、9.1、9.2、9.3**

  - [ ]* 9.3 编写自定义域名路由集成测试
    - 验证绑定自定义域名后可通过域名直接路由，无需 `X-Tenant-ID` Header
    - _需求：2.5、8.2_

- [x] 10. 最终检查点 — 确保所有测试通过
  - 确保所有单元测试、属性测试和集成测试全部通过，如有疑问请向用户确认。

## 备注

- 标有 `*` 的子任务为可选项，可在 MVP 阶段跳过以加快交付
- 每个任务均引用了具体需求条款，便于追溯
- 属性测试使用 `fast-check` 库，每个属性最少运行 100 次迭代
- 集成测试使用 Miniflare 模拟 Cloudflare 运行时，避免真实 API 调用
- 检查点任务确保每个阶段的增量验证
