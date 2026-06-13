/** Product display name shown in UI and document title. */
export const SITE_DISPLAY_NAME = "upaieasy!";

/** Short line under the brand on auth and in the document title. */
export const SITE_SUBTITLE = "数采一站式管理";

/** 运营主体（页脚展示） */
export const SITE_COMPANY_NAME = "爱特沃（湖北省武汉市洪山区）智能机器人有限公司";

/** ICP 备案号 */
export const SITE_ICP_NUMBER = "鄂ICP备2026023428号-1";

export const SITE_ICP_URL = "https://beian.miit.gov.cn/";

export function siteDocumentTitle(): string {
  return `${SITE_DISPLAY_NAME} · ${SITE_SUBTITLE}`;
}
