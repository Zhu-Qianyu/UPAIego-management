-- 修复：登记离线设备时报 gen_random_bytes does not exist
-- 原因：旧版 manual_tracked_devices_assign_public_code 依赖 pgcrypto；本脚本改为按甲方前缀顺序编号（ZYMF0001…）
-- 在 Supabase SQL Editor 执行；执行后 Settings → API → Reload schema

ALTER TABLE public.party_demands
  ADD COLUMN IF NOT EXISTS device_code_prefix text;

COMMENT ON COLUMN public.party_demands.device_code_prefix IS 'Offline device public_code prefix per party demand, e.g. ZYMF from 智元觅蜂.';

ALTER TABLE public.manual_tracked_devices
  DROP CONSTRAINT IF EXISTS manual_tracked_devices_public_code_fmt;

ALTER TABLE public.manual_tracked_devices
  ADD CONSTRAINT manual_tracked_devices_public_code_fmt CHECK (
    public_code ~ '^[0-9A-F]{10}$'
    OR public_code ~ '^[A-Z0-9]{2,8}[0-9]{4}$'
  );

CREATE OR REPLACE FUNCTION public.manual_tracked_devices_assign_public_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prefix text;
  seq int;
  code text;
  tries int := 0;
BEGIN
  IF NEW.public_code IS NOT NULL AND btrim(NEW.public_code) <> '' THEN
    NEW.public_code := upper(btrim(NEW.public_code));
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.party_demands pd
  WHERE pd.id = NEW.party_demand_id
  FOR UPDATE;

  SELECT upper(regexp_replace(COALESCE(NULLIF(btrim(pd.device_code_prefix), ''), 'DEV'), '[^A-Z0-9]', '', 'g'))
  INTO prefix
  FROM public.party_demands pd
  WHERE pd.id = NEW.party_demand_id;

  IF prefix IS NULL OR length(prefix) < 2 THEN
    prefix := 'PD' || upper(substring(replace(NEW.party_demand_id::text, '-', '') FROM 1 FOR 2));
  END IF;

  IF length(prefix) > 8 THEN
    prefix := substring(prefix FROM 1 FOR 8);
  END IF;

  SELECT count(*)::int + 1
  INTO seq
  FROM public.manual_tracked_devices m
  WHERE m.party_demand_id = NEW.party_demand_id;

  LOOP
    code := prefix || lpad(seq::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.manual_tracked_devices m WHERE m.public_code = code);
    seq := seq + 1;
    tries := tries + 1;
    IF tries > 50 THEN
      RAISE EXCEPTION 'failed to assign unique public_code for party %', NEW.party_demand_id;
    END IF;
  END LOOP;

  NEW.public_code := code;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_tracked_code ON public.manual_tracked_devices;

CREATE TRIGGER trg_manual_tracked_code
  BEFORE INSERT ON public.manual_tracked_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.manual_tracked_devices_assign_public_code();

COMMENT ON COLUMN public.manual_tracked_devices.public_code IS 'Sticker id: legacy 10-char hex or {prefix}{0001} sequential per party demand.';

COMMENT ON FUNCTION public.manual_tracked_devices_assign_public_code() IS 'Assign sequential public_code per party_demand; no pgcrypto required.';
