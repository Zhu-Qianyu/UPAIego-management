UPDATE public.admin_kpis SET title = 'device_health_rate'
  WHERE target_role = 'device_operator' AND title IN ('设备完好率', 'device_health_rate');

UPDATE public.admin_kpis SET title = 'scene_count'
  WHERE target_role = 'scene_operator' AND title IN ('场景数', 'scene_count');

UPDATE public.admin_kpis SET title = 'data_volume'
  WHERE target_role = 'collection_executor' AND title IN ('数据量', 'data_volume');
