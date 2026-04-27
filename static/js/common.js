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
    if (s === 'partial') return 'bg-warning';   // жёлтый
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
            if (response.status === 400 || response.status === 401) {
                // Если это не запрос heartbeat (/api/maps) и не viewport, перенаправляем
                if (!url.includes('/api/maps') && !url.includes('/viewport')) {
                    window.location.href = '/auth/login';
                }
                // В противном случае просто пробрасываем ошибку
                throw new Error(`Session expired: ${response.status}`);
            }
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
function wrapText(text, maxChars = 25) {
    if (!text) return '';
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (let word of words) {
        // Если слово само по себе длиннее maxChars, разбиваем его на части
        while (word.length > maxChars) {
            if (currentLine) {
                lines.push(currentLine);
                currentLine = '';
            }
            lines.push(word.slice(0, maxChars));
            word = word.slice(maxChars);
        }
        // Теперь word гарантированно короче maxChars
        if (currentLine.length + word.length + 1 <= maxChars) {
            currentLine = currentLine ? currentLine + ' ' + word : word;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines.join('\n');
}