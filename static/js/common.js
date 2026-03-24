// common.js - общие утилиты

// ============================================================================
// ФОРМАТИРОВАНИЕ ДАТЫ
// ============================================================================
function formatDateTime(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

// ============================================================================
// ПОЛУЧЕНИЕ CSS-КЛАССА ДЛЯ СТАТУСА
// ============================================================================
function getStatusBadgeClass(status) {
    const s = String(status).toLowerCase();
    if (s === 'up' || s === 'true' || s === 'online') return 'bg-success';
    if (s === 'down' || s === 'false' || s === 'offline') return 'bg-danger';
    if (s === 'warning') return 'bg-warning';
    return 'bg-secondary';
}

// ============================================================================
// FETCH С ПОВТОРНЫМИ ПОПЫТКАМИ
// ============================================================================
async function fetchWithRetry(url, options = {}, retries = 3, delay = 500) {
    // Добавляем CSRF-токен для изменяющих методов
    if (options.method && ['POST', 'PUT', 'DELETE'].includes(options.method.toUpperCase())) {
        options.headers = options.headers || {};
        options.headers['X-CSRFToken'] = getCsrfToken();
    }
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            return response;
        } catch (error) {
            const isLastAttempt = i === retries - 1;
            if (isLastAttempt) throw error;
            Logger.warn(`⚠️ fetch failed (attempt ${i+1}/${retries}), retrying in ${delay}ms...`, error);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
}
