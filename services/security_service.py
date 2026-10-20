"""
Сервис безопасности.

- Rate limiting (ограничение частоты запросов)
- Валидация сложности паролей
- Защита от brute-force атак

Для production с несколькими workers рекомендуется использовать Redis.
"""

import time
import re
import uuid
from typing import Callable, Dict, Optional, Tuple
from collections import defaultdict
from functools import wraps
from flask import (
    request,
    jsonify,
    current_app,
    has_app_context,
    render_template,
    redirect,
    url_for,
)
from flask_login import current_user
from utils.logger import app_logger

# ============================================================================
# Rate Limiting
# ============================================================================


class RateLimiter:
    """
    Rate limiter с поддержкой Redis для production.

    Для single-worker: использует память
    Для multi-worker: использует Redis (если настроен)
    """

    def __init__(self, redis_client=None):
        # Хранилище: {key: [(timestamp, count)]}
        self._storage: Dict[str, list] = defaultdict(list)
        self._lock_counts: Dict[str, int] = defaultdict(int)
        self._redis = redis_client
        self._redis_retry_after = 0.0

    def _get_redis(self):
        """Получить Redis клиент из Flask app config."""
        if self._redis:
            return self._redis

        if time.monotonic() < self._redis_retry_after:
            return None

        if has_app_context():
            redis_url = current_app.config.get("REDIS_URL")
            if redis_url:
                try:
                    import redis

                    self._redis = redis.from_url(redis_url)
                    return self._redis
                except ImportError:
                    app_logger.warning(
                        "REDIS_URL is configured but the redis package is unavailable"
                    )
                    self._redis_retry_after = time.monotonic() + 60
        return None

    def _disable_redis(self, error: Exception) -> None:
        """Temporarily use the local limiter after a Redis availability error."""
        self._redis = None
        self._redis_retry_after = time.monotonic() + 60
        app_logger.warning(
            "Redis rate limiter is unavailable (%s); using the in-memory fallback for 60 seconds",
            type(error).__name__,
        )

    def is_rate_limited(
        self, key: str, max_requests: int = 10, window_seconds: int = 60
    ) -> bool:
        """
        Проверить, превышен ли лимит запросов.

        Args:
            key: Уникальный ключ (например, IP или user_id)
            max_requests: Максимум запросов за окно
            window_seconds: Размер окна в секундах

        Returns:
            bool: True если лимит превышен
        """
        redis = self._get_redis()

        if redis:
            try:
                now_ms = int(time.time() * 1000)
                window_ms = window_seconds * 1000
                window_key = f"ratelimit:{key}"
                script = """
                    local now = tonumber(ARGV[1])
                    local window = tonumber(ARGV[2])
                    local limit = tonumber(ARGV[3])
                    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
                    local count = redis.call('ZCARD', KEYS[1])
                    if count >= limit then
                        local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
                        local retry = math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))
                        return {1, count, retry}
                    end
                    redis.call('ZADD', KEYS[1], now, ARGV[4])
                    redis.call('PEXPIRE', KEYS[1], window)
                    return {0, count + 1, 0}
                """
                result = redis.eval(
                    script,
                    1,
                    window_key,
                    now_ms,
                    window_ms,
                    max_requests,
                    f"{now_ms}:{uuid.uuid4().hex}",
                )
                return bool(int(result[0]))
            except Exception as error:
                self._disable_redis(error)

        # In-memory implementation (single worker)
        now = time.time()
        window_start = now - window_seconds

        # Очистить старые записи
        self._storage[key] = [ts for ts in self._storage[key] if ts > window_start]
        if not self._storage[key]:
            self._storage.pop(key, None)

        # Проверить лимит
        if len(self._storage[key]) >= max_requests:
            return True

        # Добавить текущий запрос
        self._storage[key].append(now)
        return False

    def get_remaining_requests(
        self, key: str, max_requests: int = 10, window_seconds: int = 60
    ) -> int:
        """Получить количество оставшихся запросов."""
        redis = self._get_redis()

        if redis:
            try:
                now_ms = int(time.time() * 1000)
                window_key = f"ratelimit:{key}"
                redis.zremrangebyscore(
                    window_key, "-inf", now_ms - window_seconds * 1000
                )
                current_count = int(redis.zcard(window_key))
                return max(0, max_requests - current_count)
            except Exception as error:
                self._disable_redis(error)

        now = time.time()
        window_start = now - window_seconds
        self._storage[key] = [ts for ts in self._storage[key] if ts > window_start]
        remaining = max(0, max_requests - len(self._storage[key]))
        if not self._storage[key]:
            self._storage.pop(key, None)
        return remaining

    def get_retry_after(self, key: str, window_seconds: int = 60) -> int:
        """Сколько секунд осталось до освобождения самого старого запроса."""
        redis = self._get_redis()
        if redis:
            try:
                now_ms = int(time.time() * 1000)
                window_key = f"ratelimit:{key}"
                redis.zremrangebyscore(
                    window_key, "-inf", now_ms - window_seconds * 1000
                )
                oldest = redis.zrange(window_key, 0, 0, withscores=True)
                if not oldest:
                    return 0
                return max(
                    1,
                    int((oldest[0][1] + window_seconds * 1000 - now_ms + 999) // 1000),
                )
            except Exception as error:
                self._disable_redis(error)

        now = time.time()
        window_start = now - window_seconds
        timestamps = [ts for ts in self._storage.get(key, []) if ts > window_start]
        if not timestamps:
            self._storage.pop(key, None)
            return 0
        self._storage[key] = timestamps
        return max(1, int(timestamps[0] + window_seconds - now + 0.999))

    def reset(self, key: str) -> None:
        """Сбросить лимит для ключа."""
        redis = self._get_redis()
        if redis:
            try:
                redis.delete(f"ratelimit:{key}")
                return
            except Exception as error:
                self._disable_redis(error)
        self._storage[key] = []

    def reset_all(self) -> None:
        """Сбросить все rate limit счётчики."""
        redis = self._get_redis()
        if redis:
            try:
                keys = list(redis.scan_iter("ratelimit:*"))
                if keys:
                    redis.delete(*keys)
                return
            except Exception as error:
                self._disable_redis(error)
        self._storage.clear()
        self._lock_counts.clear()

    def lock_account(self, key: str, max_attempts: int = 5) -> None:
        """Заблокировать аккаунт после неудачных попыток."""
        self._lock_counts[key] += 1

    def is_account_locked(self, key: str, max_attempts: int = 5) -> bool:
        """Проверить, заблокирован ли аккаунт."""
        return self._lock_counts[key] >= max_attempts

    def unlock_account(self, key: str) -> None:
        """Разблокировать аккаунт."""
        self._lock_counts[key] = 0


# Глобальный экземпляр
rate_limiter = RateLimiter()


def rate_limit(
    max_requests: int = 10,
    window_seconds: int = 60,
    methods=None,
    key_func: Optional[Callable[[], str]] = None,
):
    """
    Декоратор для ограничения частоты запросов.

    Usage:
        @api_bp.route("/login", methods=["POST"])
        @rate_limit(max_requests=5, window_seconds=60)
        def login():
            ...
    """

    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if methods is not None and request.method not in methods:
                return f(*args, **kwargs)

            # Дополнительный ключ позволяет разделить общий лимит IP и лимит
            # конкретного логина, не меняя поведение остальных маршрутов.
            if key_func is not None:
                key = f"{key_func()}:{request.endpoint}"
            elif current_user.is_authenticated:
                key = f"user:{current_user.id}:{request.endpoint}"
            else:
                key = f"ip:{request.remote_addr}:{request.endpoint}"
            if rate_limiter.is_rate_limited(key, max_requests, window_seconds):
                remaining = rate_limiter.get_remaining_requests(
                    key, max_requests, window_seconds
                )
                retry_after = rate_limiter.get_retry_after(key, window_seconds)

                # Если запрос JSON — возвращаем JSON
                if request.is_json:
                    return (
                        jsonify(
                            {
                                "error": "Слишком много запросов",
                                "retry_after": retry_after,
                                "remaining": remaining,
                            }
                        ),
                        429,
                    )

                # Если запрос HTML — возвращаем красивую страницу
                return (
                    render_template(
                        "429.html",
                        retry_after=retry_after,
                        hide_rate_limit_alerts=True,
                    ),
                    429,
                )

            return f(*args, **kwargs)

        return decorated_function

    return decorator


# ============================================================================
# Валидация паролей
# ============================================================================


def validate_password_strength(password: str) -> Tuple[bool, Optional[str]]:
    """
    Проверить сложность пароля.

    Требования:
    - Минимум 8 символов
    - Хотя бы одна заглавная буква
    - Хотя бы одна строчная буква
    - Хотя бы одна цифра
    - Хотя бы один специальный символ

    Args:
        password: Пароль для проверки

    Returns:
        Tuple[bool, Optional[str]]: (успех, сообщение об ошибке)
    """
    if len(password) < 8:
        return False, "Пароль должен содержать минимум 8 символов"

    if not re.search(r"[A-ZА-ЯЁ]", password):
        return False, "Пароль должен содержать хотя бы одну заглавную букву"

    if not re.search(r"[a-zа-яё]", password):
        return False, "Пароль должен содержать хотя бы одну строчную букву"

    if not re.search(r"\d", password):
        return False, "Пароль должен содержать хотя бы одну цифру"

    if not re.search(r'[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\;\'`~]', password):
        return False, "Пароль должен содержать хотя бы один специальный символ"

    return True, None


def check_password_common(password: str) -> bool:
    """
    Проверить пароль на распространённость.

    Args:
        password: Пароль для проверки

    Returns:
        bool: True если пароль распространённый
    """
    common_passwords = {
        "password",
        "123456",
        "12345678",
        "qwerty",
        "abc123",
        "monkey",
        "1234567",
        "letmein",
        "trustno1",
        "dragon",
        "baseball",
        "iloveyou",
        "master",
        "sunshine",
        "ashley",
        "bailey",
        "passw0rd",
        "shadow",
        "123123",
        "654321",
        "superman",
        "qazwsx",
        "michael",
        "football",
        "password1",
        "admin",
        "admin123",
        "root",
        "toor",
        "pass",
        "test",
        "guest",
        "master",
        "changeme",
        "123456789",
        "1234567890",
    }

    return password.lower() in common_passwords


def validate_password_full(
    password: str, username: Optional[str] = None
) -> Tuple[bool, Optional[str]]:
    """
    Полная проверка пароля.

    Args:
        password: Пароль для проверки
        username: Имя пользователя (для проверки на совпадение)

    Returns:
        Tuple[bool, Optional[str]]: (успех, сообщение об ошибке)
    """
    # Проверка сложности
    is_valid, error = validate_password_strength(password)
    if not is_valid:
        return False, error

    # Проверка на распространённость
    if check_password_common(password):
        return False, "Этот пароль слишком распространён. Выберите более уникальный"

    # Проверка на совпадение с username
    if username and username.lower() in password.lower():
        return False, "Пароль не должен содержать имя пользователя"

    return True, None


# ============================================================================
# Утилиты безопасности
# ============================================================================


def get_client_ip() -> str:
    """
    Получить IP адрес клиента с учётом прокси.

    Returns:
        str: IP адрес
    """
    if request.headers.get("X-Forwarded-For"):
        return request.headers.get("X-Forwarded-For").split(",")[0].strip()
    elif request.headers.get("X-Real-IP"):
        return request.headers.get("X-Real-IP")
    else:
        return request.remote_addr or "unknown"
