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
