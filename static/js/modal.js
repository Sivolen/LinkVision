// modal.js - функции для модальных окон (устройства, история, связи)

// ==================== Глобальные переменные ====================
let deviceModal = null;          // экземпляр модального окна устройства

// Текущие данные для пагинации истории
let currentHistoryPage = 1;
let totalHistoryPages = 1;
let currentDeviceId = null;
let historyPerPage = 10;

// ==================== Устройство: открытие / сохранение / удаление ====================

/**
 * Открыть модальное окно устройства
 * @param {Object} node - cytoscape-узел (если редактирование) или null (создание)
 */
window.openDeviceModal = function(node) {
    if (!deviceModal) {
        const el = document.getElementById('deviceModal');
        if (el) deviceModal = new bootstrap.Modal(el);
        else return;
    }

    const devId = document.getElementById('dev_id');
    const devName = document.getElementById('dev_name');
    const devIp = document.getElementById('dev_ip');
    const devType = document.getElementById('dev_type');
    const deleteBtn = document.getElementById('deleteDeviceBtn');
    const neighborsBody = document.getElementById('device-neighbors-body');
    const devGroup = document.getElementById('dev_group');
    const monitoringCheck = document.getElementById('dev_monitoring');

    // Находим пункты вкладок
    const historyTabItem = document.querySelector('a[href="#device-history"]')?.closest('.nav-item');
    const neighborsTabItem = document.querySelector('a[href="#device-neighbors"]')?.closest('.nav-item');
    const infoTabLink = document.querySelector('a[href="#device-info"]');

    // Сбрасываем таблицу истории (будет загружена при переходе на вкладку)
    const historyBody = document.getElementById('device-history-body');
    if (historyBody) {
        historyBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Переключитесь на вкладку "История"</td></tr>';
    }
    const paginationDiv = document.getElementById('history-pagination');
    if (paginationDiv) paginationDiv.style.display = 'none';

    if (node) {
        // Режим редактирования
        devId.value = node.id();
        devName.value = node.data('name') || '';
        devIp.value = node.data('ip') || '';
        deleteBtn.style.display = 'inline-block';
        deleteBtn.onclick = () => window.deleteDevice(node.id());

        // Показываем все вкладки
        if (historyTabItem) historyTabItem.style.display = 'block';
        if (neighborsTabItem) neighborsTabItem.style.display = 'block';

        // Загружаем детали устройства (соседи, группа, мониторинг)
        fetch(`/api/device/${node.id()}/details`)
            .then(res => res.ok ? res.json() : Promise.reject('Ошибка загрузки'))
            .then(data => {
                if (data.type_id && devType) devType.value = data.type_id;

                if (data.neighbors && data.neighbors.length > 0) {
                    neighborsBody.innerHTML = '';
                    data.neighbors.forEach(n => {
                        const row = neighborsBody.insertRow();
                        row.insertCell().innerHTML = `<a href="#" onclick="goToDevice(${n.device_id})">${n.device_name}</a>`;
                        row.insertCell().textContent = n.interface;
                        row.insertCell().textContent = '↔';
                        row.insertCell().textContent = n.neighbor_interface;
                        row.insertCell().textContent = n.link_type ? n.link_type : '—';  // важно!
                    });
                } else {
                    neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Нет связей</td></tr>';
                }

                if (monitoringCheck) monitoringCheck.checked = data.monitoring_enabled;
                loadGroups(devGroup, data.group_id);
            })
            .catch(err => {
                console.error('Ошибка загрузки деталей:', err);
                neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Ошибка загрузки</td></tr>';
            });
    } else {
        // Режим создания
        devId.value = '';
        devName.value = '';
        devIp.value = '';
        if (devType) devType.value = '';
        deleteBtn.style.display = 'none';
        neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Нет данных</td></tr>';
        loadGroups(devGroup);

        // Скрываем вкладки истории и соседей
        if (historyTabItem) historyTabItem.style.display = 'none';
        if (neighborsTabItem) neighborsTabItem.style.display = 'none';
    }

    // Загружаем типы устройств
    loadDeviceTypes(devType);

    // В режиме создания принудительно активируем вкладку "Информация"
    if (infoTabLink) {
        const infoTab = new bootstrap.Tab(infoTabLink);
        infoTab.show();
    }

    // Блокировка для оператора
    if (window.isOperator) {
        devName.disabled = true;
        devIp.disabled = true;
        devType.disabled = true;
        devGroup.disabled = true;
        if (monitoringCheck) monitoringCheck.disabled = true;
        const saveBtn = document.querySelector('#deviceModal .btn-primary');
        if (saveBtn) saveBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
    } else {
        devName.disabled = false;
        devIp.disabled = false;
        devType.disabled = false;
        devGroup.disabled = false;
        if (monitoringCheck) monitoringCheck.disabled = false;
    }

    deviceModal.show();
};

