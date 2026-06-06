/** PostgREST 在列未迁移时返回 schema cache 错误 */
export function isMissingColumnError(error: { message?: string } | null, column: string): boolean {
  if (!error?.message) return false;
  const msg = error.message;
  return (
    msg.includes(column) &&
    (msg.includes("schema cache") || msg.includes("Could not find") || msg.includes("does not exist"))
  );
}
