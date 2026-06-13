-- 统一 profiles.roles 排序（与前端 NAV 优先级一致），并回填现有数据
-- 执行顺序：在 MULTI_ROLE_MIGRATION.sql 之后任意时刻可执行

CREATE OR REPLACE FUNCTION public.sort_profile_roles(r text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    array_agg(u ORDER BY
      CASE u
        WHEN 'admin' THEN 0
        WHEN 'scene_operator' THEN 1
        WHEN 'device_operator' THEN 2
        WHEN 'collection_executor' THEN 3
        ELSE 99
      END,
      u
    ),
    ARRAY[]::text[]
  )
  FROM unnest(COALESCE(r, ARRAY[]::text[])) AS u
  WHERE u IN ('admin', 'device_operator', 'scene_operator', 'collection_executor');
$$;

CREATE OR REPLACE FUNCTION public.profiles_roles_sync_chk()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r text[];
BEGIN
  IF NEW.roles IS NULL OR cardinality(NEW.roles) = 0 THEN
    NEW.roles := ARRAY[COALESCE(NULLIF(trim(NEW.role), ''), 'device_operator')];
  END IF;

  NEW.roles := public.sort_profile_roles(ARRAY(SELECT DISTINCT unnest(NEW.roles)));

  IF 'admin' = ANY(NEW.roles) THEN
    IF cardinality(NEW.roles) <> 1 OR NEW.roles[1] <> 'admin' THEN
      RAISE EXCEPTION 'admin role must be exclusive';
    END IF;
    NEW.role := 'admin';
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(NEW.roles) u
    WHERE u NOT IN ('device_operator', 'scene_operator', 'collection_executor')
  ) THEN
    RAISE EXCEPTION 'invalid role in roles array';
  END IF;

  IF cardinality(NEW.roles) < 1 THEN
    RAISE EXCEPTION 'at least one operative role required';
  END IF;

  NEW.role := NEW.roles[1];
  RETURN NEW;
END;
$$;

UPDATE public.profiles
SET roles = public.sort_profile_roles(roles),
    role = (public.sort_profile_roles(roles))[1],
    updated_at = now()
WHERE roles IS NOT NULL AND cardinality(roles) > 0;

NOTIFY pgrst, 'reload schema';
