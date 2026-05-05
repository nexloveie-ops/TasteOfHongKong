# LZFood 多店数据库设计

> **范围**：仅描述部署在 **LZFood**（新 MongoDB 集群）上的 **多租户** 库结构。  
> **约束**：LZFood **数据**与单店库分离；单店运行时仍用 `DBCON` 与默认 `mongoose` 连接。为复用字段定义，部分单店文件 **额外 export Schema**（如 `OptionGroupTemplateSchema`），不改变单店集合行为。  
> **业务字段**：与当前单店集合语义对齐，在此基础上增加 **`storeId`**（及租户主档 **`stores`**），演化规则见 `docs/multi-store-spec.md`。

**安全**：连接 URI **只放在部署环境变量**中（建议名称 `LZFOOD_DBCON` 或 `MULTI_STORE_DBCON`），**禁止**提交到 Git。若在聊天等场合泄露过密码，请在 Atlas **轮换数据库用户密码**。

---

## 1. 设计原则

1. **一库多租户**：同一数据库内用 `storeId`（`ObjectId`，引用 `stores._id`）隔离租户数据。
2. **集合与单店对照**：集合名、子文档形状尽量与现网单店一致，便于对照实现与测试；差异主要是 **复合唯一键**、**查询必带 `storeId`**。
3. **引用完整性**：`MenuItem.categoryId`、`Order.items[].menuItemId` 等引用 **须指向同一 `storeId` 下** 的文档（由应用层校验；不在 MongoDB 做跨集合 FK）。
4. **slug**：`stores.slug` **全库唯一**、**创建后不可改**（仅应用层也可，建议加 MongoDB 层只读约定）。

---

## 2. 连接与库名

- 使用 Atlas 提供的 URI；建议在 URI 中指定 **database 名称**，例如：  
  `mongodb+srv://.../lzfood?appName=LZFood`  
  具体库名以你 Atlas 实际为准，下文称 **业务库** `lzfood`（可替换）。
- 单店实例继续使用现有 `DBCON`（或项目当前变量名），**互不共用**。

---

## 3. 新增集合：`stores`（租户主档）

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | ObjectId | 主键；各业务表 `storeId` 指向此字段。 |
| `slug` | String | URL 段，**唯一**，小写规范 `^[a-z0-9-]+$`（建议），**创建后不可改**。 |
| `displayName` | String | 展示名称，**可改**。 |
| `status` | String | 建议枚举：`active` \| `suspended` \| `expired`（或再细分；与「到期后仅保留数据」策略一致）。 |
| `subscriptionStartsAt` | Date | 可用期开始；默认 = 创建时间。 |
| `subscriptionEndsAt` | Date | **权威结束时间**（与规格一致：手填结束日为准，天数仅快捷推算）。 |
| `retentionEndsAt` | Date | 可选；**订阅结束后数据保留截止**（如 `subscriptionEndsAt + 90 天`），供定时任务/人工清理参考。 |
| `createdAt` / `updatedAt` | Date | `timestamps: true`。 |

**索引**

- `{ slug: 1 }` **unique**
- `{ status: 1, subscriptionEndsAt: 1 }`（列表、到期扫描，可选）

---

## 4. 新增集合：`admin_audit_logs`（平台代操作审计）

满足 `multi-store-spec`：记录 **谁、何时、目标店、关键操作**。

| 字段 | 类型 | 说明 |
|------|------|------|
| `actorAdminId` | ObjectId | 执行人 `admins._id`。 |
| `actorRole` | String | 快照，如 `platform_owner`。 |
| `targetStoreId` | ObjectId | 被操作的店；平台级动作可为 `null`。 |
| `action` | String | 稳定枚举或点分命名，如 `store.extend_subscription`、`order.update_status`。 |
| `resourceType` | String | 可选，如 `Order`、`Checkout`。 |
| `resourceId` | ObjectId | 可选。 |
| `metadata` | Mixed | 可选；避免存敏感明文。 |
| `createdAt` | Date | 默认 `Date.now`。 |

**索引**

- `{ targetStoreId: 1, createdAt: -1 }`
- `{ actorAdminId: 1, createdAt: -1 }`

---

## 5. 演进集合（相对单店模型增加 `storeId`）

以下集合在 LZFood 中 **均增加** `storeId: ObjectId`，`ref: 'Store'`，**必填**（创建/更新时必填）。  
子文档结构、枚举与现网 **保持一致**，除非另有说明。

