# UPAIego 设备管理网站 — 数据库说明文档

| 文档属性 | 说明 |
|---------|------|
| 版本 | 1.0 |
| 适用范围 | 网站（React SPA）+ 板端 ROS2 Bridge 所对接的云端数据库 |
| 数据库产品 | Supabase（托管 PostgreSQL） |
| 主要数据表 | `public.devices` |
| 关联系统表 | `auth.users`（Supabase Auth，设备归属外键） |

---

## 1. 概述

### 1.1 设计目标

- 为每台硬件设备维护**全局唯一**的业务主键与可读名称。
- 支持**多租户隔离**：每个登录用户仅能访问本人名下的设备记录（行级安全策略 RLS）。
- 承载**设备台账**（注册信息、生命周期状态、校准元数据）与**运行态扩展**（最近在线时间、心跳备注、JSON 校准/运行时快照）。

### 1.2 技术栈与访问方式

| 访问方 | 连接方式 | 说明 |
|--------|----------|------|
| 网站前端 | Supabase JS Client → PostgREST（`/rest/v1/`） | 使用 `anon` key + 用户 JWT，受 RLS 约束 |
| 板端 ROS2 Web Bridge | HTTPS `PATCH`/`GET` | 使用 `service_role` 或具备写权限的 key（部署时需与 RLS 策略一致，见第 6 节） |
| 运维 CLI / 可选 FastAPI | `DATABASE_URL`（PostgreSQL）或 HTTP API | 本地开发可用 SQLite，与云端 schema 可能不完全一致 |

### 1.3 逻辑 ER 关系

```
auth.users (id)
     │
     │ 1 : N
     ▼
public.devices (user_id → auth.users.id)
```

---

## 2. 表清单

| 序号 | Schema | 表名 | 中文名称 | 用途摘要 |
|------|--------|------|----------|----------|
| 1 | `public` | `devices` | 设备主数据表 | 设备注册、状态、校准、心跳回写字段 |
| 2 | `auth` | `users` | 用户表 | Supabase 托管；`devices.user_id` 外键引用 |

> 网站业务侧**仅显式使用** `public.devices`；`auth.users` 由 Supabase Auth 维护，不在应用内建表。

---

## 3. 表结构：`public.devices`

### 3.1 字段定义（与代码/产品一致的目标模型）

以下字段集合综合了 `frontend/src/api/client.ts`（写入与查询）、`board/ros2_web_bridge/ros2_web_bridge/node.py`（心跳 PATCH）、`README.md` 中的 schema 说明。生产环境应在 Supabase 中保证列齐全且类型一致。

| 列名 | 数据类型（PostgreSQL） | 空 | 默认值 | 约束 | 说明 |
|------|------------------------|----|--------|------|------|
| `device_id` | `TEXT` | NOT NULL | — | **PRIMARY KEY** | 设备全局唯一 ID，一般为 UUID 字符串 |
| `user_id` | `UUID` | NOT NULL | — | `REFERENCES auth.users(id) ON DELETE CASCADE` | 设备归属用户；网站所有查询均带 `user_id` 过滤 |
| `readable_name` | `TEXT` | NOT NULL | — | **UNIQUE** | 人类可读短名，站内自增数字串（如 `1`、`2`） |
| `serial_id` | `TEXT` | YES | `NULL` | — | 板卡 CPU 序列号等硬件标识 |
| `machine_id` | `TEXT` | YES | `NULL` | — | 预留：机器标识（`DEPLOYMENT.md` 初始 DDL 中含此项） |
| `hostname` | `TEXT` | YES | `NULL` | — | 预留：主机名（同上） |
| `registered_at` | `TIMESTAMPTZ` | YES | `NULL` | — | 注册时间（UTC） |
| `last_seen` | `TIMESTAMPTZ` | YES | `NULL` | — | 最近心跳或人工更新触达时间；前端据此推导在线/离线展示 |
| `calibration_status` | `TEXT` | NOT NULL | `'pending'` | — | 建议取值：`pending` \| `calibrated` \| `needs_recalibration` |
| `calibration_date` | `TIMESTAMPTZ` | YES | `NULL` | — | 最近校准完成时间 |
| `status` | `TEXT` | NOT NULL | `'active'` | — | 建议取值：`active` \| `inactive` \| `maintenance` \| `retired`（删除操作为软删除时写 `retired`） |
| `firmware_version` | `TEXT` | YES | `NULL` | — | 固件版本；心跳可覆盖更新 |
| `notes` | `TEXT` | YES | `NULL` | — | 自由文本备注；心跳会写入摘要文本 |
| `calibration` | `JSONB` | YES | `NULL` | — | 校准与**运行时**扩展数据；板端写入 `calibration.runtime`（CPU、录像状态、可选 Base64 缩略图等） |

