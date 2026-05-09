-- 将 KPI 名称统一为机器可读键（与前端 kpiMetrics.ts 一致），并可选加 CHECK。
-- 在 Supabase SQL Editor 中按需执行。

UPDATE public.admin_kpis SET title = 'device_health_rate'
  WHERE target_role = 'device_operator' AND title IN ('设备完好率', 'device_health_rate');

UPDATE public.admin_kpis SET title = 'scene_count'
  WHERE target_role = 'scene_operator' AND title IN ('场景数', 'scene_count');

UPDATE public.admin_kpis SET title = 'data_volume'
  WHERE target_role = 'collection_executor' AND title IN ('数据量', 'data_volume');

-- 可选：约束 title 取值（若仍有未知旧值，请先手工修正再启用）
-- ALTER TABLE public.admin_kpis DROP CONSTRAINT IF EXISTS admin_kpis_title_metric_check;
-- ALTER TABLE public.admin_kpis
--   ADD CONSTRAINT admin_kpis_title_metric_check
--   CHECK (title IN ('device_health_rate', 'scene_count', 'data_volume'));
