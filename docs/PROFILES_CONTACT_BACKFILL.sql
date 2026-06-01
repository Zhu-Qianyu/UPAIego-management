-- 可选：为已注册用户批量补全 real_name / phone（管理员在 SQL Editor 执行）
-- 前置：docs/BOUNTY_OPERATOR_AUDIT_MIGRATION.sql 已添加字段
--
-- 1) 查看缺资料的用户
-- SELECT id, role, display_name, real_name, phone FROM public.profiles
-- WHERE real_name IS NULL OR trim(real_name) = '' OR phone IS NULL OR trim(phone) = '';

-- 2) 按用户 UUID 单条补录（示例）
-- UPDATE public.profiles
-- SET real_name = '张三', phone = '13800138000', updated_at = now()
-- WHERE id = 'YOUR_USER_UUID';

-- 3) 若暂时用 display_name 兜底真名（手机仍需人工补）
-- UPDATE public.profiles
-- SET real_name = COALESCE(NULLIF(trim(real_name), ''), NULLIF(trim(display_name), '')),
--     updated_at = now()
-- WHERE real_name IS NULL OR trim(real_name) = '';