document.getElementById('deviceModal').addEventListener('hidden.bs.modal', function() {
    // Сброс содержимого таблиц
    const historyBody = document.getElementById('device-history-body');
    if (historyBody) {
        historyBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Переключитесь на вкладку "История"</td></tr>';
    }
    const neighborsBody = document.getElementById('device-neighbors-body');
    if (neighborsBody) {
        neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Загрузка...</td></tr>';
    }
    // Скрыть пагинацию
    const paginationDiv = document.getElementById('history-pagination');
    if (paginationDiv) paginationDiv.style.display = 'none';
});

/**
 * Сохранить устройство (создать или обновить)
 */
window.saveDevice = function() {
    const devId = document.getElementById('dev_id').value;
    const name = document.getElementById('dev_name').value.trim();
    const ip = document.getElementById('dev_ip').value.trim();
    const typeId = document.getElementById('dev_type').value;
    const groupId = document.getElementById('dev_group').value;
    const monitoring = document.getElementById('dev_monitoring').checked;

    if (!name || !typeId) {
        alert('Имя и тип устройства обязательны');
        return;
    }

    const data = {
        name: name,
        ip: ip || null,
        type_id: parseInt(typeId),
        group_id: groupId ? parseInt(groupId) : null,
        monitoring_enabled: monitoring
    };

    const url = devId ? `/api/device/${devId}` : '/api/device';
    const method = devId ? 'PUT' : 'POST';

    if (devId) data.id = parseInt(devId); // для PUT может потребоваться

    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(res => {
        if (!res.ok) throw new Error('Ошибка сохранения');
        return res.json();
    })
    .then(device => {
        if (typeof window.updateDevice === 'function') {
            window.updateDevice(device);
        }
        deviceModal.hide();
    })
    .catch(err => {
        console.error(err);
        alert('Ошибка при сохранении устройства');
    });
};

/**
 * Удалить устройство
 * @param {number} deviceId
 */
window.deleteDevice = function(deviceId) {
    if (!confirm('Удалить устройство?')) return;

    fetch(`/api/device/${deviceId}`, { method: 'DELETE' })
        .then(res => {
            if (!res.ok) throw new Error('Ошибка удаления');
            if (typeof window.removeDeviceFromGraph === 'function') {
                window.removeDeviceFromGraph(deviceId);
            }
            deviceModal.hide();
        })
        .catch(err => {
            console.error(err);
            alert('Ошибка при удалении');
        });
};

/**
 * Загрузить типы устройств в select
 * @param {HTMLSelectElement} selectEl
 */
function loadDeviceTypes(selectEl) {
    if (!selectEl) return;
    fetch('/api/types')
        .then(res => res.ok ? res.json() : [])
        .then(types => {
            selectEl.innerHTML = '<option value="">-- Выберите тип --</option>';
            types.forEach(t => {
                const option = document.createElement('option');
                option.value = t.id;
                option.textContent = t.name;
                selectEl.appendChild(option);
            });
        })
        .catch(err => console.error('Ошибка загрузки типов:', err));
}

/**
 * Загрузить группы карты в select
 * @param {HTMLSelectElement} selectEl
 * @param {number|null} selectedGroupId - ID выбранной группы (если есть)
 */
