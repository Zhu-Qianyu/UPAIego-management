ALTER TABLE public.manual_tracked_devices
  DROP CONSTRAINT IF EXISTS manual_tracked_devices_public_code_fmt;

ALTER TABLE public.manual_tracked_devices
  ADD CONSTRAINT manual_tracked_devices_public_code_fmt CHECK (
    public_code ~ '^[0-9A-F]{10}$'
    OR public_code ~ '^[A-Z]{4}[0-9]{4}$'
    OR public_code ~ '^[A-Z0-9]{2,8}[0-9]{4}$'
  );


CREATE OR REPLACE FUNCTION public.random_device_code_prefix_4()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  result text := '';
  i int;
BEGIN
  FOR i IN 1..4 LOOP
    result := result || substr(chars, 1 + floor(random() * 26)::int, 1);
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public._assign_party_device_code_prefix(p_party_demand_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing text;
  prefix text;
  tries int := 0;
BEGIN
  SELECT upper(btrim(pd.device_code_prefix))
  INTO existing
  FROM public.party_demands pd
  WHERE pd.id = p_party_demand_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'party demand not found';
  END IF;

  IF existing ~ '^[A-Z]{4}$' THEN
    RETURN existing;
  END IF;

  LOOP
    prefix := public.random_device_code_prefix_4();
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.party_demands pd
      WHERE pd.device_code_prefix ~ '^[A-Z]{4}$'
        AND upper(btrim(pd.device_code_prefix)) = prefix
        AND pd.id <> p_party_demand_id
    );
    tries := tries + 1;
    IF tries > 200 THEN
      RAISE EXCEPTION 'failed to assign unique device_code_prefix for party %', p_party_demand_id;
    END IF;
  END LOOP;

  UPDATE public.party_demands
  SET device_code_prefix = prefix
  WHERE id = p_party_demand_id;

  RETURN prefix;
END;
$$;

CREATE OR REPLACE FUNCTION public.party_demands_after_insert_device_code_prefix()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.device_code_prefix IS NULL OR upper(btrim(NEW.device_code_prefix)) !~ '^[A-Z]{4}$' THEN
    PERFORM public._assign_party_device_code_prefix(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.party_demands_lock_device_code_prefix()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.device_code_prefix ~ '^[A-Z]{4}$'
     AND NEW.device_code_prefix IS DISTINCT FROM OLD.device_code_prefix THEN
    NEW.device_code_prefix := OLD.device_code_prefix;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_party_demands_device_code_prefix ON public.party_demands;

CREATE TRIGGER trg_party_demands_device_code_prefix
  AFTER INSERT ON public.party_demands
  FOR EACH ROW
  EXECUTE FUNCTION public.party_demands_after_insert_device_code_prefix();

DROP TRIGGER IF EXISTS trg_party_demands_device_code_prefix_upd ON public.party_demands;

CREATE TRIGGER trg_party_demands_device_code_prefix_upd
  BEFORE UPDATE ON public.party_demands
  FOR EACH ROW
  EXECUTE FUNCTION public.party_demands_lock_device_code_prefix();

CREATE OR REPLACE FUNCTION public.ensure_party_device_code_prefix(p_party_demand_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_role text;
BEGIN
  v_role := public.current_profile_role();
  IF v_role NOT IN ('admin', 'device_operator', 'scene_operator') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT pd.group_id INTO v_group
  FROM public.party_demands pd
  WHERE pd.id = p_party_demand_id;

  IF v_group IS NULL THEN
    RAISE EXCEPTION 'party demand not found';
  END IF;

  IF v_role <> 'admin' AND v_group IS DISTINCT FROM public.user_active_group_id() THEN
    RAISE EXCEPTION 'wrong work group';
  END IF;

  RETURN public._assign_party_device_code_prefix(p_party_demand_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_party_device_code_prefix(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.set_party_device_code_prefix_if_empty(uuid, text);

CREATE OR REPLACE FUNCTION public.manual_tracked_devices_party_same_group_chk()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.manual_tracked_devices_assign_public_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  prefix := public._assign_party_device_code_prefix(NEW.party_demand_id);

  SELECT COALESCE(max(substring(m.public_code from 5)::int), 0) + 1
  INTO seq
  FROM public.manual_tracked_devices m
  WHERE m.party_demand_id = NEW.party_demand_id
    AND m.public_code ~ ('^' || prefix || '[0-9]{4}$');

  LOOP
    code := prefix || lpad(seq::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.manual_tracked_devices m WHERE m.public_code = code);
    seq := seq + 1;
    tries := tries + 1;
    IF tries > 9999 THEN
      RAISE EXCEPTION 'failed to assign unique public_code for party %', NEW.party_demand_id;
    END IF;
  END LOOP;

  NEW.public_code := code;
  RETURN NEW;
END;
$$;


DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id
    FROM public.party_demands
    WHERE device_code_prefix IS NULL
       OR btrim(device_code_prefix) = ''
       OR upper(btrim(device_code_prefix)) !~ '^[A-Z]{4}$'
  LOOP
    PERFORM public._assign_party_device_code_prefix(r.id);
  END LOOP;
END;
$$;
