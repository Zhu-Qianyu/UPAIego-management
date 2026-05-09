-- 外部设备状态：正常 / 异常 / 返厂维修（替代 boolean status_ok）。
-- Prerequisite: manual_tracked_devices 表已存在（MANUAL_TRACKED_DEVICES_MIGRATION.sql）。

ALTER TABLE public.manual_tracked_devices
  ADD COLUMN IF NOT EXISTS external_status text;

UPDATE public.manual_tracked_devices
SET external_status = CASE WHEN COALESCE(status_ok, true) THEN 'normal' ELSE 'fault' END
WHERE external_status IS NULL;

ALTER TABLE public.manual_tracked_devices ALTER COLUMN external_status SET DEFAULT 'normal';
ALTER TABLE public.manual_tracked_devices ALTER COLUMN external_status SET NOT NULL;

ALTER TABLE public.manual_tracked_devices DROP CONSTRAINT IF EXISTS manual_tracked_devices_external_status_chk;
ALTER TABLE public.manual_tracked_devices ADD CONSTRAINT manual_tracked_devices_external_status_chk CHECK (
  external_status = ANY (ARRAY['normal', 'fault', 'factory_repair']::text[])
);

ALTER TABLE public.manual_tracked_devices DROP COLUMN IF EXISTS status_ok;

COMMENT ON COLUMN public.manual_tracked_devices.external_status IS 'normal=正常, fault=异常, factory_repair=返厂维修';
