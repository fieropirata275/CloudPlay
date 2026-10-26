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
    # "coturn" (secreto compartido, por defecto), "cloudflare" (TURN gestionado de Cloudflare: sin puertos UDP
    # abiertos, ideal con Cloudflare Tunnel) o "none" (solo STUN)
    turn_provider: str = "coturn"
    cf_turn_key_id: str = ""
    cf_turn_api_token: str = ""
    cf_turn_ttl: int = 24 * 3600

    # Alta automática de nodos: quien tenga este token puede dar de alta un nodo gaming (plantillas, ISO, k8s)
    join_token: str = ""
    # S3 de partidas que se entrega a los nodos al darse de alta (así no va en ningún instalador público)
    node_s3_endpoint: str = ""
    node_s3_access_key: str = ""
    node_s3_secret_key: str = ""
    node_s3_bucket: str = "cloudplay-saves"

    admin_email: str | None = None
    admin_password: str | None = None

    node_heartbeat_timeout: int = 30
    session_start_timeout: int = 120
    queue_max_wait: int = 900
    queue_max_length: int = 200

    @property
    def ws_base(self) -> str:
        return self.public_url.replace("https://", "wss://").replace("http://", "ws://").rstrip("/")


settings = Settings()
