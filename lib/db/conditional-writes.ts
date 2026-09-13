/** 只拼接程式定義的 SQL，不接受使用者提供的欄名或條件。 */
export const currentPublishedJob = `EXISTS (
  SELECT 1 FROM world_slots w
  JOIN realms r ON r.id=w.realm_id
  JOIN realm_connections c ON c.id=r.connection_id
  WHERE w.id=download_jobs.world_slot_id AND w.published=1
    AND w.association_status='verified' AND w.source_identity IS NOT NULL
    AND (download_jobs.selector_kind='latest' OR w.publication_scope='all_archives')
    AND (download_jobs.selector_kind!='latest' OR w.source_identity=download_jobs.association_evidence)
    AND w.publication_version=download_jobs.publication_version
    AND w.connection_generation=download_jobs.connection_generation
    AND r.connection_generation=c.generation AND w.connection_generation=c.generation
    AND c.status='connected' AND r.verified_owner_xuid=c.owner_xuid
)`;

export const validAdminSession = `EXISTS (
  SELECT 1 FROM admin_accounts a WHERE a.id=admin_sessions.admin_id
  AND a.credential_version=admin_sessions.credential_version
)`;

export function rows<T>(result: D1Result<T>): T[] {
  if (!result.success) throw new Error("database_result_unknown");
  return result.results;
}
