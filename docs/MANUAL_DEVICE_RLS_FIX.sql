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


CREATE OR REPLACE FUNCTION public.set_party_device_code_prefix_if_empty(
  p_party_demand_id uuid,
  p_prefix text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_role text;
  v_norm text;
BEGIN
  v_role := public.current_profile_role();
  IF v_role NOT IN ('admin', 'device_operator', 'scene_operator') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  v_norm := upper(regexp_replace(btrim(COALESCE(p_prefix, '')), '[^A-Z0-9]', '', 'g'));
  IF length(v_norm) < 2 OR length(v_norm) > 8 THEN
    RAISE EXCEPTION 'invalid device_code_prefix';
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

  UPDATE public.party_demands
  SET device_code_prefix = v_norm
  WHERE id = p_party_demand_id
    AND (device_code_prefix IS NULL OR btrim(device_code_prefix) = '');
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_party_device_code_prefix_if_empty(uuid, text) TO authenticated;

UPDATE public.party_demands pd
SET device_code_prefix = upper(substring(regexp_replace(btrim(pd.client_company), '[^A-Za-z0-9]', '', 'g') FROM 1 FOR 8))
WHERE (device_code_prefix IS NULL OR btrim(device_code_prefix) = '')
  AND btrim(COALESCE(pd.client_company, '')) <> ''
  AND regexp_replace(btrim(pd.client_company), '[^A-Za-z0-9]', '', 'g') ~ '[A-Za-z]';
