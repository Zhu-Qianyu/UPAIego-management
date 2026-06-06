-- 豆小秘/甲方业务：离线设备顺序编号所需字段（未跑完整迁移时先执行本文件）
-- 完整离线编号规则见 MANUAL_DEVICE_SEQUENTIAL_CODE_MIGRATION.sql

ALTER TABLE public.party_demands
  ADD COLUMN IF NOT EXISTS device_code_prefix text;

COMMENT ON COLUMN public.party_demands.device_code_prefix IS 'Offline device public_code prefix per party demand, e.g. ZYMF from 智元觅蜂.';

-- 执行后请在 Supabase Dashboard → Settings → API 点 Reload schema（或重启 PostgREST）刷新 schema cache
