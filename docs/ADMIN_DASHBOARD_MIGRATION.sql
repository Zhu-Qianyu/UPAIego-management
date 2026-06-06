ALTER TABLE public.party_demands
  ADD COLUMN IF NOT EXISTS client_hourly_rate numeric(12, 2)
  CHECK (client_hourly_rate IS NULL OR client_hourly_rate >= 0);

  '甲方结算单价（元/小时）；管理员看板用于估算收入，为空则不计算该业务的收入。';

NOTIFY pgrst, 'reload schema';