function loadGroups(selectEl, selectedGroupId) {
    if (!selectEl) return;
    const mapId = window.currentMapId;
    if (!mapId) return;

    fetch(`/api/map/${mapId}/groups`)
        .then(res => res.ok ? res.json() : [])
        .then(groups => {
            selectEl.innerHTML = '<option value="">-- Без группы --</option>';
            groups.forEach(g => {
                const option = document.createElement('option');
                option.value = g.id;
                option.textContent = g.name;
                option.style.backgroundColor = g.color;
                selectEl.appendChild(option);
            });
            if (selectedGroupId) selectEl.value = selectedGroupId;
        })
        .catch(err => console.error('Ошибка загрузки групп:', err));
}

// ==================== История (пагинация) ====================

/**
 * Загрузка истории изменений устройства
 * @param {number} deviceId - ID устройства
 * @param {number} page - номер страницы
 */
function loadHistory(deviceId, page = 1) {
    if (!deviceId) return;

    currentDeviceId = deviceId;
    currentHistoryPage = page;

    const tbody = document.getElementById('device-history-body');
    const paginationDiv = document.getElementById('history-pagination');
    const prevBtn = document.getElementById('history-prev');
    const nextBtn = document.getElementById('history-next');
    const pageInfo = document.getElementById('history-page-info');

    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Загрузка...</td></tr>';
    if (paginationDiv) paginationDiv.style.display = 'none';

    fetch(`/api/device/${deviceId}/history?page=${page}&per_page=${historyPerPage}`)
        .then(response => {
            if (!response.ok) throw new Error('Ошибка загрузки истории');
            return response.json();
        })
        .then(data => {
            let items = [];
            let currentPage = 1;
            let totalPages = 1;

            if (Array.isArray(data)) {
                // Клиентская пагинация (если сервер вернул массив)
                console.warn('Сервер вернул массив (пагинация не работает на сервере). Используем клиентскую пагинацию.');
                const allItems = data;
                totalPages = Math.ceil(allItems.length / historyPerPage);
                currentPage = page;
                const start = (currentPage - 1) * historyPerPage;
                const end = start + historyPerPage;
                items = allItems.slice(start, end);
            } else if (data && Array.isArray(data.items)) {
                items = data.items;
                currentPage = data.page || 1;
                totalPages = data.pages || 1;
            } else {
                console.error('Неожиданный формат данных:', data);
                items = [];
            }

            renderHistoryTable(items, tbody);

            if (paginationDiv) {
                if (totalPages > 1) {
                    paginationDiv.style.display = 'flex';
                    pageInfo.textContent = `Страница ${currentPage} из ${totalPages}`;
                    prevBtn.disabled = currentPage <= 1;
                    nextBtn.disabled = currentPage >= totalPages;
                } else {
                    paginationDiv.style.display = 'none';
                }
            }

            currentHistoryPage = currentPage;
            totalHistoryPages = totalPages;
        })
        .catch(error => {
            console.error('Ошибка загрузки истории:', error);
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger">Ошибка загрузки</td></tr>';
            if (paginationDiv) paginationDiv.style.display = 'none';
        });
}

/**
 * Отрисовка таблицы истории
 */
