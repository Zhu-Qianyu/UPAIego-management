-- KPI 按角色（设备运维员 / 场景业务员 / 数采执行员）分别设置，并支持考核起止时间。
-- 在 Supabase SQL Editor 中执行一次。

ALTER TABLE public.admin_kpis
  ADD COLUMN IF NOT EXISTS target_role text NOT NULL DEFAULT 'device_operator';

ALTER TABLE public.admin_kpis DROP CONSTRAINT IF EXISTS admin_kpis_target_role_check;

ALTER TABLE public.admin_kpis
  ADD CONSTRAINT admin_kpis_target_role_check
  CHECK (target_role IN ('device_operator', 'scene_operator', 'collection_executor'));

COMMENT ON COLUMN public.admin_kpis.target_role IS 'KPI 适用角色：设备运维员、场景业务员、数采执行员';

ALTER TABLE public.admin_kpis
  ADD COLUMN IF NOT EXISTS valid_from timestamptz;

ALTER TABLE public.admin_kpis
  ADD COLUMN IF NOT EXISTS valid_until timestamptz;

COMMENT ON COLUMN public.admin_kpis.valid_from IS '考核/展示起始时间，NULL 表示不限制开始';
COMMENT ON COLUMN public.admin_kpis.valid_until IS '考核/展示结束时间，NULL 表示不限制结束';

ALTER TABLE public.admin_kpis DROP CONSTRAINT IF EXISTS admin_kpis_valid_range_check;

ALTER TABLE public.admin_kpis
  ADD CONSTRAINT admin_kpis_valid_range_check
  CHECK (
    valid_from IS NULL
    OR valid_until IS NULL
    OR valid_from <= valid_until
  );
