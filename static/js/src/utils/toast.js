/**
 * Toast Notification Module
 * Единая реализация showToast для всего приложения
 * Заменяет дублирующиеся реализации в base.js и modal/ui.js
 */

/**
 * Показать Toast уведомление
 * @param {string} title - Заголовок
 * @param {string} message - Сообщение
 * @param {string} type - Тип: 'success' | 'error' | 'warning' | 'info'
 * @param {object} options - Дополнительные опции
 * @returns {bootstrap.Toast|null}
 */
export function showToast(title, message, type = 'success', options = {}) {
    const toastEl = document.getElementById('liveToast');
    if (!toastEl) {
        console.log(`[${type}] ${title}: ${message}`);
        if (type === 'error') alert(title + ': ' + message);
        return null;
    }
    
    const toast = bootstrap.Toast.getOrCreateInstance(toastEl, { 
        delay: options.autoHide === false ? 0 : 3500 
    });
    
    // Обновляем заголовок и время
    const toastTitle = document.getElementById('toastTitle');
    const toastMessage = document.getElementById('toastMessage');
    const toastTime = document.getElementById('toastTime');
    const icon = document.getElementById('toastIcon');
    const header = toastEl.querySelector('.toast-header');
    
    if (toastTitle) toastTitle.textContent = title;
    if (toastMessage) toastMessage.textContent = message;
    if (toastTime) toastTime.textContent = 'только что';
    
    // Стили по типу
    const typeStyles = {
        error:   { icon: 'fa-exclamation-circle text-danger',   border: '#ef4444' },
        info:    { icon: 'fa-info-circle text-info',            border: '#3b82f6' },
        warning: { icon: 'fa-exclamation-triangle text-warning', border: '#f59e0b' },
        success: { icon: 'fa-check-circle text-success',        border: '#22c55e' },
    };
    
    const style = typeStyles[type] || typeStyles.success;
    
    if (icon) icon.className = `fas ${style.icon} me-2`;
    if (header) header.style.borderLeft = `4px solid ${style.border}`;
    
    toast.show();
    return toast;
}

/**
 * Инициализация Toast (если нужно)
 */
export function initToast() {
    const toastEl = document.getElementById('liveToast');
    if (toastEl) {
        // Toast создаётся лениво через getOrCreateInstance
    }
}
