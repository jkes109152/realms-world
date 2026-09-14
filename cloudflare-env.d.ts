declare namespace Cloudflare {
  interface Env {
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
}
