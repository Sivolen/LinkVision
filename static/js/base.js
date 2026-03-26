// base.js - глобальные функции для всех страниц
(function() {
    // Глобальные переменные (устанавливаются из шаблона)
    window.Logger = {
        enabledDebug: window.debugMode || false,
        info: function(...args) { console.log('[INFO]', ...args); },
        warn: function(...args) { console.warn('[WARN]', ...args); },
        error: function(...args) { console.error('[ERROR]', ...args); },
        debug: function(...args) { if (this.enabledDebug) console.debug('[DEBUG]', ...args); }
    };
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
    window.getCsrfToken = function() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : '';
    };

    window.showToast = function(title, message, type = 'success', options = {}) {
        const toastEl = document.getElementById('liveToast');
        if (!toastEl) {
            console.log(`[${type}] ${title}: ${message}`);
            if (type === 'error') alert(title + ': ' + message);
            return null;
        }
        const toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: options.autoHide === false ? 0 : 3500 });
        document.getElementById('toastTitle').textContent = title;
        document.getElementById('toastMessage').textContent = message;
        document.getElementById('toastTime').textContent = 'только что';
        const icon = document.getElementById('toastIcon');
        const header = toastEl.querySelector('.toast-header');
        if (type === 'error') {
            if (icon) icon.className = 'fas fa-exclamation-circle text-danger me-2';
            if (header) header.style.borderLeft = '4px solid #ef4444';
        } else if (type === 'info') {
            if (icon) icon.className = 'fas fa-info-circle text-info me-2';
            if (header) header.style.borderLeft = '4px solid #3b82f6';
        } else {
            if (icon) icon.className = 'fas fa-check-circle text-success me-2';
            if (header) header.style.borderLeft = '4px solid #22c55e';
        }
        toast.show();
        return toast;
    };

    window.getErrorMessage = async function(response) {
        try {
            const data = await response.clone().json();
            return data.error || `Ошибка ${response.status}: ${response.statusText}`;
        } catch (e) {
            try {
                const text = await response.clone().text();
                if (text) return text;
            } catch (e2) {}
            return `Ошибка ${response.status}: ${response.statusText}`;
        }
    };

    window.updateBackendStatus = function(isConnected) {
        const dot = document.getElementById('backend-status-dot');
        const text = document.getElementById('backend-status-text');
        if (!dot || !text) return;
        if (isConnected) {
            dot.className = 'status-dot online';
            text.textContent = 'Сервер доступен';
        } else {
            dot.className = 'status-dot offline';
            text.textContent = 'Сервер недоступен';
        }
    };

    window.toggleSidebar = function() {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebarToggle');
        sidebar.classList.toggle('collapsed');
        const icon = toggle.querySelector('i');
        if (sidebar.classList.contains('collapsed')) {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-chevron-right');
        } else {
            icon.classList.remove('fa-chevron-right');
            icon.classList.add('fa-bars');
        }
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    };

    window.toggleTheme = function() {
        const html = document.documentElement;
        const currentTheme = html.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        const icon = document.querySelector('.theme-toggle i');
        if (newTheme === 'dark') {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        } else {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        }
        if (typeof updateGroupLabelColor === 'function') {
            updateGroupLabelColor();
        }
    };

    window.toggleMobileSidebar = function() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.classList.toggle('show');
        }
    };

    window.loadSidebarMaps = function() {
        fetch('/api/sidebar-maps', { cache: 'no-store' })
            .then(res => res.ok ? res.json() : [])
            .then(maps => {
                const list = document.getElementById('sidebarMapList');
                if (!list) return;
                const currentUserId = window.currentUserId || 0;
                const isAdmin = window.isAdmin || false;
                list.innerHTML = '';
                maps.forEach(map => {
                    const isActive = window.currentMapId && window.currentMapId == map.id;
                    let actionsHtml = '';
                    if (map.owner_id == currentUserId || isAdmin) {
                        actionsHtml = `
                            <button class="btn-map-action" onclick="editMap(event, ${map.id}, '${map.name.replace(/'/g, "\\'")}')">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-map-action" onclick="deleteMap(event, ${map.id})">
                                <i class="fas fa-trash"></i>
                            </button>
                        `;
                    }
                    const badgeHtml = map.down_count > 0 ? `<span class="badge bg-danger">${map.down_count}</span>` : '';
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <a href="/map/${map.id}" class="map-item ${isActive ? 'active' : ''}">
                            <span class="map-item-icon"><i class="fas fa-map-marked-alt"></i></span>
                            <span class="map-item-name">${map.name}</span>
                            <div class="map-item-right">
                                <div class="map-item-actions">${actionsHtml}</div>
                                ${badgeHtml}
                            </div>
                        </a>
                    `;
                    list.appendChild(li);
                });
            })
            .catch(err => Logger.error('Error loading maps:', err));
    };

    window.deleteMap = function(event, mapId) {
        event.preventDefault();
        event.stopPropagation();
        confirmAction('Удаление карты', 'Удалить эту карту?', () => {
            fetch(`/api/map/${mapId}`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': getCsrfToken() }
            })
            .then(async res => {
                if (res.ok) {
                    if (window.currentMapId == mapId) {
                        window.location.href = '/';
                        return;
                    }
                    const mapItemElement = document.querySelector(`.map-item[href="/map/${mapId}"]`);
                    if (mapItemElement) {
                        const li = mapItemElement.closest('li');
                        if (li) li.remove();
                    }
                    showToast('Успешно', 'Карта удалена', 'success');
                } else {
                    const errorMsg = await getErrorMessage(res);
                    showToast('Ошибка', errorMsg, 'error');
                }
            })
            .catch(err => {
                Logger.error('Error deleting map:', err);
                showToast('Ошибка', 'Не удалось удалить карту', 'error');
            });
        });
    };

    window.editMap = function(event, mapId, mapName) {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('edit_map_id').value = mapId;
        document.getElementById('edit_map_name').value = mapName;
        document.getElementById('edit_map_background').value = '';
        document.getElementById('edit_map_remove_bg').checked = false;
        const modal = new bootstrap.Modal(document.getElementById('editMapModal'));
        modal.show();
    };

    window.importMapNew = function() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(ev) {
                try {
                    const data = JSON.parse(ev.target.result);
                    data.id = null;
                    fetch('/api/map/import', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCsrfToken()
                        },
                        body: JSON.stringify(data)
                    })
                    .then(async res => {
                        if (!res.ok) {
                            const errorMsg = await getErrorMessage(res);
                            throw new Error(errorMsg);
                        }
                        return res.json();
                    })
                    .then(result => {
                        alert('Импорт выполнен');
                        if (result.id) {
                            window.location.href = `/map/${result.id}`;
                        } else {
                            location.reload();
                        }
                    })
                    .catch(err => {
                        Logger.error(err);
                        alert(err.message || 'Ошибка при импорте');
                    });
                } catch (ex) {
                    alert('Некорректный JSON-файл');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    // Инициализация при загрузке DOM
    document.addEventListener('DOMContentLoaded', function() {
        const savedSidebar = localStorage.getItem('sidebarCollapsed');
        if (savedSidebar === 'true') {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.add('collapsed');
                const icon = document.querySelector('#sidebarToggle i');
                if (icon) {
                    icon.classList.remove('fa-bars');
                    icon.classList.add('fa-chevron-right');
                }
            }
        }
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        if (savedTheme === 'dark') {
            const icon = document.querySelector('.theme-toggle i');
            if (icon) {
                icon.classList.remove('fa-moon');
                icon.classList.add('fa-sun');
            }
        }
        if (document.getElementById('sidebar') && typeof loadSidebarMaps === 'function') {
            loadSidebarMaps();
        }
        const sidebar = document.getElementById('sidebar');
        const toggleIcon = document.querySelector('.sidebar-toggle i');
        if (sidebar && toggleIcon) {
            if (sidebar.classList.contains('collapsed')) {
                toggleIcon.classList.remove('fa-bars');
                toggleIcon.classList.add('fa-chevron-right');
            } else {
                toggleIcon.classList.remove('fa-chevron-right');
                toggleIcon.classList.add('fa-bars');
            }
        }
        setInterval(() => {
        fetch('/api/maps', {
                method: 'GET',
                headers: { 'X-CSRFToken': getCsrfToken() }
            }).catch(() => {});
        }, 5 * 60 * 1000);
    });

    // Инициализация сокета (только для авторизованных)
    if (window.currentUserId !== undefined && window.currentUserId !== null) {
        (function initGlobalSocket() {
            if (window.socket) return;
            window.socket = io({
                reconnection: true,
                reconnectionDelay: 5000,
                reconnectionDelayMax: 10000,
                reconnectionAttempts: 5
            });
            window.socket.on('connect', () => {
                Logger.info('Socket connected (global)');
                if (window.currentMapId) {
                    window.socket.emit('join_room', `map_${window.currentMapId}`);
                }
                updateBackendStatus(true);
            });
            window.socket.on('disconnect', (reason) => {
                Logger.debug('Socket disconnected (global):', reason);
                updateBackendStatus(false);
            });
            window.socket.on('reconnect', (attemptNumber) => {
                Logger.info('Socket reconnected after', attemptNumber, 'attempts');
                if (window.currentMapId) {
                    window.socket.emit('join_room', `map_${window.currentMapId}`);
                }
                updateBackendStatus(true);
            });
            window.socket.on('connect_error', (error) => {
                Logger.warn('Socket connection error:', error);
                updateBackendStatus(false);
            });
        })();
    }
})();
    // Обработчик формы редактирования карты
    const editMapForm = document.getElementById('editMapForm');
    if (editMapForm) {
        editMapForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const mapId = document.getElementById('edit_map_id').value;
            const name = document.getElementById('edit_map_name').value;
            const fileInput = document.getElementById('edit_map_background');
            const removeBg = document.getElementById('edit_map_remove_bg').checked;

            const formData = new FormData();
            formData.append('name', name);
            if (fileInput.files[0]) {
                formData.append('background', fileInput.files[0]);
            }
            if (removeBg) {
                formData.append('remove_background', 'true');
            }

            fetch(`/api/map/${mapId}`, {
                method: 'PUT',
                headers: {
                    'X-CSRFToken': getCsrfToken()
                },
                body: formData
            })
            .then(async res => {
                if (!res.ok) {
                    const errorMsg = await getErrorMessage(res);
                    throw new Error(errorMsg);
                }
                return res.json();
            })
            .then(data => {
                const mapItem = document.querySelector(`.map-item[href="/map/${mapId}"] .map-item-name`);
                if (mapItem) mapItem.textContent = data.name;
                if (window.currentMapId == mapId) {
                    if (typeof updateMapBackground === 'function') updateMapBackground(data.background);
                }
                bootstrap.Modal.getInstance(document.getElementById('editMapModal')).hide();
                showToast('Успешно', 'Карта обновлена', 'success');
            })
            .catch(err => {
                Logger.error(err);
                showToast('Ошибка', err.message || 'Ошибка при сохранении', 'error');
            });
        });
    }