### 5.1 `admins`

| 变更 | 说明 |
|------|------|
| `role` | 枚举扩展为 **`owner`** \| **`cashier`** \| **`platform_owner`**。 |
| `storeId` | `owner` / `cashier` **必填**，指向 `stores._id`。 |
| `storeId` | **`platform_owner` 不设或置 `null`**（推荐字段省略或显式 null，二选一并统一）。 |

**唯一性（建议索引）**

- 店内账号：`{ storeId: 1, username: 1 }` **unique**，`partialFilterExpression: { storeId: { $exists: true, $type: 'objectId' } }`（或与你们 Mongoose 存法一致）。
- 平台账号：`{ username: 1 }` **unique**，`partialFilterExpression: { role: 'platform_owner' }`。

（若采用「平台用户也挂虚拟 storeId」的单一复合唯一方案，需在实现说明里单独写清；本文按规格 **platform_owner 不归属某店** 描述。）

### 5.2 `menu_categories` / `menu_items` / `allergens`

- 各增加 `storeId`（必填）。
- 店内引用（如 `MenuItem.categoryId`、`allergenIds`）仅指向 **同 `storeId`** 文档。

### 5.3 `option_group_templates` / `option_group_template_rules`

- 各增加 `storeId`（必填）。  
- `templateId`、规则中的 `categoryIds` / `menuItemIds` 均限定同店。

### 5.4 `offers` / `coupons`

- 各增加 `storeId`（必填）。

### 5.5 `orders`

- 增加 `storeId`（必填）。  
- 其余字段与现网 `Order` 一致（`type`、`tableNumber`、`status`、`items`、嵌套 `appliedBundles` 等）。

### 5.6 `checkouts`

- 增加 `storeId`（必填）。  
- `orderIds` 内订单必须同属该 `storeId`。

### 5.7 `daily_order_counters`

单店：`date` 全局唯一。  
多店：**复合唯一** `{ storeId: 1, date: 1 }`；`date` 仍为 `YYYY-MM-DD` 字符串。

### 5.8 `system_configs`

单店：`key` 全局唯一。  
多店：**复合唯一** `{ storeId: 1, key: 1 }`。  
小票、店名、地址、Stripe 相关键等 **均按店隔离**（与 `multi-store-spec` 一致）。

---

## 6. 预留（非现网模型，LZFood 可先建集合或后续再加）

与 `docs/membership-module-spec.md` 一致，会员 **按店独立**：

- `members`：`storeId` + 手机唯一（建议复合唯一 `(storeId, phone)`）。
- `member_transactions`：`storeId`、`memberId`、`checkoutId` 等。

当前阶段若未开发会员，可 **不创建** 或仅留空集合。

---

## 7. 与单店库的隔离方式（工程约定）

| 项 | 单店（现有） | 多店（LZFood） |
|----|----------------|----------------|
| 连接串环境变量 | 现有变量（如 `DBCON`） | **新变量**，例如 `LZFOOD_DBCON` |
| Mongoose 模型文件 | `backend/src/models/*` **不改** | 后续可新增 `backend/src/models-lzfood/*` 或独立 npm 包，由 **仅多店路由** 引用 |
| 数据 | 原库 | **仅** LZFood 业务库 |

实现上已采用 **第二 connection**（`LZFOOD_DBCON`）并在其上注册模型，代码目录：`backend/src/models-lzfood/`（`registerLZFoodModels(conn)`，启动见 `server.ts`）。业务路由仍须 **只使用** `getLZFoodModels()` / 传入的 `conn`，勿与默认 `mongoose.model` 混用。

---

## 8. 校验清单（落地库时自检）

- [ ] 所有业务集合查询、更新、聚合 **默认条件**含 `storeId`（防串店）。
- [ ] `DailyOrderCounter`、`SystemConfig` 已从「单键唯一」改为 **复合唯一**。
- [ ] `stores.slug` 唯一且不变更；展示名可改。
- [ ] `admins` 角色与唯一索引与平台/店内账号规则一致。
- [ ] 审计日志写入与 `platform_owner` 代操作路径配套。

---

## 9. 参考

- 产品：`docs/multi-store-spec.md`
- 单店字段对照：`backend/src/models/*.ts`（**只读参考，不修改**）
