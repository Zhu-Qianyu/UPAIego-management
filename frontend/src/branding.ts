/** Product display name shown in UI and document title. */
export const SITE_DISPLAY_NAME = "upaieasy!";

/** Short line under the brand on auth and in the document title. */
export const SITE_SUBTITLE = "数采一站式管理";

export function siteDocumentTitle(): string {
  return `${SITE_DISPLAY_NAME} · ${SITE_SUBTITLE}`;
}
