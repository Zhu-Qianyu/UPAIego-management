UPDATE public.manual_tracked_devices m
SET device_short_label = regexp_replace(m.device_short_label, '[0-9]+$', '')
FROM public.party_demands pd
WHERE m.party_demand_id = pd.id
  AND m.device_short_label ~ '[0-9]+$'
  AND length(regexp_replace(m.device_short_label, '[0-9]+$', '')) >= 1;
