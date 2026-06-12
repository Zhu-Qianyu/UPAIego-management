# UPAIego Fleet Management

Hardware fleet and **cloud data-collection operations** for Rockchip-based boards. The system detects boards over USB-serial, registers them with auto-generated names and UUIDs, stores metadata in **Supabase (PostgreSQL)** or local **SQLite** (optional backend), generates QR codes, and ships a **React (Vite) web app** that talks to Supabase with row-level security (RLS). Optional pieces: **Python CLI / FastAPI** for provisioning, and **ROS 2 Web Bridge** on the board for heartbeat-style updates.

## What’s in this repo

| Area | Description |
|------|-------------|
| **Web UI** (`frontend/`) | Role-based SPA: device registry & search, work groups, scene tasks / party demands / workstations, executor map (Leaflet), admin KPIs and announcements. Uses `@supabase/supabase-js` and the anon key plus user JWT. |
| **Backend / CLI** (`backend/`) | Optional FastAPI server and `cli.py` for detect / register / provision / QR; uses `DATABASE_URL` (Postgres pooler or SQLite for dev). |
| **Board** (`board/ros2_web_bridge/`) | Optional ROS 2 node to PATCH device fields over HTTPS; must align with Supabase keys and RLS (see `docs/DATABASE_SPECIFICATION.md`). |
| **On-device stack** (`upaiego/`) | Separate ROS 2 package; see that tree for runtime nodes. |

## Documentation

| Doc | Language | Purpose |
|-----|----------|---------|
| [docs/自建Supabase服务器连接说明.md](docs/自建Supabase服务器连接说明.md) | 中文 | **Production:** self-hosted Supabase on CVM — URLs, keys, SSH; **do not** connect to Supabase Cloud. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | English | Short Supabase setup: base `devices` table, RLS snippet, env vars. |
| [docs/从零搭建说明书.md](docs/从零搭建说明书.md) | 中文 | Full bring-up from empty DB (SQL migrations, Auth). Cloud signup section superseded by self-hosted doc above for **current production**. |
| [docs/DATABASE_SPECIFICATION.md](docs/DATABASE_SPECIFICATION.md) | 中文 | Tables, columns, RLS intent, drift notes vs minimal DDL. |
| [docs/网页使用手册.md](docs/网页使用手册.md) | 中文 | End-user flows by role and page. |
| [board/README.md](board/README.md) | English | Web bridge modes (`supabase` vs `backend`) and parameters. |

Production schema and policies are defined by the SQL files under **`docs/`** (run in the order listed in **从零搭建说明书** §5). The single-table summary in `DEPLOYMENT.md` is the minimal legacy path; the web app expects the full migration set.

## Roles (web app)

Roles are stored in **`public.profiles.role`** (must match signup metadata where used). Four values, enforced in SQL and `frontend/src/types/roles.ts`:

| Value | UI label (zh) | Typical access |
|-------|----------------|----------------|
| `admin` | 管理员 | Admin console, create work group, fleet device tab, scene tasks (incl. batch draft), executor map, group moderation. |
| `device_operator` | 设备运维员 | Own devices, device management (register + external devices + search), work group. |
| `scene_operator` | 场景业务员 | Scene business (tasks, party demands, workstations), work group. |
| `collection_executor` | 数采执行员 | Executor map, scene collection view (published tasks + hours), work group. |

Route guards live in `frontend/src/App.tsx` (`RoleRoute`). KPI copy targets the three non-admin roles (`frontend/src/api/kpiMetrics.ts`).

## Quick start (web + Supabase)

**Production** uses **self-hosted Supabase on CVM** (`146.56.200.250`), not Supabase Cloud — see [docs/自建Supabase服务器连接说明.md](docs/自建Supabase服务器连接说明.md) before changing any `.env` or running `supabase link`.

1. Run migrations from **`docs/`** on the **self-hosted** Postgres (see 从零搭建说明书 §5, or [DEPLOYMENT.md](DEPLOYMENT.md) for a minimal legacy path).
2. Promote the first user to `admin` in `profiles` (see 从零搭建说明书 §6).
3. Frontend:

```bash
cd frontend
npm install
cp .env.example .env
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

App defaults to `http://localhost:5173`. Do **not** put the `service_role` key in the frontend `.env`.

## Quick start (backend + CLI, optional)

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Set DATABASE_URL (Supabase pooler URI recommended for Postgres)

python -m pytest tests/ -v

# Example: one-shot provision (board on USB serial)
python cli.py provision --port /dev/ttyUSB0

# Or API server
uvicorn app.main:app --reload --port 8000
```

On Windows, replace `/dev/ttyUSB0` with the appropriate COM port.

## Cloud deployment (Supabase-first)

- Static hosting (Vercel, Netlify, S3+CloudFront, etc.) for `frontend` build output; inject the same `VITE_*` variables.
- No Node server required for the SPA; data goes through Supabase PostgREST.
- Full checklist and SQL order: [docs/从零搭建说明书.md](docs/从零搭建说明书.md).

## CLI reference

```
python cli.py detect    [--port /dev/ttyUSB0]          # probe board, print CPU serial
python cli.py generate                                  # new device_id + readable_name
python cli.py register  [--port ... | --serial-id ...]  # register + QR
python cli.py provision [--port ...]                    # detect + IDs + write board + register
python cli.py list      [--status active] [--limit 20]
python cli.py search    <query>
python cli.py get       <device_id>
python cli.py update    <device_id> --status ...
python cli.py delete    <device_id>                   # soft-delete → retired
python cli.py qr        <device_id> [-o file.png]
```

### `provision` — one-shot device setup

1. USB-serial: read CPU serial  
2. Generate `device_id` (UUID) and `readable_name` (incrementing number)  
3. Write JSON to the board under `/etc/UPAIego/device_id.json`  
4. Save QR PNG locally  
5. Insert row in the database  

## API reference (FastAPI, optional)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/devices/detect` | Detect board → `serial_id` |
| POST | `/api/devices/generate` | New `device_id` / `readable_name` |
| POST | `/api/devices/register` | Register (port or `serial_id`) |
| POST | `/api/devices/provision` | Full provision pipeline |
| GET | `/api/devices` | List (`offset`, `limit`, `status`, `calibration_status`) |
| GET | `/api/devices/search?q=` | Search id / name / serial / notes |
| GET | `/api/devices/{id}` | One device |
| PUT | `/api/devices/{id}` | Update fields |
| DELETE | `/api/devices/{id}` | Soft-delete → `retired` |
| GET | `/api/devices/{id}/qr` | QR PNG |

## Database (summary)

The canonical model for production is **PostgreSQL on Supabase**: `devices`, `profiles`, work-group and scene-business tables, `scene_task_assignments`, `manual_tracked_devices`, `admin_kpis`, `admin_messages`, plus `auth.users` and optional **Storage** buckets (see migrations). Column list for `devices` and RLS discussion: **[docs/DATABASE_SPECIFICATION.md](docs/DATABASE_SPECIFICATION.md)**.

Local **SQLite** via SQLAlchemy may lag the cloud schema; treat Supabase as source of truth for the web app.

## QR code format

QR encodes JSON:

```json
{"readable_name": "1", "device_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
```

## Project structure

```
backend/                 # FastAPI + CLI (optional)
  cli.py
  app/                   # main, database, models, routes, services
  tests/                 # pytest, mocked hardware / in-memory SQLite
board/
  ros2_web_bridge/       # Optional ROS 2 HTTPS bridge to Supabase
docs/                    # SQL migrations + zh-CN operational docs
frontend/                # React 19 + Vite + Tailwind
  src/
    api/                 # supabase, client, groups, scenes, operations, …
    auth/                # AuthContext, role labels
    pages/               # Dashboard, devices, scene, map, admin, group, …
    components/
DEPLOYMENT.md            # English minimal deploy
upaiego/                 # On-device ROS 2 package (separate from web bridge)
```

## Tests

```bash
cd backend
python -m pytest tests/ -v
```

Tests use mocked hardware and an in-memory SQLite database where applicable.
