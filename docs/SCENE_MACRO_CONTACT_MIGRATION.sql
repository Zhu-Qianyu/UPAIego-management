ALTER TABLE public.scene_macro_sites
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text;


NOTIFY pgrst, 'reload schema';
