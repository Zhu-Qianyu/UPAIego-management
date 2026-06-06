ALTER TABLE public.party_demands
  ADD COLUMN IF NOT EXISTS device_type text;
