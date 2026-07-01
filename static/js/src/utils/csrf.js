/**
 * CSRF Token Utility
 * Единый источник для получения CSRF-токена
 */

/**
 * Получить CSRF-токен из meta-тега
 */
export function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
}