function renderHistoryTable(items, tbody) {
    if (!tbody) return;
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Нет записей истории</td></tr>';
        return;
    }

    let html = '';
    items.forEach(item => {
        const oldStatus = item.old_status === 'true' ? 'up' : (item.old_status === 'false' ? 'down' : item.old_status);
        const newStatus = item.new_status === 'true' ? 'up' : (item.new_status === 'false' ? 'down' : item.new_status);
        const oldBadge = getStatusBadgeClass(oldStatus);
        const newBadge = getStatusBadgeClass(newStatus);
        html += `
            <tr>
                <td>${formatDateTime(item.timestamp)}</td>
                <td><span class="badge ${oldBadge}">${oldStatus || '—'}</span></td>
                <td><span class="badge ${newBadge}">${newStatus || '—'}</span></td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

/**
 * Переключение страницы истории
 * @param {number} newPage
 */
function loadHistoryPage(newPage) {
    if (newPage < 1 || newPage > totalHistoryPages) return;
    loadHistory(currentDeviceId, newPage);
}

/**
 * Форматирование даты
 */
function formatDateTime(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

/**
 * Класс бейджа по статусу
 */
function getStatusBadgeClass(status) {
    const s = String(status).toLowerCase();
    if (s === 'up' || s === 'true' || s === 'online') return 'bg-success';
    if (s === 'down' || s === 'false' || s === 'offline') return 'bg-danger';
    if (s === 'warning') return 'bg-warning';
    return 'bg-secondary';
}

// ==================== Инициализация ====================
document.addEventListener('DOMContentLoaded', function() {

console.log('modal.js loaded');
    // ========== Обработчик переключения на вкладку истории ==========
    const historyTab = document.querySelector('a[href="#device-history"]');
    if (historyTab) {
        historyTab.addEventListener('shown.bs.tab', function() {
            const deviceId = document.getElementById('dev_id').value;
            if (deviceId) loadHistory(deviceId, 1);
        });
    }

    // ========== Обработчики кнопок пагинации (без onclick в HTML) ==========
    const prevBtn = document.getElementById('history-prev');
    const nextBtn = document.getElementById('history-next');
    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.preventDefault();
            loadHistoryPage(currentHistoryPage - 1);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.preventDefault();
            loadHistoryPage(currentHistoryPage + 1);
        });
    }

// Обработчик формы группы (с защитой от дублирования и блокировкой кнопки)
const groupForm = document.getElementById('groupForm');
if (groupForm) {
    // Удаляем предыдущий обработчик, если он был (по имени функции)
    groupForm.removeEventListener('submit', window._groupSubmitHandler);

    // Определяем функцию обработчика
    window._groupSubmitHandler = function(e) {
        e.preventDefault();
        const submitBtn = groupForm.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true; // блокируем кнопку

        const id = document.getElementById('group_id').value;
        const name = document.getElementById('group_name').value.trim();
        const color = document.getElementById('group_color').value;

        if (!name) {
            alert('Введите название группы');
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        const url = id ? `/api/group/${id}` : '/api/group';
        const method = id ? 'PUT' : 'POST';
        const body = id ? { name, color } : { map_id: window.currentMapId, name, color };

        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(res => {
            if (!res.ok) throw new Error('Ошибка сохранения');
            return res.json();
        })
        .then(() => {
            document.getElementById('group_id').value = '';
            document.getElementById('group_name').value = '';
            document.getElementById('group_color').value = '#3498db';
            loadGroupsList(); // обновляем список
        })
        .catch(err => {
            console.error(err);
            alert('Ошибка при сохранении группы');
        })
        .finally(() => {
            if (submitBtn) submitBtn.disabled = false; // разблокируем
        });
    };

    // Навешиваем обработчик
    groupForm.addEventListener('submit', window._groupSubmitHandler);
}

    // ========== При открытии модального окна групп обновляем список ==========
    const groupModalEl = document.getElementById('groupModal');
    if (groupModalEl) {
        groupModalEl.addEventListener('shown.bs.modal', function () {
            loadGroupsList();
        });
    }
});
// ==================== Группы (новая версия) ====================
// ==================== Группы (чистая версия) ====================
let groupModal = null;
let currentGroupId = null;

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', function() {
    initColorPicker();
    const groupForm = document.getElementById('groupForm');
    if (groupForm) {
        // Удаляем все предыдущие обработчики, чтобы не было дублей
        groupForm.replaceWith(groupForm.cloneNode(true));
        const newGroupForm = document.getElementById('groupForm');
        newGroupForm.addEventListener('submit', handleGroupSubmit);
    }
});

// Обработчик отправки формы
function handleGroupSubmit(e) {
    e.preventDefault();

    const idInput = document.getElementById('group_id');
    const nameInput = document.getElementById('group_name');
    const colorInput = document.getElementById('group_color_input');

    // Проверка на случай, если элементы не найдены
    if (!idInput || !nameInput || !colorInput) {
        console.error('Ошибка: не найдены поля формы', { idInput, nameInput, colorInput });
        alert('Техническая ошибка: перезагрузите страницу');
        return;
    }

    const id = idInput.value;
    const name = nameInput.value.trim();
    const color = colorInput.value;

    if (!name) {
        alert('Введите название группы');
        return;
    }

    const url = id ? `/api/group/${id}` : '/api/group';
    const method = id ? 'PUT' : 'POST';
    const body = id ? { name, color } : { map_id: window.currentMapId, name, color };

    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(res => {
        if (!res.ok) throw new Error('Ошибка сохранения');
        return res.json();
    })
    .then(() => {
        resetGroupForm();
        loadGroupsList();
        if (typeof reloadMapElements === 'function') reloadMapElements();
    })
    .catch(err => {
        console.error(err);
        alert('Ошибка при сохранении группы');
    });
}

// Открыть модальное окно групп
window.openGroupManager = function() {
    if (window.isOperator) {
        alert('Оператор не может управлять группами');
        return;
    }
    if (!groupModal) {
        const el = document.getElementById('groupModal');
        if (el) groupModal = new bootstrap.Modal(el);
        else return;
    }
    resetGroupForm();
    loadGroupsList();
    groupModal.show();
};

// Сброс формы в режим добавления
function resetGroupForm() {
    const idInput = document.getElementById('group_id');
    const nameInput = document.getElementById('group_name');
    const colorInput = document.getElementById('group_color_input');
    const colorPreview = document.getElementById('color_preview');
    const colorValue = document.getElementById('color_value');
    const submitBtn = document.getElementById('groupSubmitBtn');

    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    const defaultColor = '#3498db';
    if (colorInput) colorInput.value = defaultColor;
    if (colorPreview) colorPreview.style.backgroundColor = defaultColor;
    if (colorValue) colorValue.textContent = defaultColor;
    if (submitBtn) submitBtn.textContent = 'Добавить группу';
    currentGroupId = null;
}

// Загрузка списка групп
function loadGroupsList() {
    const tbody = document.getElementById('group-list-body');
    if (!tbody) return;

    fetch(`/api/map/${window.currentMapId}/groups`)
        .then(res => {
            if (!res.ok) throw new Error('Ошибка загрузки групп');
            return res.json();
        })
        .then(groups => {
            tbody.innerHTML = '';
            groups.forEach(group => {
                const row = tbody.insertRow();
                row.innerHTML = `
                    <td>${group.name}</td>
                    <td><span class="color-preview" style="background-color: ${group.color};"></span></td>
                    <td>${group.device_count || 0}</td>
                    <td>
                        <div class="table-actions">
                            <button class="btn-action" onclick="editGroup(${group.id}, '${group.name}', '${group.color}')">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-action" onclick="deleteGroup(${group.id})">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                `;
            });
        })
        .catch(err => {
            console.error('Ошибка загрузки групп:', err);
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Ошибка загрузки</td></tr>';
        });
}

