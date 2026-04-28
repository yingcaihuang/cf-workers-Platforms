# 需求文档

## 简介

本功能基于 Cloudflare Workers for Platforms 构建一个多租户 Todo List 应用平台。平台运营方（Platform Owner）通过 Dispatch Worker 统一接入流量，并将请求路由至各租户的 User Worker。每个租户拥有独立的 D1 数据库和 KV 命名空间，实现数据完全隔离。租户可通过 REST API 管理自己的 Todo 事项，并支持绑定自定义域名。

---

## 词汇表

- **Platform**：整个多租户 Todo List 平台，由平台运营方管理。
- **Dispatch_Worker**：平台层的入口 Worker，负责识别租户身份并将请求分发至对应的 User_Worker。
- **User_Worker**：每个租户独立部署的 Worker 脚本，处理该租户的业务逻辑。
- **Tenant**：平台的使用方，拥有独立的资源绑定（D1、KV）和可选的自定义域名。
- **Tenant_API_Key**：用于标识和验证租户身份的密钥，由平台颁发。
- **D1_Database**：Cloudflare D1 SQLite 数据库，每个租户独立绑定，存储 Todo 数据。
- **KV_Namespace**：Cloudflare Workers KV，每个租户独立绑定，存储租户配置和会话信息。
- **Todo**：一条待办事项记录，包含 id、title、description、status、created_at、updated_at 字段。
- **Todo_Status**：Todo 的状态，取值为 `pending`（待处理）或 `completed`（已完成）。
- **Platform_Admin_API**：平台运营方用于管理租户生命周期的管理接口。
- **Tenant_REST_API**：租户用于操作自身 Todo 数据的 REST 接口。

---

## 需求

### 需求 1：租户注册与资源绑定

**用户故事：** 作为平台运营方，我希望能够注册新租户并为其绑定独立的云资源，以便每个租户拥有完全隔离的运行环境。

#### 验收标准

1. THE **Platform_Admin_API** SHALL 提供创建租户的接口，接受租户名称（唯一标识，仅含字母、数字和连字符，长度 3–63 位）作为必填参数。
2. WHEN 租户创建请求被接收，THE **Platform** SHALL 为该租户生成唯一的 **Tenant_API_Key**，并在响应中返回。
3. WHEN 租户创建成功，THE **Platform** SHALL 为该租户自动创建并绑定一个独立的 **D1_Database** 实例。
4. WHEN 租户创建成功，THE **Platform** SHALL 为该租户自动创建并绑定一个独立的 **KV_Namespace** 实例。
5. WHEN 租户创建成功，THE **Platform** SHALL 在 **D1_Database** 中初始化 Todo 数据表结构。
6. IF 租户名称已存在，THEN THE **Platform_Admin_API** SHALL 返回 HTTP 409 状态码及描述性错误信息。
7. IF 租户名称格式不合法，THEN THE **Platform_Admin_API** SHALL 返回 HTTP 400 状态码及描述性错误信息。
8. THE **Platform_Admin_API** SHALL 提供删除租户的接口，删除时同步清理该租户的 **D1_Database**、**KV_Namespace** 及 **User_Worker** 绑定。
9. THE **Platform_Admin_API** SHALL 提供查询所有租户列表的接口，返回租户名称、创建时间及状态。

---

### 需求 2：请求路由与租户识别

**用户故事：** 作为平台运营方，我希望 Dispatch Worker 能够根据请求自动识别目标租户并路由流量，以便实现统一入口的多租户分发。

#### 验收标准

1. WHEN 请求到达 **Dispatch_Worker**，THE **Dispatch_Worker** SHALL 从请求的 `X-Tenant-ID` Header 中提取租户标识。
2. WHEN 租户标识提取成功，THE **Dispatch_Worker** SHALL 将请求转发至对应租户的 **User_Worker**。
3. IF 请求中缺少 `X-Tenant-ID` Header，THEN THE **Dispatch_Worker** SHALL 返回 HTTP 400 状态码及描述性错误信息。
4. IF `X-Tenant-ID` 对应的租户不存在，THEN THE **Dispatch_Worker** SHALL 返回 HTTP 404 状态码及描述性错误信息。
5. WHERE 租户已绑定自定义域名，THE **Dispatch_Worker** SHALL 支持通过自定义域名直接路由，无需 `X-Tenant-ID` Header。
6. WHILE **User_Worker** 处理请求期间，THE **Dispatch_Worker** SHALL 保持请求的原始 Method、Path、Headers 和 Body 不变地传递。

