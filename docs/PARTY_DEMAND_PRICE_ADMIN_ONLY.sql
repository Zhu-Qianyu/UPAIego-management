-- 甲方结算单价仅平台管理员可读（与 party_demands 分离，非管理员查不到价格）
-- 执行时机：PARTY_DEMAND_MACRO_HOURS.sql 之后

CREATE TABLE IF NOT EXISTS public.party_demand_client_rates (
  party_demand_id uuid PRIMARY KEY REFERENCES public.party_demands (id) ON DELETE CASCADE,
  client_hourly_rate numeric(12, 2) NOT NULL CHECK (client_hourly_rate >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.party_demand_client_rates IS '甲方业务结算单价；仅平台管理员可读写，与 party_demands 分离以防非管理员通过 API 读取。';

ALTER TABLE public.party_demand_client_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdcr_select" ON public.party_demand_client_rates;
CREATE POLICY "pdcr_select"
  ON public.party_demand_client_rates FOR SELECT TO authenticated
  USING (public.has_profile_role('admin'));

DROP POLICY IF EXISTS "pdcr_insert" ON public.party_demand_client_rates;
CREATE POLICY "pdcr_insert"
  ON public.party_demand_client_rates FOR INSERT TO authenticated
  WITH CHECK (
    public.has_profile_role('admin')
    AND EXISTS (
      SELECT 1
      FROM public.party_demands d
      WHERE d.id = party_demand_client_rates.party_demand_id
        AND d.group_id = public.user_active_group_id()
    )
  );

DROP POLICY IF EXISTS "pdcr_update" ON public.party_demand_client_rates;
CREATE POLICY "pdcr_update"
  ON public.party_demand_client_rates FOR UPDATE TO authenticated
  USING (public.has_profile_role('admin'))
  WITH CHECK (public.has_profile_role('admin'));

DROP POLICY IF EXISTS "pdcr_delete" ON public.party_demand_client_rates;
CREATE POLICY "pdcr_delete"
  ON public.party_demand_client_rates FOR DELETE TO authenticated
  USING (public.has_profile_role('admin'));

INSERT INTO public.party_demand_client_rates (party_demand_id, client_hourly_rate)
SELECT id, client_hourly_rate
FROM public.party_demands
WHERE client_hourly_rate IS NOT NULL AND client_hourly_rate > 0
ON CONFLICT (party_demand_id) DO NOTHING;

ALTER TABLE public.party_demands DROP COLUMN IF EXISTS client_hourly_rate;

NOTIFY pgrst, 'reload schema';
