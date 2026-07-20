"""
Тесты для security_service.py (Безопасность).

Проверяют:
- Rate limiting (ограничение частоты запросов)
- Валидацию сложности паролей
- Проверку распространённых паролей
- Полную валидацию паролей
"""

import pytest
from services.security_service import (
    RateLimiter,
    rate_limit,
    validate_password_strength,
    check_password_common,
    validate_password_full,
)

# ============================================================================
# RateLimiter — ограничение частоты запросов
# ============================================================================


class TestRateLimiter:
    """Тесты класса RateLimiter."""

    def test_initial_state_not_limited(self):
        """Новый rate limiter не должен блокировать запросы."""
        limiter = RateLimiter()
        assert (
            limiter.is_rate_limited("test_key", max_requests=5, window_seconds=60)
            is False
        )

    def test_requests_within_limit(self):
        """Запросы в пределах лимита должны проходить."""
        limiter = RateLimiter()
        for i in range(5):
            assert (
                limiter.is_rate_limited("test_key", max_requests=5, window_seconds=60)
                is False
            )

    def test_request_exceeding_limit(self):
        """Превышение лимита должно возвращать True."""
        limiter = RateLimiter()
        for i in range(5):
            limiter.is_rate_limited("test_key", max_requests=5, window_seconds=60)

        assert (
            limiter.is_rate_limited("test_key", max_requests=5, window_seconds=60)
            is True
        )

    def test_different_keys_independent(self):
        """Разные ключи должны иметь независимые лимиты."""
        limiter = RateLimiter()
        for i in range(5):
            limiter.is_rate_limited("key1", max_requests=5, window_seconds=60)

        assert (
            limiter.is_rate_limited("key1", max_requests=5, window_seconds=60) is True
        )
        assert (
            limiter.is_rate_limited("key2", max_requests=5, window_seconds=60) is False
        )

    def test_reset_clears_limit(self):
        """Сброс лимита должен освободить ключ."""
        limiter = RateLimiter()
        for i in range(5):
            limiter.is_rate_limited("test_key", max_requests=5, window_seconds=60)

        assert (
            limiter.is_rate_limited("test_key", max_requests=5, window_seconds=60)
            is True
        )

        limiter.reset("test_key")
        assert (
            limiter.is_rate_limited("test_key", max_requests=5, window_seconds=60)
            is False
        )

    def test_reset_all_clears_all(self):
        """Сброс всех лимитов должен очистить все ключи."""
        limiter = RateLimiter()
        for i in range(5):
            limiter.is_rate_limited("key1", max_requests=5, window_seconds=60)
            limiter.is_rate_limited("key2", max_requests=5, window_seconds=60)

        limiter.reset_all()

        assert (
            limiter.is_rate_limited("key1", max_requests=5, window_seconds=60) is False
        )
        assert (
            limiter.is_rate_limited("key2", max_requests=5, window_seconds=60) is False
        )

    def test_get_remaining_requests(self):
        """Получение оставшихся запросов."""
        limiter = RateLimiter()
        remaining = limiter.get_remaining_requests(
            "test_key", max_requests=5, window_seconds=60
        )
        assert remaining == 5

        for i in range(3):
            limiter.is_rate_limited("test_key", max_requests=5, window_seconds=60)

        remaining = limiter.get_remaining_requests(
            "test_key", max_requests=5, window_seconds=60
        )
        assert remaining == 2

    def test_account_lock_after_max_attempts(self):
        """Блокировка аккаунта после max_attempts неудачных попыток."""
        limiter = RateLimiter()
        max_attempts = 5

        for i in range(max_attempts):
            limiter.lock_account("user1", max_attempts=max_attempts)

        assert limiter.is_account_locked("user1", max_attempts=max_attempts) is True

    def test_account_unlock(self):
        """Разблокировка аккаунта."""
        limiter = RateLimiter()
        for i in range(5):
            limiter.lock_account("user1", max_attempts=5)

        assert limiter.is_account_locked("user1", max_attempts=5) is True

        limiter.unlock_account("user1")
        assert limiter.is_account_locked("user1", max_attempts=5) is False


# ============================================================================
# rate_limit — декоратор ограничения
# ============================================================================