---

### 需求 3：租户身份验证

**用户故事：** 作为租户，我希望通过 API Key 验证身份，以便只有授权用户才能操作我的 Todo 数据。

#### 验收标准

1. WHEN 请求到达 **User_Worker**，THE **User_Worker** SHALL 从请求的 `Authorization` Header 中提取 Bearer Token 作为 **Tenant_API_Key**。
2. WHEN **Tenant_API_Key** 提取成功，THE **User_Worker** SHALL 在 **KV_Namespace** 中验证该 Key 的有效性。
3. IF `Authorization` Header 缺失或格式不符合 `Bearer <token>` 规范，THEN THE **User_Worker** SHALL 返回 HTTP 401 状态码及描述性错误信息。
4. IF **Tenant_API_Key** 验证失败，THEN THE **User_Worker** SHALL 返回 HTTP 401 状态码及描述性错误信息。
5. WHILE **Tenant_API_Key** 验证通过，THE **User_Worker** SHALL 仅允许访问该租户自身的 **D1_Database** 数据。

---

### 需求 4：Todo 创建

**用户故事：** 作为租户，我希望能够创建新的 Todo 事项，以便记录和管理我的待办任务。

#### 验收标准

1. WHEN 收到合法的 Todo 创建请求（POST `/todos`），THE **User_Worker** SHALL 在该租户的 **D1_Database** 中插入一条新的 **Todo** 记录。
2. THE **User_Worker** SHALL 为新创建的 **Todo** 生成全局唯一的 `id`（UUID v4 格式）。
3. THE **User_Worker** SHALL 将新创建的 **Todo** 的 `status` 初始化为 `pending`。
4. THE **User_Worker** SHALL 将新创建的 **Todo** 的 `created_at` 和 `updated_at` 设置为当前 UTC 时间（ISO 8601 格式）。
5. WHEN Todo 创建成功，THE **User_Worker** SHALL 返回 HTTP 201 状态码及完整的 **Todo** 对象（JSON 格式）。
6. IF 请求体中缺少必填字段 `title`，THEN THE **User_Worker** SHALL 返回 HTTP 400 状态码及描述性错误信息。
7. IF `title` 字段长度超过 255 个字符，THEN THE **User_Worker** SHALL 返回 HTTP 400 状态码及描述性错误信息。
8. WHERE `description` 字段由请求方提供，THE **User_Worker** SHALL 将其存储至 **D1_Database**；未提供时存储为空字符串。

---

### 需求 5：Todo 查询

**用户故事：** 作为租户，我希望能够查询我的 Todo 列表和单条 Todo 详情，以便了解当前任务状态。

#### 验收标准

1. WHEN 收到 Todo 列表查询请求（GET `/todos`），THE **User_Worker** SHALL 返回该租户 **D1_Database** 中所有 **Todo** 记录（JSON 数组格式），默认按 `created_at` 降序排列。
2. WHERE 请求包含 `status` 查询参数（值为 `pending` 或 `completed`），THE **User_Worker** SHALL 仅返回匹配该状态的 **Todo** 记录。
3. WHEN 收到单条 Todo 查询请求（GET `/todos/:id`），THE **User_Worker** SHALL 返回该租户 **D1_Database** 中对应 `id` 的 **Todo** 记录（JSON 格式）。
4. IF 查询的 `id` 在该租户的 **D1_Database** 中不存在，THEN THE **User_Worker** SHALL 返回 HTTP 404 状态码及描述性错误信息。
5. THE **User_Worker** SHALL 确保租户 A 的查询请求无法访问租户 B 的 **Todo** 数据。

---

### 需求 6：Todo 更新

**用户故事：** 作为租户，我希望能够更新 Todo 的内容和状态，以便维护任务的最新信息。

#### 验收标准

