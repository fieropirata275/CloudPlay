from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CP_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://cloudplay:cloudplay@postgres:5432/cloudplay"
    redis_url: str = "redis://redis:6379/0"

    # URL pública (la que ven los clientes). Se usa para construir las URLs de señalización.
    public_url: str = "https://play.example.com"
    cors_origins: str = "*"

    jwt_secret: str = "change-me"
    jwt_ttl_minutes: int = 60 * 24 * 30
    allow_registration: bool = False

    # TURN con credenciales efímeras (coturn use-auth-secret / REST API)
    turn_secret: str = "change-me-too"
    stun_urls: str = "stun:play.example.com:3478"
    turn_urls: str = "turn:play.example.com:3478?transport=udp,turn:play.example.com:3478?transport=tcp"
    turn_ttl: int = 6 * 3600

    admin_email: str | None = None
    admin_password: str | None = None

    node_heartbeat_timeout: int = 30
    session_start_timeout: int = 120

    @property
    def ws_base(self) -> str:
        return self.public_url.replace("https://", "wss://").replace("http://", "ws://").rstrip("/")


settings = Settings()