### 3.2 主键与唯一性

- **主键**：`device_id`（单表单主键，便于 REST 资源定位与板端按 ID 过滤）。
- **唯一约束**：`readable_name` 全局唯一（注意：若多用户各自一套命名空间，当前模型为**全局**唯一，非 per-user unique；如需按用户唯一，应改为 `(user_id, readable_name)` 联合唯一并调整业务逻辑）。

### 3.3 外键与级联

- `user_id` → `auth.users(id)`，`ON DELETE CASCADE`：用户删除时其名下设备记录一并删除（与 `DEPLOYMENT.md` 示例一致）。

### 3.4 索引建议

| 索引名（建议） | 列 | 类型 | 用途 |
|----------------|-----|------|------|
| `devices_pkey` | `device_id` | 主键索引 | 按 ID 点查、板端 `device_id=eq.` 过滤 |
| `devices_readable_name_key` | `readable_name` | 唯一索引 | 名称冲突校验、二维码展示 |
| `devices_user_id_idx` | `user_id` | B-tree | 列表页 `eq('user_id', uid)` 与分页 |
| （可选）`devices_last_seen_idx` | `last_seen DESC` | B-tree | 运营报表、按活跃度排序 |

---

## 4. 数据字典（业务语义）

| 字段 | 写入来源（典型） | 业务含义 |
|------|------------------|----------|
| `device_id` | 网站注册 / 后端生成 | 不可变设备主键 |
| `user_id` | 网站注册（当前登录用户） | 多租户隔离键 |
| `readable_name` | 网站按已有设备名自增生成 | 现场贴码、口头沟通用短名 |
| `serial_id` | 网站表单或 CLI 检测 | 硬件溯源 |
| `registered_at` / `last_seen` | 注册与每次更新/心跳 | 审计与在线推断 |
| `calibration_status` / `calibration_date` | 运营人员在详情页维护 | 标定流程状态 |
| `status` | 运营维护；删除=置 `retired` | 生命周期 |
| `firmware_version` | 运营或板端心跳 | 版本治理 |
| `notes` | 运营或板端心跳（后者会覆盖式写入摘要） | 说明与诊断摘要 |
| `calibration` | 运营或板端心跳 JSON | 结构化标定数据 + `runtime` 运行时快照 |

### 4.1 `calibration` JSON 约定（板端心跳）

板端 `WebBridgeNode` 在 PATCH 时写入嵌套结构（示例键名，以实际 JSON 为准）：

- `calibration.runtime.powered_on`
- `calibration.runtime.is_recording`
- `calibration.runtime.recording_duration_sec`
- `calibration.runtime.recording_dir`
- `calibration.runtime.cpu_usage_percent`
- `calibration.runtime.latest_frame_jpeg_base64`（可选，体积大，注意行宽与带宽）
- `calibration.runtime.latest_frame_at`
- `calibration.runtime.updated_at`

前端在设备详情页读取上述路径用于展示 CPU 与最新帧图片。

---

## 5. 行级安全（RLS）

### 5.1 策略目标

确保：**仅当 `auth.uid() = devices.user_id` 时**，该 JWT 对应用户可对本行执行 `SELECT` / `INSERT` / `UPDATE` / `DELETE`。

### 5.2 参考 SQL（与仓库 `DEPLOYMENT.md` 一致）

