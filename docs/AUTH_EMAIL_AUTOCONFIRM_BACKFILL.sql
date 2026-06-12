-- 手机号注册使用 synthetic email，无需邮件确认；配合 ENABLE_EMAIL_AUTOCONFIRM=true 使用。
-- 对已注册但未确认的账号一次性补全 email_confirmed_at。
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email_confirmed_at IS NULL;
