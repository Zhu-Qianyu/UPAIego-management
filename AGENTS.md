# AI / 自动化助手须知

本仓库**生产数据库与 Auth 在腾讯云 CVM 自建 Supabase**，**不在** Supabase 官方云。

**连接与部署前必读：** [docs/自建Supabase服务器连接说明.md](docs/自建Supabase服务器连接说明.md)

**硬性禁止：**

- 勿将 `VITE_SUPABASE_URL`、`DATABASE_URL` 设为 `https://*.supabase.co` 或 `*.pooler.supabase.com`
- 勿使用 / 勿照抄 `supabase/.temp/` 中的 `project-ref`（历史 ref：`xbjgyxinbjpifbllqefw`）
- 勿执行 `supabase link`、`supabase functions deploy` 指向官方云
- 勿把 `SERVICE_ROLE_KEY` 写入前端

**生产 API：** `http://146.56.200.250:8000`（或运维配置的 `https://api.<域名>`）  
**密钥来源：** 服务器 `~/supabase/docker/.env` 中的 `ANON_KEY` / `POSTGRES_PASSWORD`
