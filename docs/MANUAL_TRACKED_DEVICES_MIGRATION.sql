-- 无网站心跳的第三方设备：运维员手动登记；登记编号(public_code)用于二维码；设备类型展示为「甲方公司名 · 设备简称」。
-- Prerequisite: work_groups, party_demands, policy_work_group_accessible, current_profile_role().
-- After this script, run EXTERNAL_DEVICE_STATUS_MIGRATION.sql to replace status_ok with external_status (normal / fault / factory_repair).

CREATE TABLE IF NOT EXISTS public.manual_tracked_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  party_demand_id uuid NOT NULL REFERENCES public.party_demands (id) ON DELETE CASCADE,
  device_short_label text NOT NULL,
  status_ok boolean NOT NULL DEFAULT true,
  public_code text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_tracked_devices_short_nonempty CHECK (char_length(trim(device_short_label)) >= 1 AND char_length(trim(device_short_label)) <= 120),
  CONSTRAINT manual_tracked_devices_public_code_fmt CHECK (public_code ~ '^[0-9A-F]{10}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS manual_tracked_devices_public_code_key ON public.manual_tracked_devices (public_code);
CREATE INDEX IF NOT EXISTS idx_manual_tracked_devices_group ON public.manual_tracked_devices (group_id);
CREATE INDEX IF NOT EXISTS idx_manual_tracked_devices_party ON public.manual_tracked_devices (party_demand_id);

CREATE OR REPLACE FUNCTION public.manual_tracked_devices_party_same_group_chk()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.party_demands pd
    WHERE pd.id = NEW.party_demand_id
      AND pd.group_id = NEW.group_id
  ) THEN
    RAISE EXCEPTION 'party_demand_id must belong to the same work group as group_id';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_tracked_party_group ON public.manual_tracked_devices;
CREATE TRIGGER trg_manual_tracked_party_group
  BEFORE INSERT OR UPDATE OF party_demand_id, group_id ON public.manual_tracked_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.manual_tracked_devices_party_same_group_chk();

CREATE OR REPLACE FUNCTION public.manual_tracked_devices_assign_public_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  c text;
  tries int := 0;
BEGIN
  IF NEW.public_code IS NOT NULL AND trim(NEW.public_code) <> '' THEN
    RETURN NEW;
  END IF;
  LOOP
    c := upper(substring(encode(gen_random_bytes(5), 'hex') from 1 for 10));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.manual_tracked_devices m WHERE m.public_code = c);
    tries := tries + 1;
    IF tries > 20 THEN
      RAISE EXCEPTION 'failed to assign unique public_code';
    END IF;
  END LOOP;
  NEW.public_code := c;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_tracked_code ON public.manual_tracked_devices;
CREATE TRIGGER trg_manual_tracked_code
  BEFORE INSERT ON public.manual_tracked_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.manual_tracked_devices_assign_public_code();

CREATE OR REPLACE FUNCTION public.manual_tracked_devices_immutable_chk()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'manual_tracked_devices.group_id is immutable';
  END IF;
  IF NEW.public_code IS DISTINCT FROM OLD.public_code THEN
    RAISE EXCEPTION 'manual_tracked_devices.public_code is immutable';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'manual_tracked_devices.created_by is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_tracked_immutable ON public.manual_tracked_devices;
CREATE TRIGGER trg_manual_tracked_immutable
  BEFORE UPDATE ON public.manual_tracked_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.manual_tracked_devices_immutable_chk();

CREATE OR REPLACE FUNCTION public.manual_tracked_devices_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_tracked_updated ON public.manual_tracked_devices;
CREATE TRIGGER trg_manual_tracked_updated
  BEFORE UPDATE ON public.manual_tracked_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.manual_tracked_devices_touch_updated_at();

ALTER TABLE public.manual_tracked_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mtd_select" ON public.manual_tracked_devices;
DROP POLICY IF EXISTS "mtd_insert" ON public.manual_tracked_devices;
DROP POLICY IF EXISTS "mtd_update" ON public.manual_tracked_devices;
DROP POLICY IF EXISTS "mtd_delete" ON public.manual_tracked_devices;

CREATE POLICY "mtd_select"
  ON public.manual_tracked_devices FOR SELECT TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      group_id IS NOT NULL
      AND public.policy_work_group_accessible(group_id)
    )
  );

CREATE POLICY "mtd_insert"
  ON public.manual_tracked_devices FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.current_profile_role() IN ('admin', 'device_operator')
    AND group_id IS NOT NULL
    AND (
      public.current_profile_role() = 'admin'
      OR public.policy_work_group_accessible(group_id)
    )
  );

CREATE POLICY "mtd_update"
  ON public.manual_tracked_devices FOR UPDATE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'device_operator'
      AND group_id IS NOT NULL
      AND public.policy_work_group_accessible(group_id)
    )
  )
  WITH CHECK (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'device_operator'
      AND group_id IS NOT NULL
      AND public.policy_work_group_accessible(group_id)
    )
  );

CREATE POLICY "mtd_delete"
  ON public.manual_tracked_devices FOR DELETE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'device_operator'
      AND group_id IS NOT NULL
      AND public.policy_work_group_accessible(group_id)
    )
  );

COMMENT ON TABLE public.manual_tracked_devices IS '外部设备（无法连接本站心跳）：运维维护状态与贴签登记编号(QR)。';
COMMENT ON COLUMN public.manual_tracked_devices.public_code IS '10-char hex sticker id; immutable after insert.';
COMMENT ON COLUMN public.manual_tracked_devices.device_short_label IS 'Short label combined with party demand company for display type.';
