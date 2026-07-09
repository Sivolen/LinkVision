/**
 * Utility Functions Module
 * Общие вспомогательные функции
 */
import { t } from '../i18n/i18n.js';

/**
 * Экранирование HTML
 */
export function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Получить сообщение об ошибке из ответа
 */
export async function getErrorMessage(response) {
    try {
        const data = await response.json();
        return data.error || data.message || t('toast.errorTitle');
    } catch {
        return t('toast.httpErrorShort', { status: response.status });
    }
}

/**
 * Форматировать дату и время
 */
export function formatDateTime(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return date.toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

/**
 * Получить класс для badge статуса
 */
export function getStatusBadgeClass(status) {
    switch (status) {
        case 'up': return 'bg-success';
        case 'down': return 'bg-danger';
        case 'unreachable': return 'bg-warning';
        default: return 'bg-secondary';
    }
}

/**
 * Получить CSRF токен
 */
export function getCsrfToken() {
    const token = document.querySelector('meta[name="csrf-token"]');
    return token ? token.getAttribute('content') : '';
}

/**
 * Инициализация утилит
 */
export function initUtils() {
    window.escapeHtml = escapeHtml;
    window.getCsrfToken = getCsrfToken;
    Logger.info('✅ Utils инициализированы');
}
