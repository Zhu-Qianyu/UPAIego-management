-- Admin dashboard: optional client billing rate on party_demands.
-- Prerequisite: party_demands, device_data_hour_logs, executor_settlement_lines, work_groups.
-- Run in Supabase SQL Editor. Frontend aggregates stats client-side; this column enables income estimates.

ALTER TABLE public.party_demands
  ADD COLUMN IF NOT EXISTS client_hourly_rate numeric(12, 2)
  CHECK (client_hourly_rate IS NULL OR client_hourly_rate >= 0);

COMMENT ON COLUMN public.party_demands.client_hourly_rate IS
  '甲方结算单价（元/小时）；管理员看板用于估算收入，为空则不计算该业务的收入。';

NOTIFY pgrst, 'reload schema';
