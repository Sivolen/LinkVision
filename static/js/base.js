// base.js - глобальные функции для всех страниц
let connectionToast = null;
let wasDisconnected = false;

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
    // УТИЛИТА: Модальное окно подтверждения действия (Promise-based)
    // ============================================================================
    window.confirmAction = function({
        title = 'Подтверждение',
        message = 'Вы уверены?',
        confirmText = 'Удалить',
        variant = 'danger'
    } = {}, onConfirm = null, onCancel = null) {
        // Поддержка старого синтаксиса: confirmAction(title, message, onConfirm, onCancel)
        let opts = typeof title === 'object' ? title : { title, message };
        if (typeof onConfirm === 'function') opts.onConfirm = onConfirm;
        if (typeof onCancel === 'function') opts.onCancel = onCancel;

        return new Promise((resolve) => {
            const modalEl = document.getElementById('confirmModal');
            if (!modalEl) {
                // Fallback: нативный confirm(), если модалки нет
                const confirmed = confirm(`${opts.title}\n\n${opts.message}`);
                if (confirmed && opts.onConfirm) opts.onConfirm();
                else if (!confirmed && opts.onCancel) opts.onCancel();
                resolve(confirmed);
                return;
            }

            const modalTitle = modalEl.querySelector('.modal-title');
            const modalMessage = modalEl.querySelector('.modal-body');
            const confirmBtn = modalEl.querySelector('.btn-danger');
            const cancelBtn = modalEl.querySelector('.btn-secondary');

            modalTitle.textContent = opts.title;
            modalMessage.textContent = opts.message;
            confirmBtn.textContent = opts.confirmText || 'Удалить';
            confirmBtn.className = `btn btn-${opts.variant || 'danger'}`;

            // Блокируем кнопку на время выполнения
            const originalText = confirmBtn.textContent;
            confirmBtn.disabled = true;

            const cleanup = () => {
                confirmBtn.removeEventListener('click', onConfirmClick);
                cancelBtn.removeEventListener('click', onCancelClick);
                modalEl.removeEventListener('hidden.bs.modal', onHidden);
                confirmBtn.disabled = false;
            };

            const onConfirmClick = () => {
                confirmBtn.disabled = true;
                confirmBtn.textContent = '⏳ Выполняется...';
                if (opts.onConfirm) {
                    const result = opts.onConfirm();
                    if (result && typeof result.finally === 'function') {
                        // Async: ждём промис
                        result.finally(() => {
                            cleanup();
                            resolve(true);
                            const modal = bootstrap.Modal.getInstance(modalEl);
                            modal?.hide();
                        });
                    } else {
                        cleanup();
                        resolve(true);
                        const modal = bootstrap.Modal.getInstance(modalEl);
                        modal?.hide();
                    }
                } else {
                    cleanup();
                    resolve(true);
                    const modal = bootstrap.Modal.getInstance(modalEl);
                    modal?.hide();
                }
            };

            const onCancelClick = () => {
                cleanup();
                resolve(false);
                const modal = bootstrap.Modal.getInstance(modalEl);
                modal?.hide();
            };

            const onHidden = () => {
                cleanup();
                resolve(false);
            };

            confirmBtn.addEventListener('click', onConfirmClick);
            cancelBtn.addEventListener('click', onCancelClick);
            modalEl.addEventListener('hidden.bs.modal', onHidden);

            const modal = new bootstrap.Modal(modalEl);
            modal.show();
        });
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
            window.setSkipNextMapUpdate();
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
            })
            .finally(() => window.clearSkipNextMapUpdate());
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
                    window.setSkipNextMapUpdate();
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
                    })
                    .finally(() => window.clearSkipNextMapUpdate());
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
        // Глобальный обработчик для data-confirm-delete (замена confirm())
        document.addEventListener('submit', async function(e) {
            const form = e.target;
            const confirmBtn = form.querySelector('[data-confirm-delete]');
            if (!confirmBtn) return;

            e.preventDefault();
            const action = confirmBtn.getAttribute('data-confirm-delete');
            const actionLabels = {
                'map': 'карту и все устройства',
                'user': 'пользователя',
                'type': 'тип устройств',
                'backup': 'текущую базу данных',
                'rate_limit': 'все счётчики rate limit'
            };
            const confirmed = await window.confirmAction({
                title: 'Подтверждение удаления',
                message: `Вы уверены, что хотите удалить ${actionLabels[action] || 'элемент'}?`,
                confirmText: 'Удалить',
                variant: 'danger'
            });
            if (!confirmed) return;

            // Восстанавливаем обработчик и отправляем форму
            form.removeEventListener('submit', arguments.callee);
            form.submit();
        });

        // Ширина сайдбара из localStorage + перетаскиваемый сплиттер
        (function setupSidebarResizer() {
            const MIN = 200, MAX = 480, KEY = 'sidebarWidth';
            const root = document.documentElement;

            const saved = parseInt(localStorage.getItem(KEY), 10);
            if (saved && saved >= MIN && saved <= MAX) {
                root.style.setProperty('--sidebar-width', saved + 'px');
            }

            const sidebar = document.getElementById('sidebar');
            const resizer = document.getElementById('sidebarResizer');
            if (!sidebar || !resizer) return;

            let dragging = false;

            const onMove = (e) => {
                if (!dragging) return;
                const w = Math.max(200, Math.min(800, e.clientX));
                root.style.setProperty('--sidebar-width', w + 'px');
            };
            const onUp = () => {
                if (!dragging) return;
                dragging = false;
                resizer.classList.remove('dragging');
                document.body.classList.remove('resizing-sidebar');
                const px = parseInt(getComputedStyle(root).getPropertyValue('--sidebar-width'), 10);
                if (px) localStorage.setItem(KEY, px);
            };

            resizer.addEventListener('pointerdown', (e) => {
                if (sidebar.classList.contains('collapsed')) return; // свёрнутый не тянем
                dragging = true;
                resizer.setPointerCapture(e.pointerId);
                resizer.classList.add('dragging');
                document.body.classList.add('resizing-sidebar');
                e.preventDefault();
            });
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);

            // Двойной клик по ручке — сброс к ширине по умолчанию
            resizer.addEventListener('dblclick', () => {
                root.style.removeProperty('--sidebar-width');
                localStorage.removeItem(KEY);
            });
        })();

        // Кастомный тултип с названием карты, когда сайдбар свёрнут
        // (названия скрыты, показываем их по наведению рядом с пунктом).
        (function setupCollapsedMapTooltip() {
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            let tip = null;

            const hide = () => { if (tip) tip.classList.remove('visible'); };

            sidebar.addEventListener('mouseover', (e) => {
                if (!sidebar.classList.contains('collapsed')) return;
                const item = e.target.closest('.map-item');
                if (!item) return;
                const nameEl = item.querySelector('.map-item-name');
                const name = (nameEl ? nameEl.textContent : item.textContent).trim();
                if (!name) return;
                if (!tip) {
                    tip = document.createElement('div');
                    tip.className = 'sidebar-tooltip';
                    document.body.appendChild(tip);
                }
                tip.textContent = name;
                const r = item.getBoundingClientRect();
                tip.style.top = (r.top + r.height / 2) + 'px';
                tip.style.left = (r.right + 12) + 'px';
                tip.classList.add('visible');
            });
            sidebar.addEventListener('mouseout', (e) => {
                const item = e.target.closest('.map-item');
                if (!item) return;
                // Не прячем, пока курсор переходит между внутренними элементами
                // того же пункта (иначе тултип мигает при движении по иконке/тексту).
                if (e.relatedTarget && item.contains(e.relatedTarget)) return;
                hide();
            });
            // Прячем при уходе курсора из сайдбара. (Раньше был transitionend на
            // сайдбаре — он ловил анимацию :hover самого пункта и прятал тултип
            // сразу после показа.)
            sidebar.addEventListener('mouseleave', hide);
        })();

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
                if (window.debugMode) Logger.info('Socket connected (global)');
                if (window.currentMapId) {
                    window.socket.emit('join_room', `map_${window.currentMapId}`);
                }
                updateBackendStatus(true);
                if (wasDisconnected) {
                    if (connectionToast) connectionToast.hide();
                    connectionToast = showToast('Связь восстановлена', 'Соединение с сервером восстановлено', 'success', { autoHide: 3000 });
                    wasDisconnected = false;
                }
            });
            window.socket.on('disconnect', (reason) => {
                Logger.debug('Socket disconnected (global):', reason);
                updateBackendStatus(false);
                if (!connectionToast) {
                    connectionToast = showToast('Потеря связи', 'Соединение с сервером потеряно, попытка восстановления...', 'error', { autoHide: false });
                    wasDisconnected = true;
                }
            });
            window.socket.on('reconnect', (attemptNumber) => {
                if (window.debugMode) Logger.info('Socket reconnected after', attemptNumber, 'attempts');
                if (window.currentMapId) {
                    window.socket.emit('join_room', `map_${window.currentMapId}`);
                    window.socket.emit('request_status', { map_id: window.currentMapId });
                }
                updateBackendStatus(true);
                if (wasDisconnected) {
                    if (connectionToast) connectionToast.hide();
                    connectionToast = showToast('Связь восстановлена', 'Соединение с сервером восстановлено', 'success', { autoHide: 3000 });
                    wasDisconnected = false;
                }
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
        window.setSkipNextMapUpdate();
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
                // Обновляем фон (если он изменился)
                if (typeof window.updateMapBackground === 'function') {
                    window.updateMapBackground(data.background);
                }
                // Перезагружаем все элементы карты (устройства, связи)
                if (typeof window.reloadMapElements === 'function') {
                    window.reloadMapElements();
                }
            }
            bootstrap.Modal.getInstance(document.getElementById('editMapModal')).hide();
            showToast('Успешно', 'Карта обновлена', 'success');
        })
        .catch(err => {
            Logger.error(err);
            showToast('Ошибка', err.message || 'Ошибка при сохранении', 'error');
        })
        .finally(() => window.clearSkipNextMapUpdate());
    });
}