"""
Configuration management using pydantic-settings.
"""
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Server
    app_name: str = Field(default="Linear Kilo Webhook", alias="APP_NAME")
    debug: bool = Field(default=False, alias="DEBUG")
    host: str = Field(default="0.0.0.0", alias="HOST")
    port: int = Field(default=8000, alias="PORT")
    
    # Linear
    linear_api_key: str | None = Field(default=None, alias="LINEAR_API_KEY")
    linear_webhook_secret: str | None = Field(default=None, alias="LINEAR_WEBHOOK_SECRET")
    
    # Kilo
    kilo_api_key: str | None = Field(default=None, alias="KILO_API_KEY")
    kilo_cloud_enabled: bool = Field(default=False, alias="KILO_CLOUD_ENABLED")
    kilo_cloud_url: str = Field(default="https://app.kilo.ai", alias="KILO_CLOUD_URL")
    
    # Agent Mapping
    # Format: {"linear_user_id": "kilo_agent_id", ...}
    agent_mapping: dict = Field(default_factory=dict, alias="AGENT_MAPPING")
    
    # Authentication
    # Bearer token for webhook endpoint (alternative/additional to Linear signature)
    webhook_bearer_token: str | None = Field(default=None, alias="WEBHOOK_BEARER_TOKEN")
    # Require authentication for webhook endpoint
    webhook_auth_required: bool = Field(default=False, alias="WEBHOOK_AUTH_REQUIRED")
    # API key for admin endpoints
    admin_api_key: str | None = Field(default=None, alias="ADMIN_API_KEY")
    
    # Telegram User Authorization
    # Comma-separated list of allowed Telegram user IDs (e.g., "9504807,12345678")
    # If empty, all users are allowed (default behavior)
    telegram_allowed_users: str = Field(default="", alias="TELEGRAM_ALLOWED_USERS")
    
    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }


# Global settings instance
settings = Settings()
