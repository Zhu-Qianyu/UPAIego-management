-- 大场景联系人：scene_macro_sites.contact_name / contact_phone
-- Prerequisite: SCENE_MACRO_HIERARCHY_MIGRATION.sql
-- Run in Supabase SQL Editor as a single script.

ALTER TABLE public.scene_macro_sites
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text;

COMMENT ON COLUMN public.scene_macro_sites.contact_name IS '场景联系人姓名。';
COMMENT ON COLUMN public.scene_macro_sites.contact_phone IS '场景联系人电话。';

NOTIFY pgrst, 'reload schema';
