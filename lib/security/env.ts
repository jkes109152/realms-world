/** 僅供伺服器使用；缺少設定時拒絕相關能力。 */
export interface AppEnv {
  DB: D1Database;
  SITE_ORIGIN?: string;
  REALMS_CLIENT_VERSION?: string;
  REALMS_DOWNLOAD_HOSTS?: string;
  REALMS_DOWNLOAD_REDIRECT_POLICY?: string;
  AUTH_KEYRING?: string;
  AUTH_ACTIVE_KEY_ID?: string;
  RATE_LIMIT_HMAC_KEY?: string;
  MAINTENANCE_TOKEN?: string;
  DOWNLOADS_ENABLED?: string;
}

export type RedirectRule = { from: string; to: string; forwardAuthorization: boolean };

export function siteOrigin(env: Pick<AppEnv, "SITE_ORIGIN">): string {
  const value = env.SITE_ORIGIN;
  if (!value) throw new Error("configuration_unavailable");
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))) {
    throw new Error("configuration_unavailable");
  }
  return value;
}

export function publicDownloadsEnabled(env: Pick<AppEnv, "DOWNLOADS_ENABLED">): boolean {
  return env.DOWNLOADS_ENABLED === "true";
}

export function clientVersion(env: Pick<AppEnv, "REALMS_CLIENT_VERSION">): string {
  const value = env.REALMS_CLIENT_VERSION;
  if (!value || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value) || /^0(?:\.0)+$/.test(value)) {
    throw new Error("source_not_configured");
  }
  return value;
}

function exactHost(value: unknown): value is string {
  return typeof value === "string" && value.length <= 253 &&
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);
}

export function downloadPolicy(env: Pick<AppEnv, "REALMS_DOWNLOAD_HOSTS" | "REALMS_DOWNLOAD_REDIRECT_POLICY">) {
  const hosts: unknown = JSON.parse(env.REALMS_DOWNLOAD_HOSTS || "[]");
  const redirects: unknown = JSON.parse(env.REALMS_DOWNLOAD_REDIRECT_POLICY || "[]");
  if (!Array.isArray(hosts) || !hosts.length || !hosts.every(exactHost) || !Array.isArray(redirects)) {
    throw new Error("source_not_configured");
  }
  for (const rule of redirects) {
    if (!rule || !exactHost(rule.from) || !exactHost(rule.to) ||
        !hosts.includes(rule.from) || !hosts.includes(rule.to) || typeof rule.forwardAuthorization !== "boolean" ||
        Object.keys(rule).some((key) => !["from", "to", "forwardAuthorization"].includes(key))) {
      throw new Error("source_not_configured");
    }
  }
  return { hosts: new Set<string>(hosts), redirects: redirects as RedirectRule[] };
}
