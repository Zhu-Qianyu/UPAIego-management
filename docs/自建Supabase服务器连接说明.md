# 自建 Supabase 服务器连接说明（必读）

> **给 AI 助手 / 新同事：** 本仓库**生产环境**的数据库与 Auth **不在 Supabase 官方云上**，而在 **腾讯云 CVM 自建 Docker Supabase**。  
> **禁止**把前端、CLI、迁移脚本或 `supabase link` 指向历史云端项目，否则会出现「连错库、数据对不上、注册/豆小秘异常」。

---

## 1. 用哪套环境？

| 环境 | 是否当前生产 | API 地址特征 | 说明 |
|------|--------------|--------------|------|
| **自建 CVM Supabase** | **是（唯一生产）** | `http://146.56.200.250:8000` 或 `https://api.<你的域名>` | 数据、用户、RLS、Edge Functions 均在此 |
| **Supabase 官方云（历史）** | **否，已弃用** | `https://*.supabase.co` | **不要连接、不要 link、不要 deploy functions 到云端** |

### 1.1 已弃用的云端项目（勿连）

以下为迁移前在 Supabase Dashboard 创建的项目，**仅作归档识别**，任何配置不得再使用：

| 项 | 值 |
|----|-----|
| Project ref | `xbjgyxinbjpifbllqefw` |
| 错误 URL 示例 | `https://xbjgyxinbjpifbllqefw.supabase.co` |
| 错误 DB 示例 | `postgresql://postgres.xbjgyxinbjpifbllqefw@*.pooler.supabase.com:5432/postgres` |

仓库内 **`supabase/.temp/`**（含 `linked-project.json`、`project-ref`、`pooler-url`）是本地 Supabase CLI 缓存，**不代表当前生产**；AI 修改配置时**不得**读取或照抄其中 URL/ref。

---

## 2. 生产 API 与密钥从哪里读？

### 2.1 服务器信息

| 项 | 值 |
|----|-----|
| 公网 IP | `146.56.200.250` |
| SSH 用户 | `ubuntu` |
| Supabase Docker 目录 | `~/supabase/docker` |
| Kong（REST/Auth/Functions 入口） | 容器内 `8000`；公网 `http://146.56.200.250:8000` |
| Nginx 反代（可选） | 公网 `http://146.56.200.250:80` → Kong `127.0.0.1:8000` |

SSH 密钥配置见 `scripts/server/enable_ssh_key.ps1`；**勿在仓库或对话中提交服务器密码**。

### 2.2 在服务器上查看密钥（登录后执行）

```bash
cd ~/supabase/docker
grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_EXTERNAL_URL|SUPABASE_PUBLIC_URL|POSTGRES_PASSWORD)=' .env
```

- **前端**只需要：`ANON_KEY`（写入 `VITE_SUPABASE_ANON_KEY`）
- **后端/CLI/直连 Postgres** 需要：`POSTGRES_PASSWORD` 拼 `DATABASE_URL`（见 §4）
- **`SERVICE_ROLE_KEY` 仅服务端**；禁止写入 `frontend/.env` 或提交 Git

### 2.3 健康检查

```bash
# 在服务器上
ANON=$(grep '^ANON_KEY=' ~/supabase/docker/.env | cut -d= -f2-)
curl -s "http://127.0.0.1:8000/rest/v1/profiles?select=id&limit=1" \
  -H "apikey: ${ANON}" -H "Authorization: Bearer ${ANON}"
```

返回 JSON（含 `[]` 或数据）即 API 正常。

---

## 3. 前端如何连接（`frontend/`）

复制示例并**只填自建地址**：

```bash
cd frontend
cp .env.example .env
```

```env
# 生产 / 联调自建（不要用 *.supabase.co）
VITE_SUPABASE_URL=http://146.56.200.250:8000
VITE_SUPABASE_ANON_KEY=<从服务器 ~/supabase/docker/.env 的 ANON_KEY 复制>

# 豆小秘（可选）
VITE_SCENE_AI_ENABLED=true
```

若 EdgeOne 已为 API 配了 HTTPS 域名（如 `https://api.example.com`），则：

```env
VITE_SUPABASE_URL=https://api.example.com
```

**判断连对没有：** 浏览器 DevTools → Network → 任意 Supabase 请求，Host 必须是 `146.56.200.250` 或你们的 `api.*` 域名，**不能**是 `supabase.co`。

本地开发：

```bash
npm run dev
# 默认 http://localhost:5173，仍指向上面 VITE_SUPABASE_URL 的后端
```

生产构建参考 `frontend/.env.production`（该文件 gitignore，勿提交）。

---

## 4. 后端 / CLI 如何连接 Postgres（`backend/`）

**不要**使用云端 pooler 连接串。直连自建库（在服务器上或经 SSH 隧道）：