1. WHEN 收到合法的 Todo 更新请求（PATCH `/todos/:id`），THE **User_Worker** SHALL 更新该租户 **D1_Database** 中对应 **Todo** 的指定字段。
2. THE **User_Worker** SHALL 支持在单次请求中更新 `title`、`description`、`status` 中的一个或多个字段。
3. WHEN Todo 更新成功，THE **User_Worker** SHALL 将该 **Todo** 的 `updated_at` 更新为当前 UTC 时间（ISO 8601 格式）。
4. WHEN Todo 更新成功，THE **User_Worker** SHALL 返回 HTTP 200 状态码及更新后的完整 **Todo** 对象（JSON 格式）。
5. IF 更新请求中的 `status` 值不为 `pending` 或 `completed`，THEN THE **User_Worker** SHALL 返回 HTTP 400 状态码及描述性错误信息。
6. IF 更新请求中的 `title` 字段长度超过 255 个字符，THEN THE **User_Worker** SHALL 返回 HTTP 400 状态码及描述性错误信息。
7. IF 请求的 `id` 在该租户的 **D1_Database** 中不存在，THEN THE **User_Worker** SHALL 返回 HTTP 404 状态码及描述性错误信息。
8. IF 更新请求体为空或不包含任何可更新字段，THEN THE **User_Worker** SHALL 返回 HTTP 400 状态码及描述性错误信息。

---

### 需求 7：Todo 删除

**用户故事：** 作为租户，我希望能够删除不再需要的 Todo 事项，以便保持任务列表的整洁。

#### 验收标准

1. WHEN 收到合法的 Todo 删除请求（DELETE `/todos/:id`），THE **User_Worker** SHALL 从该租户的 **D1_Database** 中永久删除对应的 **Todo** 记录。
2. WHEN Todo 删除成功，THE **User_Worker** SHALL 返回 HTTP 204 状态码，响应体为空。
3. IF 请求的 `id` 在该租户的 **D1_Database** 中不存在，THEN THE **User_Worker** SHALL 返回 HTTP 404 状态码及描述性错误信息。
4. THE **User_Worker** SHALL 确保租户 A 的删除请求无法删除租户 B 的 **Todo** 数据。

---

### 需求 8：自定义域名绑定

**用户故事：** 作为租户，我希望能够为我的 Todo API 绑定自定义域名，以便通过专属域名访问服务。

#### 验收标准

1. THE **Platform_Admin_API** SHALL 提供为指定租户绑定自定义域名的接口，接受租户名称和域名作为参数。
2. WHEN 自定义域名绑定请求被接收，THE **Platform** SHALL 通过 Cloudflare Workers for Platforms API 将该域名路由至对应租户的 **User_Worker**。
3. WHEN 自定义域名绑定成功，THE **Platform_Admin_API** SHALL 返回 HTTP 200 状态码及绑定确认信息。
4. IF 指定的域名已被其他租户绑定，THEN THE **Platform_Admin_API** SHALL 返回 HTTP 409 状态码及描述性错误信息。
5. IF 指定的租户不存在，THEN THE **Platform_Admin_API** SHALL 返回 HTTP 404 状态码及描述性错误信息。
6. THE **Platform_Admin_API** SHALL 提供解绑自定义域名的接口，解绑后该域名不再路由至任何 **User_Worker**。

---

### 需求 9：数据隔离保证

**用户故事：** 作为平台运营方，我希望平台在架构层面保证租户间数据完全隔离，以便满足安全合规要求。

#### 验收标准

1. THE **Platform** SHALL 为每个租户分配独立的 **D1_Database** 实例，不同租户的 **D1_Database** 实例相互独立。
2. THE **Platform** SHALL 为每个租户分配独立的 **KV_Namespace** 实例，不同租户的 **KV_Namespace** 实例相互独立。
3. THE **User_Worker** SHALL 仅能访问通过 Cloudflare Workers for Platforms 绑定至该租户的 **D1_Database** 和 **KV_Namespace**，无法访问其他租户的资源绑定。
4. WHEN **Dispatch_Worker** 将请求转发至 **User_Worker** 时，THE **Dispatch_Worker** SHALL 通过 `dispatchNamespace.get(tenantId, { bindings: { DB: tenantD1, KV: tenantKV } })` 方式注入租户专属资源绑定。
5. IF 任意 **User_Worker** 尝试访问未绑定的资源，THEN THE **User_Worker** SHALL 收到运行时错误，而非访问到其他租户的数据。