class TestRateLimitDecorator:
    """Тесты декоратора rate_limit."""

    def test_rate_limit_exceeded_returns_429(self, app, client):
        """Превышение лимита должно возвращать 429 Too Many Requests."""
        from flask import jsonify
        from services.security_service import rate_limiter

        # Сбрасываем rate_limiter перед тестом
        rate_limiter.reset_all()

        # Добавляем тестовый маршрут к существующему приложению
        # (у которого уже инициализирован LoginManager)
        @app.route("/test-rate-limit")
        @rate_limit(max_requests=3, window_seconds=60)
        def test_route():
            return jsonify({"status": "ok"})

        # Первые 3 запроса должны пройти (пользователь не аутентифицирован)
        for i in range(3):
            resp = client.get("/test-rate-limit", content_type="application/json")
            assert resp.status_code == 200

        # 4-й запрос — 429
        resp = client.get("/test-rate-limit", content_type="application/json")
        assert resp.status_code == 429
        data = resp.get_json()
        assert "error" in data
        assert "retry_after" in data


# ============================================================================
# Валидация паролей
# ============================================================================


class TestValidatePasswordStrength:
    """Тесты функции validate_password_strength()."""

    def test_strong_password_passes(self):
        """Сильный пароль должен проходить валидацию."""
        is_valid, error = validate_password_strength("StrongP@ss1")
        assert is_valid is True
        assert error is None

    def test_short_password_fails(self):
        """Пароль короче 8 символов должен проваливаться."""
        is_valid, error = validate_password_strength("Ab1!")
        assert is_valid is False
        assert "8 символов" in error

    def test_password_without_uppercase_fails(self):
        """Пароль без заглавной буквы должен проваливаться."""
        is_valid, error = validate_password_strength("strongpass1!")
        assert is_valid is False
        assert "заглавную" in error

    def test_password_without_lowercase_fails(self):
        """Пароль без строчной буквы должен проваливаться."""
        is_valid, error = validate_password_strength("STRONGPASS1!")
        assert is_valid is False
        assert "строчную" in error

    def test_password_without_digit_fails(self):
        """Пароль без цифры должен проваливаться."""
        is_valid, error = validate_password_strength("StrongPass!")
        assert is_valid is False
        assert "цифру" in error

    def test_password_without_special_char_fails(self):
        """Пароль без спецсимвола должен проваливаться."""
        is_valid, error = validate_password_strength("StrongPass1")
        assert is_valid is False
        assert "специальный" in error or "спец" in error


class TestCheckPasswordCommon:
    """Тесты функции check_password_common()."""

    def test_common_password_detected(self):
        """Распространённый пароль должен быть обнаружен."""
        assert check_password_common("password") is True
        assert check_password_common("123456") is True
        assert check_password_common("qwerty") is True

    def test_uncommon_password_not_detected(self):
        """Уникальный пароль не должен быть обнаружен."""
        assert check_password_common("Xk9#mP2$vL5@nQ8") is False

    def test_case_insensitive(self):
        """Проверка должна быть регистронезависимой."""
        assert check_password_common("PASSWORD") is True
        assert check_password_common("Password") is True


class TestValidatePasswordFull:
    """Тесты функции validate_password_full()."""

    def test_strong_password_passes(self):
        """Сильный уникальный пароль должен проходить."""
        is_valid, error = validate_password_full("Str0ng!Pass")
        assert is_valid is True
        assert error is None

    def test_short_password_fails(self):
        """Короткий пароль должен проваливаться."""
        is_valid, error = validate_password_full("Ab1!")
        assert is_valid is False

    def test_common_password_fails(self):
        """Распространённый пароль должен проваливаться.

        Ни один пароль из списка common не проходит проверку сложности,
        поэтому мокаем check_password_common для проверки этого пути.
        """
        from unittest.mock import patch
        from services import security_service

        with patch.object(security_service, "check_password_common", return_value=True):
            is_valid, error = validate_password_full("Str0ng!Pass")
            assert is_valid is False
            assert "распространён" in error

    def test_password_with_username_fails(self):
        """Пароль, содержащий имя пользователя, должен проваливаться."""
        is_valid, error = validate_password_full("Admin123!", username="admin")
        assert is_valid is False
        assert "имя пользователя" in error

    def test_password_without_username_passes(self):
        """Без username проверка на совпадение пропускается."""
        is_valid, error = validate_password_full("Str0ng!Pass")
        assert is_valid is True
        assert error is None


# ============================================================================
# Интеграционные тесты
# ============================================================================


class TestSecurityIntegration:
    """Интеграционные тесты безопасности."""

    def test_rate_limit_and_password_validation_together(self):
        """Комбинация rate limiting и валидации паролей."""
        limiter = RateLimiter()
        limiter.reset_all()

        is_valid, error = validate_password_full("Str0ng!Pass")
        assert is_valid is True

        assert (
            limiter.is_rate_limited("test_user", max_requests=5, window_seconds=60)
            is False
        )
