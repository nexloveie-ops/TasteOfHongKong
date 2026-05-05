# LZFood 数据层：单店 vs 多店、完成度说明

## 1. 单店模式（现有 `DBCON` 库）数据长什么样

逻辑上只有 **一个餐馆**：所有文档属于同一租户，**没有** `storeId`。

| 集合名 | 单店语义 | 典型唯一 / 范围 |
|--------|----------|-----------------|
| `admins` | 全局后台账号 | `username` 全库唯一；`role` ∈ `owner` \| `cashier` |
| `menu_categories` | 菜单分类 | 无租户键 |
| `menu_items` | 菜品 | `categoryId` 指向本库分类 |
| `allergens` | 过敏原 | 无租户键 |
| `option_group_templates` | 选项组模板 | 无租户键 |
| `option_group_template_rules` | 模板应用规则 | 无租户键 |
| `offers` | 套餐 | 无租户键 |
| `coupons` | 优惠券 | 无租户键 |
| `orders` | 订单 | 堂食/外卖编号等在**全库**内可区分 |
| `checkouts` | 结账 | 无租户键 |
| `daily_order_counters` | 外卖日序号 | **`date` 全库唯一**（一天一行） |
| `system_configs` | KV 配置（店名、Stripe、小票等） | **`key` 全库唯一** |

结论：单店 = **隐式单租户**，靠「整库只属于一家店」保证隔离。

---

## 2. 多店模式（`LZFOOD_DBCON` 库）与单店的本质区别

| 维度 | 单店库 | LZFood 多店库 |
|------|--------|----------------|
| 租户 | 隐式 1 家 | 显式 **N 家**，每文档带 **`storeId` → `stores._id`**（除 `platform_owner` 等规则外） |
| 租户主档 | 无 | **`stores`**：`slug`、展示名、状态、订阅起止、保留期等 |
| 审计 | 无 | **`admin_audit_logs`**：平台代操作 |
| `admins` | `owner` / `cashier` | 增加 **`platform_owner`**；店内账号 **`storeId` 必填**；唯一性改为 **店内 `(storeId, username)`** + **平台 `username`（partial）** |
| `daily_order_counters` | `date` 唯一 | **`(storeId, date)` 唯一**（每家店每天一行） |
| `system_configs` | `key` 唯一 | **`(storeId, key)` 唯一**（配置按店） |
| 引用 | 同库即可 | **应用层保证** `MenuItem`、`Order` 等同 `storeId`，禁止跨店引用 |

业务字段（订单行、结账金额、菜单嵌套等）与单店 **保持一致**，多店只是在「同一套形状」上 **多挂一维 `storeId`**，并新增 **`stores` / `admin_audit_logs`**。

---

## 3. 「数据层」在当前项目里算完成了吗？

可以分三层理解：

| 层次 | 状态 | 说明 |
|------|------|------|
| **概念与文档** | ✅ | `docs/lzfood-database-design.md`、本文、产品 `docs/multi-store-spec.md` |
| **模式与代码** | ✅ | `backend/src/models-lzfood/`：Schema、注册、`registerLZFoodModels`；单店 Schema 仅必要时 **export** 供克隆，不改变单店运行时行为 |
| **新库里「表」** | ✅（启动后） | MongoDB **没有**传统建表语句；集合在 **首次写入** 或 **`createIndexes()`** 时出现。启动时在 LZFood 连接上执行 **`ensureLZFoodIndexes`**，会在 Atlas 上 **创建空集合（若不存在）并建好索引**，等价于在新库落好多店侧结构 |

**尚未包含（不叫「数据层未完成」，而是下一阶段）：**

- 把**旧单店库里的业务数据** **导入** LZFood（需写迁移脚本 + 指定目标 `storeId`）。
- **种子数据**（演示店、首个 `platform_owner`）——可选脚本。
- **前端 `/:slug` 路由**与 **平台后台** UI 仍为后续工作；后端 API 已按店铺上下文读写。

---

## 4. 集合清单（LZFood 与单店对照）

与单店 **同名集合**（多一列 `storeId` 或改唯一键）：  
`menu_categories`、`menu_items`、`allergens`、`option_group_templates`、`option_group_template_rules`、`offers`、`coupons`、`orders`、`checkouts`、`daily_order_counters`、`system_configs`、`admins`。

**仅多店有：** `stores`、`admin_audit_logs`。

---

## 5. API 店铺上下文（运行时）

除 `POST /api/auth/login` 外，所有 `/api/*` 请求需能解析店铺：

- 请求头 **`X-Store-Slug`**，或查询参数 **`storeSlug`**，或环境变量 **`DEFAULT_STORE_SLUG`**（开发便利）。
- 登录 body 内账号需传 **`slug`**（与上述店铺一致），JWT 携带 **`storeId`**；已登录请求由中间件校验令牌与店铺一致。

## 6. 如何自检 Atlas 里是否已有「表」

1. 配置 **`LZFOOD_DBCON` 或 `DBCON`**（`connectDB` 优先前者）后 **启动一次后端**。
2. 在 Atlas / Compass 中查看该集群数据库：应出现上述集合名（可能为空），且 **Indexes** 与 Schema 一致。

若未启动服务、从未连过 LZFood，则新库里可以暂时没有任何集合——这是 MongoDB 常态，不代表设计缺失。