```sql
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own devices" ON devices
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own devices" ON devices
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own devices" ON devices
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own devices" ON devices
    FOR DELETE USING (auth.uid() = user_id);
```

### 5.3 板端服务账号与 RLS

- 若板端使用 **anon + 无用户 JWT**，在 RLS 开启时通常**无法**更新任意设备行。
- 常见做法（需运维在 Supabase 控制台配置，**不在本仓库 DDL 中固定**）：
  - 使用 **service_role** key（仅服务器侧，禁止暴露到浏览器）；或
  - 增加独立策略：例如限定 `service_role` / 自定义 claim / 按 `device_id` 与预共享密钥的 Edge Function 代理。

**文档结论**：网站浏览器路径依赖 RLS + 用户登录；板端直连需单独设计策略或走后端代理，否则与当前示例 RLS 冲突。

---

## 6. 与仓库内 DDL 的差异说明（运维必读）

根目录 `DEPLOYMENT.md` 中的初始 `CREATE TABLE` **未包含** `serial_id` 与 `calibration` 列，而网站与板端代码**会使用**这些列。若仅执行了旧版 SQL，请补列：

```sql
ALTER TABLE devices ADD COLUMN IF NOT EXISTS serial_id TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS calibration JSONB;
```

本地/测试用 **SQLite**（`backend/app/database.py` 默认）由 SQLAlchemy 模型建表，字段与 PostgreSQL 云端可能不完全一致；以 **Supabase 生产库** 为准做变更管理。

---

## 7. 参考 DDL（推荐一键建表）

以下脚本在 `DEPLOYMENT.md` 基础上补全网站所需列，并保留可选 `machine_id` / `hostname`：

```sql
CREATE TABLE IF NOT EXISTS public.devices (
    device_id            TEXT PRIMARY KEY,
    user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    readable_name        TEXT NOT NULL UNIQUE,
    serial_id            TEXT,
    machine_id           TEXT,
    hostname             TEXT,
    registered_at        TIMESTAMPTZ,
    last_seen            TIMESTAMPTZ,
    calibration_status   TEXT NOT NULL DEFAULT 'pending',
    calibration_date     TIMESTAMPTZ,
    status               TEXT NOT NULL DEFAULT 'active',
    firmware_version     TEXT,
    notes                TEXT,
    calibration          JSONB
);

CREATE INDEX IF NOT EXISTS devices_user_id_idx ON public.devices (user_id);
```

随后在 Supabase SQL Editor 中执行第 5.2 节 RLS 策略。

---

## 8. 变更与版本管理建议

- 所有 DDL 变更通过 **Supabase Migration** 或受控 SQL 脚本记录版本号。
- 对 `calibration` 大 JSON 的变更应评估**单行大小**与 API 响应时间。
- `notes` 被心跳覆盖时，若需保留人工备注，应在产品层拆字段或改合并策略（当前代码行为为覆盖式写入，见板端实现）。

---

## 9. 相关代码索引

| 模块 | 路径 | 说明 |
|------|------|------|
| 前端类型与 CRUD | `frontend/src/api/client.ts` | `Device` 接口与 Supabase 读写 |
| 板端心跳 PATCH | `board/ros2_web_bridge/ros2_web_bridge/node.py` | 更新 `last_seen`、`notes`、`calibration` 等 |
| 后端 ORM（非 Supabase 时） | `backend/app/models.py` | SQLite 等环境下的 `Device` 映射 |
| 部署与初始 SQL | `DEPLOYMENT.md` | 建表与 RLS 示例 |
| 文档化 schema 摘要 | `README.md` | 字段列表说明 |

---

## 10. 附录：枚举取值（约定非数据库枚举类型）

当前表以 `TEXT` 存储状态，应用层约定如下（与前后端筛选选项一致）：

**`status`**：`active`、`inactive`、`maintenance`、`retired`  
**`calibration_status`**：`pending`、`calibrated`、`needs_recalibration`

---

*本文档描述以仓库当前代码与部署文档为据；若生产环境已做定制迁移，请在变更后同步修订本文档版本号与修订记录。*
