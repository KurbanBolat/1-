import hashlib
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent
ENV_FILES = (
    PROJECT_ROOT / ".env.local",
    PROJECT_ROOT / ".env",
    BACKEND_DIR / ".env.local",
    BACKEND_DIR / ".env",
)


def _default_dev_secret_key() -> str:
    return hashlib.sha256(f"staypilot-local-dev:{PROJECT_ROOT}".encode("utf-8")).hexdigest()


class Settings(BaseSettings):
    app_name: str = "FindApart Stays"
    secret_key: str = Field(default_factory=_default_dev_secret_key)
    allow_insecure_secret_for_dev: bool = False
    access_token_expire_minutes: int = 30
    database_url: str = "sqlite:///./realestate.db"
    cors_origins: str = "http://localhost:3000"
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    openai_chat_timeout_seconds: float = 12.0
    chat_rate_limit_per_minute: int = 45
    chat_rate_limit_window_seconds: int = 60
    api_rate_limit_per_minute: int = 300
    api_rate_limit_window_seconds: int = 60
    chat_session_ttl_seconds: int = 1800
    chat_session_max_entries: int = 2000
    notification_webhook_url: str = ""
    notification_webhook_timeout_seconds: float = 4.0
    payment_webhook_secret: str = ""
    notification_retry_max_attempts: int = 3
    notification_retry_backoff_seconds: float = 0.35
    notification_log_rotate_max_bytes: int = 5_000_000
    notification_log_backup_count: int = 5
    notification_log_mask_pii: bool = True
    notification_email_enabled: bool = False
    notification_telegram_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_use_tls: bool = True
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    observability_log_level: str = "INFO"
    observability_metrics_window_minutes: int = 60
    observability_alert_payment_fail_rate: float = 0.2
    observability_alert_communication_fail_rate: float = 0.2
    sentry_dsn: str = ""
    sentry_environment: str = "local"
    sentry_traces_sample_rate: float = 0.0
    seed_admin_enabled: bool = False
    seed_admin_email: str = ""
    seed_admin_password: str = ""
    seed_admin_full_name: str = "System Admin"
    auth_token_ttl_hours: int = 24
    csrf_enforce: bool = True
    csrf_trusted_origins: str = ""
    csrf_cookie_name: str = "fa_csrf"
    csrf_header_name: str = "x-csrf-token"
    auth_cookie_name: str = "fa_access"
    auth_cookie_secure: bool = False
    auth_cookie_samesite: str = "lax"
    reservation_expire_scan_interval_seconds: int = 60

    model_config = SettingsConfigDict(env_file=tuple(str(path) for path in ENV_FILES), extra="ignore")


settings = Settings()
