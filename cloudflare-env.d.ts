declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    QVERIS_API_KEY?: string;
    DEEPSEEK_API_KEY?: string;
    CAPTURE_TOKEN?: string;
    CN_SYNC_URL?: string;
    CN_SYNC_TOKEN?: string;
    CN_BOOTSTRAP_TOKEN?: string;
  }
}
