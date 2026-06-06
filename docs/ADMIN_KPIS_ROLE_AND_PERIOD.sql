ALTER TABLE public.admin_kpis
  ADD COLUMN IF NOT EXISTS target_role text NOT NULL DEFAULT 'device_operator';

ALTER TABLE public.admin_kpis DROP CONSTRAINT IF EXISTS admin_kpis_target_role_check;

ALTER TABLE public.admin_kpis
  ADD CONSTRAINT admin_kpis_target_role_check
  CHECK (target_role IN ('device_operator', 'scene_operator', 'collection_executor'));


ALTER TABLE public.admin_kpis
  ADD COLUMN IF NOT EXISTS valid_from timestamptz;

ALTER TABLE public.admin_kpis
  ADD COLUMN IF NOT EXISTS valid_until timestamptz;


ALTER TABLE public.admin_kpis DROP CONSTRAINT IF EXISTS admin_kpis_valid_range_check;

ALTER TABLE public.admin_kpis
  ADD CONSTRAINT admin_kpis_valid_range_check
  CHECK (
    valid_from IS NULL
    OR valid_until IS NULL
    OR valid_from <= valid_until
  );
