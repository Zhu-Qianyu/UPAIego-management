-- 大场景全景图：scene_macro_sites.panorama_path / panorama_bucket
-- Prerequisite: SCENE_MACRO_HIERARCHY_MIGRATION.sql
-- Run in Supabase SQL Editor as a single script.

ALTER TABLE public.scene_macro_sites
  ADD COLUMN IF NOT EXISTS panorama_bucket text,
  ADD COLUMN IF NOT EXISTS panorama_path text;

COMMENT ON COLUMN public.scene_macro_sites.panorama_bucket IS '全景图 Storage bucket，与工位快照同 bucket。';
COMMENT ON COLUMN public.scene_macro_sites.panorama_path IS '大场景全景图 Storage 路径。';

NOTIFY pgrst, 'reload schema';
