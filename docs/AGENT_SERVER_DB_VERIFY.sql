\set QUIET on
\pset format unaligned
\pset tuples_only on

SELECT '=== CHECK ===' AS banner;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'party_demands' AND column_name = 'device_code_prefix'
  ) THEN 'PASS  party_demands.device_code_prefix 列存在'
  ELSE 'FAIL  party_demands.device_code_prefix 缺失'
END AS check_result;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'manual_tracked_devices_assign_public_code'
  ) THEN 'PASS  manual_tracked_devices_assign_public_code 函数存在'
  ELSE 'FAIL  触发器函数缺失'
END AS check_result;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'manual_tracked_devices' AND t.tgname = 'trg_manual_tracked_code'
  ) THEN 'PASS  trg_manual_tracked_code 触发器已挂载'
  ELSE 'FAIL  触发器未挂载'
END AS check_result;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'manual_tracked_devices_assign_public_code'
      AND pg_get_functiondef(p.oid) ILIKE '%gen_random_bytes%'
  ) THEN 'FAIL  触发器仍引用 gen_random_bytes'
  ELSE 'PASS  触发器未引用 gen_random_bytes'
END AS check_result;

SELECT CASE WHEN to_regclass('public.party_demands') IS NOT NULL
  THEN 'PASS  party_demands' ELSE 'FAIL  party_demands 表缺失' END AS check_result;
SELECT CASE WHEN to_regclass('public.manual_tracked_devices') IS NOT NULL
  THEN 'PASS  manual_tracked_devices' ELSE 'FAIL  manual_tracked_devices 表缺失' END AS check_result;
SELECT CASE WHEN to_regclass('public.scene_macro_sites') IS NOT NULL
  THEN 'PASS  scene_macro_sites' ELSE 'FAIL  scene_macro_sites' END AS check_result;
SELECT CASE WHEN to_regclass('public.scenario_positions') IS NOT NULL
  THEN 'PASS  scenario_positions' ELSE 'FAIL  scenario_positions' END AS check_result;
SELECT CASE WHEN to_regclass('public.group_topics') IS NOT NULL
  THEN 'PASS  group_topics' ELSE 'FAIL  group_topics' END AS check_result;
SELECT CASE WHEN to_regclass('public.collection_shifts') IS NOT NULL
  THEN 'PASS  collection_shifts' ELSE 'FAIL  collection_shifts' END AS check_result;
SELECT CASE WHEN to_regclass('public.profiles') IS NOT NULL
  THEN 'PASS  profiles' ELSE 'FAIL  profiles 表缺失' END AS check_result;
SELECT CASE WHEN to_regclass('public.devices') IS NOT NULL
  THEN 'PASS  devices' ELSE 'FAIL  devices 表缺失' END AS check_result;

SELECT CASE WHEN to_regclass('public.agent_inbox_messages') IS NOT NULL
  THEN 'PASS  agent_inbox_messages' ELSE 'FAIL ' END AS check_result;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'send_agent_group_broadcast'
  ) THEN 'PASS  send_agent_group_broadcast RPC'
  ELSE 'FAIL '
END AS check_result;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_agent_group_rules'
  ) THEN 'PASS  upsert_agent_group_rules RPC'
  ELSE 'FAIL '
END AS check_result;

SELECT CASE WHEN to_regclass('public.agent_chat_messages') IS NOT NULL
  THEN 'PASS  agent_chat_messages' ELSE 'WARN  agent_chat_messages 缺失（聊天不落库）→ AGENT_CHAT_HISTORY_MIGRATION.sql' END AS check_result;

SELECT CASE WHEN to_regclass('public.bounties') IS NOT NULL
  THEN 'PASS  bounties' ELSE 'WARN  bounties 缺失' END AS check_result;

SELECT CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'scenario-workstation-snapshots')
  THEN 'PASS  storage bucket scenario-workstation-snapshots'
  ELSE 'WARN  缺少图片 bucket'
END AS check_result;

SELECT 'INFO  party_demands 缺 device_code_prefix 行数: ' ||
  COALESCE((
    SELECT count(*)::text FROM public.party_demands
    WHERE device_code_prefix IS NULL OR btrim(device_code_prefix) = ''
  ), 'N/A（列不存在）') AS check_result;

SELECT '=== END ===' AS banner;
