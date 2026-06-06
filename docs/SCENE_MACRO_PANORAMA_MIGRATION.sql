ALTER TABLE public.scene_macro_sites
  ADD COLUMN IF NOT EXISTS panorama_bucket text,
  ADD COLUMN IF NOT EXISTS panorama_path text;


NOTIFY pgrst, 'reload schema';
