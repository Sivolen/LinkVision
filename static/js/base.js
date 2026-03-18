        // ====================================================================
        // Глобальный логер для клиентской части
        // ====================================================================
        window.Logger = {
            enabledDebug: {{ 'true' if debug_mode else 'false' }},
            info: function(...args) {
                console.log('[INFO]', ...args);
            },
            warn: function(...args) {
                console.warn('[WARN]', ...args);
            },
            error: function(...args) {
                console.error('[ERROR]', ...args);
            },
            debug: function(...args) {
                if (this.enabledDebug) {
                    console.debug('[DEBUG]', ...args);
                }
            }
        };

        // ====================================================================
        // ПЕРЕКЛЮЧЕНИЕ САЙДБАРА (сворачивание/разворачивание)
        // ====================================================================
        function toggleSidebar() {
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
        }

        // ====================================================================
        // ПЕРЕКЛЮЧЕНИЕ ТЕМЫ
        // ====================================================================
        function toggleTheme() {
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
        }

        // ====================================================================
        // ПЕРЕКЛЮЧЕНИЕ МОБИЛЬНОГО МЕНЮ (показ/скрытие сайдбара)
        // ====================================================================
        function toggleMobileSidebar() {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.toggle('show');
            }
        }

        // ====================================================================
        // ЗАГРУЗКА СОХРАНЁННЫХ НАСТРОЕК
        // ====================================================================
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

            // Загружаем карты в сайдбар только если сайдбар существует
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
        });
        // ====================================================================
        // ЗАГРУЗКА КАРТ В САЙДБАР
        // ====================================================================
        function loadSidebarMaps() {
            fetch('/api/sidebar-maps')
                .then(res => res.ok ? res.json() : [])
                .then(maps => {
                    const list = document.getElementById('sidebarMapList');
                    if (!list) return;
                    const currentUserId = {{ current_user.id if current_user.is_authenticated else 0 }};
                    const isAdmin = {{ 'true' if current_user.is_admin else 'false' }};
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
        }

        // ====================================================================
        // УДАЛЕНИЕ И РЕДАКТИРОВАНИЕ КАРТЫ
        // ====================================================================
        function deleteMap(event, mapId) {
            event.preventDefault();
            event.stopPropagation();
            if (confirm('Удалить эту карту?')) {
                fetch(`/api/map/${mapId}`, { method: 'DELETE' })
                    .then(res => {
                        if (res.ok) {
                            loadSidebarMaps();
                            if (window.currentMapId == mapId) {
                                window.location.href = '/';
                            }
                        } else {
                            alert('Ошибка удаления');
                        }
                    })
                    .catch(err => Logger.error('Error deleting map:', err));
            }
        }
        function editMap(event, mapId, mapName) {
            event.preventDefault();
            event.stopPropagation();
            document.getElementById('edit_map_id').value = mapId;
            document.getElementById('edit_map_name').value = mapName;
            document.getElementById('edit_map_background').value = '';
            document.getElementById('edit_map_remove_bg').checked = false;
            const modal = new bootstrap.Modal(document.getElementById('editMapModal'));
            modal.show();
        }
        document.getElementById('editMapForm').addEventListener('submit', function(e) {
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
                body: formData
            })
            .then(res => {
                if (!res.ok) throw new Error('Ошибка сохранения');
                return res.json();
            })
            .then(data => {
                const mapItem = document.querySelector(`.map-item[href="/map/${mapId}"] .map-item-name`);
                if (mapItem) mapItem.textContent = data.name;
                if (window.currentMapId == mapId) {
                    if (typeof updateMapBackground === 'function') updateMapBackground(data.background);
                }
                bootstrap.Modal.getInstance(document.getElementById('editMapModal')).hide();
            })
            .catch(err => {
                Logger.error(err);
                alert('Ошибка при сохранении');
            });
        });
        // Экспорт карты
        function exportMap() {
            const mapId = document.getElementById('edit_map_id').value;
            if (!mapId) {
                alert('Сначала выберите карту');
                return;
            }
            fetch(`/api/map/${mapId}/export`)
                .then(res => {
                    if (!res.ok) throw new Error('Ошибка экспорта');
                    return res.json();
                })
                .then(data => {
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `map_${mapId}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                })
                .catch(err => {
                    Logger.error(err);
                    alert('Не удалось экспортировать карту');
                });
        }
        // Импорт карты (всегда создаёт новую)
        function importMapNew() {
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
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(data)
                        })
                        .then(res => {
                            if (!res.ok) throw new Error('Ошибка импорта');
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
                            alert('Ошибка при импорте');
                        });
                    } catch (ex) {
                        alert('Некорректный JSON-файл');
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        }
        // ====================================================================
        // Функция обновления индикатора состояния (вызывается из map.js)
        // ====================================================================
        function updateBackendStatus(isConnected) {
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
        }
        // Начальное состояние – офлайн
        updateBackendStatus(false);
        // ====================================================================
        // Глобальная инициализация сокета (для всех страниц с сайдбаром)
        // ====================================================================
        {% if current_user.is_authenticated %}
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
        {% endif %}
        // Автоматическое скрытие flash-сообщений через 5 секунд
        setTimeout(function() {
            document.querySelectorAll('.alert.alert-dismissible').forEach(function(alert) {
                var bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
                bsAlert.close();
            });
        }, 5000);