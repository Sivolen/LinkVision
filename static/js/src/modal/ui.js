/**
 * UI Components Module
 * UI компоненты: Toast, уведомления
 */

/**
 * Показать Toast уведомление
 */
export function showToast(title, message, type = 'info') {
    const toastEl = document.getElementById('liveToast');
    if (!toastEl) return;

    const toast = new bootstrap.Toast(toastEl, { delay: 3500 });
    
    const titleEl = toastEl.querySelector('.toast-title');
    const bodyEl = toastEl.querySelector('.toast-body');
    const iconEl = document.getElementById('toastIcon');

    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = message;
    
    // Иконка по типу
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    if (iconEl) {
        iconEl.className = `fas ${icons[type] || icons.info}`;
    }

    // Цвет иконки по типу
    iconEl.classList.remove('text-success', 'text-danger', 'text-warning', 'text-info');
    iconEl.classList.add(`text-${type}`);

    toast.show();
}

/**
 * Инициализация Toast
 */
export function initToast() {
    const toastEl = document.getElementById('liveToast');
    if (toastEl && !toastEl.toastInstance) {
        toastEl.toastInstance = new bootstrap.Toast(toastEl, { delay: 3500 });
    }
    Logger.info('Toast инициализирован');
}
