// ============================================================================
// УТИЛИТА: Модальное окно подтверждения действия
// ============================================================================
window.confirmAction = function(title, message, onConfirm, onCancel) {
    // Проверяем, есть ли кастомное модальное окно в base.html
    const modalEl = document.getElementById('confirmModal');

    if (modalEl) {
        // Используем Bootstrap-модалку из base.html
        const modalTitle = modalEl.querySelector('.modal-title');
        const modalMessage = modalEl.querySelector('.modal-body');
        const confirmBtn = modalEl.querySelector('.btn-danger, .btn-confirm');
        const cancelBtn = modalEl.querySelector('.btn-secondary, .btn-cancel');

        if (modalTitle) modalTitle.textContent = title || 'Подтверждение';
        if (modalMessage) modalMessage.textContent = message || 'Вы уверены?';

        // Очищаем предыдущие обработчики
        const newConfirmBtn = confirmBtn?.cloneNode(true);
        const newCancelBtn = cancelBtn?.cloneNode(true);
        if (confirmBtn && newConfirmBtn) confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        if (cancelBtn && newCancelBtn) cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

        // Навешиваем новые обработчики
        newConfirmBtn?.addEventListener('click', function handler() {
            if (typeof onConfirm === 'function') onConfirm();
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
            newConfirmBtn?.removeEventListener('click', handler);
            newCancelBtn?.removeEventListener('click', handler);
        });

        newCancelBtn?.addEventListener('click', function handler() {
            if (typeof onCancel === 'function') onCancel();
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
            newConfirmBtn?.removeEventListener('click', handler);
            newCancelBtn?.removeEventListener('click', handler);
        });

        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    } else {
        // Fallback: нативный confirm(), если модалки нет
        if (confirm(`${title}\n\n${message}`)) {
            if (typeof onConfirm === 'function') onConfirm();
        } else {
            if (typeof onCancel === 'function') onCancel();
        }
    }
};