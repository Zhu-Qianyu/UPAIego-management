# Deployment Guide

No servers required. The CLI connects directly to Supabase PostgreSQL, and the web UI is a static site that talks to Supabase's REST API.

## Architecture

```
Hardware Manager's Machine                         Cloud (free tier)
┌──────────────────────────┐                  ┌─────────────────────┐
│  rk_board_config.py      │                  │  Supabase           │
│      + fleet CLI         │── PostgreSQL ──> │  (PostgreSQL + REST │
│                          │                  │   API + Auth)       │
└──────────────────────────┘                  └─────────────────────┘
                                                        ^
Any browser ── HTTPS ── Static Site (Vercel/Netlify) ───┘
                         (React SPA, Supabase JS SDK)
```

---

## Step 1: Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com) and sign in
2. Click **New Project**:
   - **Name:** `cyber-cap-fleet`
   - **Database Password:** choose a strong password, **save it**
   - **Region:** pick one close to your team
3. Wait for the project to finish provisioning (~1 minute)

### Get your credentials

You need two sets of credentials:

**For the CLI** (PostgreSQL connection string):
- Go to **Settings > Database**
- Under **Connection string > URI**, copy the string
- Replace `[YOUR-PASSWORD]` with the password from step 2
- Use **port 6543** (Transaction mode / pooler), not port 5432

```
postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

**For the Web UI** (Supabase API keys):
- Go to **Settings > API**
- Copy the **Project URL** (e.g. `https://abcdefg.supabase.co`)
- Copy the **anon public** key

### Create the database table

Go to **SQL Editor** in the Supabase dashboard and run:

```sql
CREATE TABLE IF NOT EXISTS devices (
    device_id          TEXT PRIMARY KEY,
    readable_name      TEXT UNIQUE NOT NULL,
    machine_id         TEXT,
    hostname           TEXT,
    registered_at      TIMESTAMP WITH TIME ZONE,
    last_seen          TIMESTAMP WITH TIME ZONE,
    calibration_status TEXT DEFAULT 'pending',
    calibration_date   TIMESTAMP WITH TIME ZONE,
    status             TEXT DEFAULT 'active',
    firmware_version   TEXT,
    notes              TEXT
);
```

> **Note:** The CLI also auto-creates this table on first run via SQLAlchemy, but running the SQL manually ensures the Supabase REST API can see the table immediately.

### Configure Row Level Security (RLS)

For internal / team use, add a permissive policy so the web UI can read/write:

```sql
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

-- Allow all operations for anyone with the anon key (internal use only)
CREATE POLICY "Allow all for anon" ON devices
    FOR ALL
    USING (true)
    WITH CHECK (true);
```

> If you need stricter access control later, update these policies to require authentication.

---

## Step 2: Set Up the CLI (for each hardware manager)

Each manager needs: the `backend/` folder and a `.env` file.

### Install

```bash
# Clone or copy the backend/ directory to each manager's machine
cd backend
pip install -r requirements.txt
```

### Configure

```bash
# Create .env file with your Supabase connection string
cp .env.example .env
# Edit .env and paste your DATABASE_URL from Step 1
```

The `.env` file should contain:
```
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

### Use

```bash
# Detect a connected board
python cli.py detect --port /dev/ttyUSB0

# Register it (auto-generates name + QR code)
python cli.py register --port /dev/ttyUSB0

# Or register manually (if you already have the CPU ID)
python cli.py register --device-id a1b2c3d4e5f60000 --hostname myboard

# List all devices
python cli.py list

# Search
python cli.py search rk3588

# View one device
python cli.py get a1b2c3d4e5f60000

# Update fields
python cli.py update a1b2c3d4e5f60000 --status maintenance --notes "Under repair"

# Generate QR code
python cli.py qr a1b2c3d4e5f60000 -o label.png

# Retire a device
python cli.py delete a1b2c3d4e5f60000
```

---

## Step 3: Deploy the Web UI (optional)

The web UI is a static React SPA that talks to Supabase directly. No backend server needed.

### Option A: Vercel (recommended, free)

```bash
cd frontend

# Create .env with your Supabase keys
cp .env.example .env
# Edit .env:
#   VITE_SUPABASE_URL=https://your-project.supabase.co
#   VITE_SUPABASE_ANON_KEY=your-anon-key

# Build
npm install
npm run build

# Deploy
npx vercel deploy --prod
```

Vercel will give you a URL like `https://cyber-cap-fleet.vercel.app`.

### Option B: Netlify (free)

```bash
cd frontend
npm install
npm run build
# Drag the dist/ folder to https://app.netlify.com/drop
```

Set environment variables in the Netlify dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Option C: Run locally

```bash
cd frontend
cp .env.example .env
# Edit .env with your Supabase keys
npm install
npm run dev
```

Opens at `http://localhost:5173`.

### Option D: No web UI

Just use the CLI. All operations are available from the command line.

---

## Summary: What Each Person Needs

| Role | Setup | Tools |
|------|-------|-------|
| **Hardware Manager** | `backend/` folder + `.env` with `DATABASE_URL` | `python cli.py` commands |
| **Anyone viewing data** | Browser | Web UI URL (Vercel/Netlify/local) |
| **Admin** | Supabase dashboard | Manage DB, RLS policies, API keys |

---

## Cost

- **Supabase Free Tier:** 500 MB database, 2 GB bandwidth, unlimited API requests -- more than enough for ~2000 devices
- **Vercel Free Tier:** 100 GB bandwidth, automatic HTTPS
- **Total: $0/month**

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| CLI: `connection refused` | Check `DATABASE_URL` in `.env`. Use port **6543** (not 5432) |
| CLI: `password authentication failed` | Verify password in URL. URL-encode special chars (`@` -> `%40`) |
| CLI: `relation "devices" does not exist` | Run the CREATE TABLE SQL in Supabase dashboard, or run any CLI command (auto-creates) |
| Web UI: blank page | Check browser console. Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set |
| Web UI: `permission denied for table devices` | Run the RLS policy SQL from Step 1 in the Supabase SQL Editor |
| Web UI: can register but not list | RLS policy missing. Run the `CREATE POLICY` SQL |