// Редактирование группы
window.editGroup = function(id, name, color) {
    currentGroupId = id;
    const idInput = document.getElementById('group_id');
    const nameInput = document.getElementById('group_name');
    const colorInput = document.getElementById('group_color_input');
    const colorPreview = document.getElementById('color_preview');
    const colorValue = document.getElementById('color_value');
    const submitBtn = document.getElementById('groupSubmitBtn');

    if (idInput) idInput.value = id;
    if (nameInput) nameInput.value = name;
    if (colorInput) colorInput.value = color;
    if (colorPreview) colorPreview.style.backgroundColor = color;
    if (colorValue) colorValue.textContent = color;
    if (submitBtn) submitBtn.textContent = 'Сохранить изменения';
};

// Удаление группы
window.deleteGroup = function(id) {
    if (!confirm('Удалить группу? Устройства группы останутся без группы.')) return;
    fetch(`/api/group/${id}`, { method: 'DELETE' })
        .then(res => {
            if (!res.ok) throw new Error('Ошибка удаления');
            loadGroupsList();
            if (currentGroupId === id) resetGroupForm();
        })
        .catch(err => {
            console.error(err);
            alert('Ошибка при удалении группы');
        });
};

// Инициализация кастомного выбора цвета
function initColorPicker() {
    const colorBtn = document.getElementById('group_color_btn');
    const colorInput = document.getElementById('group_color_input');
    const colorPreview = document.getElementById('color_preview');
    const colorValue = document.getElementById('color_value');

    if (!colorBtn || !colorInput) {
        console.warn('Элементы color picker не найдены');
        return;
    }

    colorBtn.addEventListener('click', () => {
        colorInput.click();
    });

    colorInput.addEventListener('input', (e) => {
        const newColor = e.target.value;
        if (colorPreview) colorPreview.style.backgroundColor = newColor;
        if (colorValue) colorValue.textContent = newColor;
    });
}