// lock.js – блокировка перемещения устройств
let cy = null;
let dragLocked = localStorage.getItem('dragLocked') === 'true';

// Синхронизируем глобальную переменную
window.dragLocked = dragLocked;

export function initLock(instance) {
    cy = instance;
    updateLockButton();
    window.toggleLock = () => {
        if (window.isOperator) return;
        dragLocked = !dragLocked;
        localStorage.setItem('dragLocked', dragLocked);
        window.dragLocked = dragLocked;   // ← синхронизация
        updateLockButton();
    };
}

export function isDragLocked() { return dragLocked; }

function updateLockButton() {
    const lockBtn = document.getElementById('lockMode');
    if (!lockBtn) return;
    if (window.isOperator) {
        lockBtn.disabled = true;
        lockBtn.classList.add('active');
        lockBtn.innerHTML = '<i class="fas fa-lock"></i>';
        lockBtn.title = 'Оператор не может разблокировать';
        return;
    }
    if (dragLocked) {
        lockBtn.classList.add('active');
        lockBtn.innerHTML = '<i class="fas fa-lock"></i>';
        lockBtn.title = 'Разблокировать перемещение';
    } else {
        lockBtn.classList.remove('active');
        lockBtn.innerHTML = '<i class="fas fa-lock-open"></i>';
        lockBtn.title = 'Заблокировать перемещение';
    }
}