"""
Сервис безопасности.

- Rate limiting (ограничение частоты запросов)
- Валидация сложности паролей
- Защита от brute-force атак
"""

import time
from typing import Dict, Optional, Tuple
from collections import defaultdict
from functools import wraps
from flask import request, jsonify, current_app
from flask_login import current_user
import re

# ============================================================================
# Rate Limiting
# ============================================================================


class RateLimiter:
    """
    Простой rate limiter на основе памяти.

    Для production рекомендуется использовать Redis или Memcached.
    """

    def __init__(self):
        # Хранилище: {key: [(timestamp, count)]}
        self._storage: Dict[str, list] = defaultdict(list)
        self._lock_counts: Dict[str, int] = defaultdict(int)

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
        now = time.time()
        window_start = now - window_seconds

        # Очистить старые записи
        self._storage[key] = [ts for ts in self._storage[key] if ts > window_start]

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
        now = time.time()
        window_start = now - window_seconds

        self._storage[key] = [ts for ts in self._storage[key] if ts > window_start]

        return max(0, max_requests - len(self._storage[key]))

    def reset(self, key: str) -> None:
        """Сбросить лимит для ключа."""
        self._storage[key] = []

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


def rate_limit(max_requests: int = 10, window_seconds: int = 60):
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
            # Ключ: IP адрес или user_id
            if current_user.is_authenticated:
                key = f"user:{current_user.id}"
            else:
                key = f"ip:{request.remote_addr}"

            if rate_limiter.is_rate_limited(key, max_requests, window_seconds):
                remaining = rate_limiter.get_remaining_requests(
                    key, max_requests, window_seconds
                )
                retry_after = window_seconds

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


def sanitize_input(value: str, max_length: int = 256) -> str:
    """
    Очистить пользовательский ввод.

    Args:
        value: Входная строка
        max_length: Максимальная длина

    Returns:
        str: Очищенная строка
    """
    if not value:
        return ""

    # Ограничить длину
    value = value[:max_length]

    # Удалить опасные символы (базовая защита от XSS)
    value = value.replace("<", "&lt;")
    value = value.replace(">", "&gt;")
    value = value.replace('"', "&quot;")
    value = value.replace("'", "&#x27;")

    return value.strip()
