# Cyber Cap Fleet Management

Hardware fleet management system for Rockchip dev boards. Detects boards over USB-serial, registers them with auto-generated names and UUIDs, stores metadata in a database (local SQLite or cloud Supabase PostgreSQL), generates QR codes, and provides both a CLI and web UI for browsing and querying devices.

## Quick Start (Local Development)

### Backend + CLI

```bash
cd backend
pip install -r requirements.txt

# Run tests (no hardware needed)
python -m pytest tests/ -v

# One-shot provisioning (with board connected via USB serial):
python cli.py provision --port /dev/ttyUSB0     # detect + generate IDs + write to board + QR + register

# Or step-by-step:
python cli.py generate                          # generate a device_id / readable_name pair
python cli.py register --serial-id abc123       # register with a known CPU serial
python cli.py list
python cli.py qr <device_id>

# Or start the API server
uvicorn app.main:app --reload --port 8000
```

### Frontend (local dev with Supabase)

```bash
cd frontend
npm install
cp .env.example .env
# Edit .env with your Supabase URL + anon key
npm run dev
```

Opens at `http://localhost:5173`.

## Cloud Deployment (Supabase, no server)

See [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions. Summary:

1. Create a free Supabase project, run the CREATE TABLE SQL
2. Give each hardware manager the `backend/` folder + a `.env` with `DATABASE_URL`
3. Optionally deploy the web UI to Vercel/Netlify (free)

No servers to run -- the CLI connects directly to Supabase PostgreSQL, and the web UI uses the Supabase REST API.

## CLI Reference

```
python cli.py detect    [--port /dev/ttyUSB0]          # probe board, print serial ID (CPU serial)
python cli.py generate                                  # generate a new device_id + readable_name pair
python cli.py register  [--port ... | --serial-id ...]  # register a device + save QR
python cli.py provision [--port /dev/ttyUSB0]           # one-shot: detect + IDs + write to board + QR + register
python cli.py list      [--status active] [--limit 20]  # list devices
python cli.py search    <query>                         # full-text search
python cli.py get       <device_id>                     # show single device
python cli.py update    <device_id> --status ...        # update fields
python cli.py delete    <device_id>                     # soft-delete (retire)
python cli.py qr        <device_id> [-o file.png]       # generate and save QR code
```

### `provision` — One-Shot Device Setup

The `provision` command does everything in a single step:

1. Connects to the board via USB-serial and reads the CPU serial ID
2. Generates a new `device_id` (UUID) and `readable_name` (incrementing number)
3. Writes `{"device_id": "...", "readable_name": "...", "serial_id": "..."}` to the board at `/etc/cyber-cap/device_id.json`
4. Generates a QR code PNG and saves it locally
5. Registers the device in the database

```bash
python cli.py provision --port /dev/ttyUSB0
```

## API Reference (FastAPI server, optional)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/devices/detect` | Detect connected board, returns `serial_id` |
| POST | `/api/devices/generate` | Generate a new `device_id` / `readable_name` pair |
| POST | `/api/devices/register` | Register a new device (auto-detect via port, or provide `serial_id`) |
| POST | `/api/devices/provision` | One-shot: detect + generate IDs + write to board + register |
| GET | `/api/devices` | List devices (query: `offset`, `limit`, `status`, `calibration_status`) |
| GET | `/api/devices/search?q=` | Full-text search across device_id, name, serial_id, notes |
| GET | `/api/devices/{id}` | Get single device |
| PUT | `/api/devices/{id}` | Update device fields |
| DELETE | `/api/devices/{id}` | Soft-delete (set status to retired) |
| GET | `/api/devices/{id}/qr` | Download QR code PNG |

## Database Schema

Single `devices` table:

| Column | Type | Description |
|--------|------|-------------|
| device_id | TEXT PK | Auto-generated UUID |
| readable_name | TEXT UNIQUE | Auto-generated incrementing number (1, 2, 3, ...) |
| serial_id | TEXT | CPU serial from /proc/cpuinfo |
| registered_at | TIMESTAMPTZ | Registration timestamp |
| last_seen | TIMESTAMPTZ | Last interaction |
| calibration_status | TEXT | pending / calibrated / needs_recalibration |
| calibration_date | TIMESTAMPTZ | Last calibration time |
| status | TEXT | active / inactive / maintenance / retired |
| firmware_version | TEXT | Firmware version |
| notes | TEXT | Free-form notes |
| calibration | JSON | Calibration data |

## QR Code Format

Each QR code encodes a JSON payload:

```json
{"readable_name": "1", "device_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
```

## Project Structure

```
backend/
  cli.py                # Fleet management CLI
  app/
    main.py             # FastAPI application (optional server mode)
    database.py         # SQLAlchemy setup (reads DATABASE_URL from .env)
    models.py           # Device ORM model
    schemas.py          # Pydantic schemas
    routes/devices.py   # API endpoints
    services/
      board_connector.py  # Hardware detection wrapper
      device_service.py   # Business logic & CRUD
      qr_service.py       # QR code generation
  rk_board_config.py    # Serial console driver
  tests/                # 25 pytest tests (mocked hardware, in-memory DB)
frontend/
  src/
    api/
      supabase.ts       # Supabase client init
      client.ts         # Typed API functions (Supabase queries)
      qr.ts             # Client-side QR generation
    pages/              # Dashboard, Register, DeviceDetail, Search
    components/         # StatusBadge, Spinner
```

## Tests

```bash
cd backend
python -m pytest tests/ -v
```

25 tests covering: full workflow, provision workflow, CRUD edge cases, name generation, QR generation. All use mocked hardware and in-memory SQLite.