```env
# 在 CVM 本机或 docker 网络内
DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5432/postgres
```

从开发机远程维护时，先建 SSH 隧道再连 `localhost`：

```bash
ssh -L 5432:127.0.0.1:5432 ubuntu@146.56.200.250
# 另开终端
DATABASE_URL=postgresql://postgres:<密码>@127.0.0.1:5432/postgres
```

密码同样来自 `~/supabase/docker/.env` 的 `POSTGRES_PASSWORD`。

---

## 5. SQL 迁移在哪里执行？

| 方式 | 说明 |
|------|------|
| **推荐：SSH + psql** | `sudo docker-compose exec -T db psql -U postgres -d postgres -f - < docs/XXX.sql`（在 `~/supabase/docker` 下） |
| **禁止** | 在 Supabase Cloud Dashboard SQL Editor 执行（那是已弃用项目） |
| **禁止** | `supabase db push` 指向云端 linked project |

迁移文件顺序见 `docs/从零搭建说明书.md` §5；生产库结构以 **`docs/*.sql`** 与 `schema.sql`（若从云导出备份）为准。

---

## 6. Edge Functions（豆小秘 `scene-ai-agent`）

Functions **部署在自建 CVM**，不是 `supabase functions deploy` 到官方云。

```bash
# Windows（需 SSH 凭据，密码用环境变量，勿写进仓库）
$env:DEPLOY_SSH_PASSWORD = '<密码>'
python scripts/server/deploy_via_paramiko.py

# 或服务器上
bash ~/upaiego-management/scripts/server/deploy_scene_ai_agent.sh ~/upaiego-management
```

豆包密钥在服务器 `~/supabase/docker/.env`（`ARK_API_KEY`、`ARK_MODEL` 等），见 `docs/SCENE_AI_AGENT_SETUP.md`。

---

## 7. Auth 特殊配置（手机号注册）

自建环境使用 synthetic email（`p{手机号}@upaiego.auth`），**必须**开启免邮件确认：

```bash
# 服务器 ~/supabase/docker/.env
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
```

一键修复：`bash scripts/server/fix_auth_email_autoconfirm.sh`（或 `python scripts/server/apply_auth_autoconfirm_remote.py`）。

---

## 8. AI / 自动化常见误操作清单

| 误操作 | 后果 | 正确做法 |
|--------|------|----------|
| `VITE_SUPABASE_URL=https://xxx.supabase.co` | 前端连旧库/空库 | 用 `http://146.56.200.250:8000` 或 `https://api.<域名>` |
| `supabase link --project-ref xbjgyxinbjpifbllqefw` | CLI 指向云端 | **不要 link**；改服务器 Docker 与 SQL |
| 读取 `supabase/.temp/pooler-url` 写进 `.env` | 直连错误数据库 | 只读服务器 `~/supabase/docker/.env` |
| `supabase functions deploy scene-ai-agent` 到云端 | 豆小秘不生效 | 用 `scripts/server/deploy_scene_ai_agent.*` |
| 在云端 Dashboard 改 RLS/表 | 生产无变化 | SSH 进 CVM 用 psql 执行 `docs/*.sql` |
| 把 `SERVICE_ROLE_KEY` 放进前端 | 严重安全风险 | 仅服务端/脚本使用 |

---

## 9. 相关脚本索引

| 脚本 | 用途 |
|------|------|
| `scripts/server/01_install_supabase.sh` | 首次安装 Docker Supabase |
| `scripts/server/setup_nginx_and_env.sh` | Nginx 反代 + URL/Auth 环境变量 |
| `scripts/server/fix_auth_email_autoconfirm.sh` | 关闭注册邮件确认 |
| `scripts/server/deploy_scene_ai_agent.sh` | 部署豆小秘 Edge Function |
| `scripts/server/deploy_via_paramiko.py` | 从 Windows 一键部署 Function + SQL |
| `scripts/server/upload_from_windows.ps1` | 上传 Supabase Docker 目录到 CVM |

---

## 10. 文档关系

- **本文**：生产连哪台服务器、密钥从哪来、禁止连云端。  
- **`docs/从零搭建说明书.md`**：空库从零迁移 SQL（新环境/灾备）；其中「创建 Supabase 云项目」章节对**当前生产**已不适用，以本文为准。  
- **`DEPLOYMENT.md`**：英文简版，默认假设官方云；生产部署请优先本文。  
- **`docs/DATABASE_SPECIFICATION.md`**：表结构与 RLS 说明（与部署位置无关）。

---

**最后更新：** 与自建 CVM（`146.56.200.250`）生产部署一致。若 API 域名或 IP 变更，请同步修改本文、`frontend/.env.production` 与 EdgeOne 源站配置。
