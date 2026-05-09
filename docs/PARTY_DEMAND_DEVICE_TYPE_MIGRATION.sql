-- 甲方业务：设备类型（与公司并列展示）；需在应用内执行编辑。
-- Prerequisite: party_demands 表已存在（GROUP_TOPICS_BUSINESS_MIGRATION / SCENE_BUSINESS_ASSIGNMENT_MIGRATION）。

ALTER TABLE public.party_demands
  ADD COLUMN IF NOT EXISTS device_type text;

COMMENT ON COLUMN public.party_demands.device_type IS '甲方设备类型，与 client_company 并列维护。';
