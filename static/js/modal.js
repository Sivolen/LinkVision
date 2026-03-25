// modal.js - функции для модальных окон (устройства, история, связи, группы)
// ==================== Глобальные переменные ====================
let deviceModal = null;
let currentHistoryPage = 1;
let totalHistoryPages = 1;
let currentDeviceId = null;
let historyPerPage = 10;

// Группы
let groupModal = null;
let currentGroupId = null;
let _formHandlerAttached = false;
// Фигуры
let shapeModal = null;
let currentShapeId = null;

// ==================== Устройство ====================
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

    const historyTabItem = document.querySelector('a[href="#device-history"]')?.closest('.nav-item');
    const neighborsTabItem = document.querySelector('a[href="#device-neighbors"]')?.closest('.nav-item');
    const infoTabLink = document.querySelector('a[href="#device-info"]');

    const historyBody = document.getElementById('device-history-body');
    if (historyBody) historyBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Переключитесь на вкладку "История"</td></tr>';

    const paginationDiv = document.getElementById('history-pagination');
    if (paginationDiv) paginationDiv.style.display = 'none';

    if (node) {
        devId.value = node.id();
        devName.value = node.data('name') || '';
        devIp.value = node.data('ip') || '';
        deleteBtn.style.display = 'inline-block';
        deleteBtn.onclick = () => window.deleteDevice(node.id());

        if (historyTabItem) historyTabItem.style.display = 'block';
        if (neighborsTabItem) neighborsTabItem.style.display = 'block';

        fetch(`/api/device/${node.id()}/details`)
            .then(res => res.ok ? res.json() : Promise.reject('Ошибка'))
            .then(data => {
                // Загружаем типы и после загрузки устанавливаем значение
                loadDeviceTypes(devType, () => {
                    if (data.type_id) devType.value = data.type_id;
                });
                if (data.ip_address) devIp.value = data.ip_address;
                if (data.neighbors && data.neighbors.length > 0) {
                    neighborsBody.innerHTML = '';
                    data.neighbors.forEach(n => {
                        const row = neighborsBody.insertRow();
                        row.insertCell().innerHTML = `<a href="#" onclick="goToDevice(${n.device_id})">${n.device_name}</a>`;
                        row.insertCell().textContent = n.interface;
                        row.insertCell().textContent = '↔';
                        row.insertCell().textContent = n.neighbor_interface;
                        row.insertCell().textContent = n.link_type || '—';
                    });
                } else {
                    neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Нет связей</td></tr>';
                }
                if (monitoringCheck) monitoringCheck.checked = data.monitoring_enabled;
                loadGroups(devGroup, data.group_id);
            })
            .catch(err => {
                Logger.error('Ошибка загрузки деталей:', err);
                neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Ошибка загрузки</td></tr>';
                showToast('Ошибка', 'Не удалось загрузить данные устройства', 'error');
            });
    } else {
        devId.value = '';
        devName.value = '';
        devIp.value = '';
        if (devType) devType.value = '';
        deleteBtn.style.display = 'none';
        neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Нет данных</td></tr>';
        loadGroups(devGroup);

        if (historyTabItem) historyTabItem.style.display = 'none';
        if (neighborsTabItem) neighborsTabItem.style.display = 'none';
        loadDeviceTypes(devType); // просто загружаем список
    }

    if (infoTabLink) {
        const infoTab = new bootstrap.Tab(infoTabLink);
        infoTab.show();
    }

    if (window.isOperator) {
        devName.disabled = true;
        devIp.disabled = true;
        devType.disabled = true;
        devGroup.disabled = true;
        if (monitoringCheck) monitoringCheck.disabled = true;
        const saveBtn = document.querySelector('#deviceModal .btn-primary');
        if (saveBtn) saveBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }

    deviceModal.show();
};

document.getElementById('deviceModal')?.addEventListener('hidden.bs.modal', function() {
    const historyBody = document.getElementById('device-history-body');
    if (historyBody) historyBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Переключитесь на вкладку "История"</td></tr>';

    const neighborsBody = document.getElementById('device-neighbors-body');
    if (neighborsBody) neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Загрузка...</td></tr>';

    const paginationDiv = document.getElementById('history-pagination');
    if (paginationDiv) paginationDiv.style.display = 'none';
});

window.saveDevice = function() {
    const devId = document.getElementById('dev_id').value;
    const name = document.getElementById('dev_name').value.trim();
    const ip = document.getElementById('dev_ip').value.trim();
    const typeId = document.getElementById('dev_type').value;
    const groupId = document.getElementById('dev_group').value;
    const monitoring = document.getElementById('dev_monitoring').checked;

    if (!name || !typeId) {
        showToast('Ошибка', 'Имя и тип устройства обязательны', 'error');
        return;
    }

    const data = {
        name: name,
        ip_address: ip || null,
        type_id: parseInt(typeId),
        group_id: groupId ? parseInt(groupId) : null,
        monitoring_enabled: monitoring
    };

    if (!devId) {
        if (!window.currentMapId) {
            showToast('Ошибка', 'Не удалось определить текущую карту', 'error');
            return;
        }
        data.map_id = window.currentMapId;
        if (cy && typeof cy.pan === 'function') {
            const container = document.getElementById('cy');
            const pan = cy.pan();
            const zoom = cy.zoom();
            data.x = Math.round((-pan.x + container.clientWidth / 2) / zoom);
            data.y = Math.round((-pan.y + container.clientHeight / 2) / zoom);
        } else {
            data.x = 100;
            data.y = 100;
        }
    }

    const url = devId ? `/api/device/${devId}` : '/api/device';
    const method = devId ? 'PUT' : 'POST';

    const saveBtn = document.getElementById('saveDeviceBtn');
    const btnText = saveBtn?.querySelector('.btn-text');
    const btnLoader = saveBtn?.querySelector('.btn-loader');

    if (btnText) btnText.classList.add('d-none');
    if (btnLoader) btnLoader.classList.remove('d-none');
    if (saveBtn) saveBtn.disabled = true;

    fetch(url, {
        method: method,
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
        if (!devId) {
            const newDevice = {
                id: result.id,
                name: data.name,
                ip: data.ip_address,
                type_id: data.type_id,
                group_id: data.group_id,
                monitoring_enabled: data.monitoring_enabled,
                x: data.x,
                y: data.y,
                status: 'true'
            };
            if (typeof window.addDeviceToGraph === 'function') {
                window.addDeviceToGraph(newDevice);
            }
            showToast('Успешно', 'Устройство создано', 'success');
        } else {
            if (typeof window.updateDevice === 'function') {
                window.updateDevice({
                    id: devId,
                    name: data.name,
                    ip: data.ip_address,
                    type_id: data.type_id,
                    group_id: data.group_id,
                    monitoring_enabled: data.monitoring_enabled
                });
            }
            if (typeof reloadMapElements === 'function') reloadMapElements();
            showToast('Успешно', 'Устройство обновлено', 'success');
        }
        deviceModal.hide();
    })
    .catch(err => {
        Logger.error('Ошибка сохранения устройства:', err);
        showToast('Ошибка', err.message || 'Не удалось сохранить устройство', 'error');
    })
    .finally(() => {
        if (btnText) btnText.classList.remove('d-none');
        if (btnLoader) btnLoader.classList.add('d-none');
        if (saveBtn) saveBtn.disabled = false;
    });
};
window.deleteDevice = function(deviceId) {
    confirmAction('Удаление устройства', 'Вы уверены, что хотите удалить это устройство?', () => {
        fetch(`/api/device/${deviceId}`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': getCsrfToken()
            }
        })
        .then(async res => {
            if (res.status === 404) {
                if (typeof window.removeDeviceFromGraph === 'function') {
                    window.removeDeviceFromGraph(deviceId);
                }
                deviceModal.hide();
                showToast('Информация', 'Устройство уже было удалено', 'info');
                return;
            }
            if (!res.ok) {
                const errorMsg = await getErrorMessage(res);
                throw new Error(errorMsg);
            }
            if (typeof window.removeDeviceFromGraph === 'function') {
                window.removeDeviceFromGraph(deviceId);
            }
            deviceModal.hide();
            showToast('Успешно', 'Устройство удалено', 'success');
        })
        .catch(err => {
            Logger.error('Ошибка удаления устройства:', err);
            showToast('Ошибка', err.message || 'Не удалось удалить устройство', 'error');
        });
    });
};

function loadDeviceTypes(selectEl, callback) {
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
        if (callback) callback();
    })
    .catch(err => {
        Logger.error('Ошибка загрузки типов:', err);
        if (callback) callback(); // чтобы не сломать цепочку
    });
}

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
    .catch(err => Logger.error('Ошибка загрузки групп:', err));
}

// ==================== История ====================
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
        }

        renderHistoryTable(items, tbody);

        if (paginationDiv) {
            if (totalPages > 1) {
                paginationDiv.style.display = 'flex';
                pageInfo.textContent = `Страница ${currentPage} из ${totalPages}`;
                if (prevBtn) prevBtn.disabled = currentPage <= 1;
                if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
            } else {
                paginationDiv.style.display = 'none';
            }
        }

        currentHistoryPage = currentPage;
        totalHistoryPages = totalPages;
    })
    .catch(error => {
        Logger.error('Ошибка загрузки истории:', error);
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger">Ошибка загрузки</td></tr>';
        if (paginationDiv) paginationDiv.style.display = 'none';
        showToast('Ошибка', 'Не удалось загрузить историю', 'error');
    });
}

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
        html += `<tr><td>${formatDateTime(item.timestamp)}</td><td><span class="badge ${oldBadge}">${oldStatus || '—'}</span></td><td><span class="badge ${newBadge}">${newStatus || '—'}</span></td></tr>`;
    });
    tbody.innerHTML = html;
}

function loadHistoryPage(newPage) {
    if (newPage < 1 || newPage > totalHistoryPages) return;
    loadHistory(currentDeviceId, newPage);
}

// ==================== ГРУППЫ — ИСПРАВЛЕННАЯ ВЕРСИЯ ====================

// ===== Цветовой пикер =====
function initColorPicker() {
    const btn = document.getElementById('colorPickerBtn');
    const panel = document.getElementById('colorPanel');
    const input = document.getElementById('group_color');
    const preview = document.getElementById('colorPreview');
    const code = document.getElementById('colorCode');

    if (!btn || !panel || !input || !preview || !code) {
        Logger.error('❌ Color picker: элементы не найдены');
        return;
    }

    // Заменяем кнопку, чтобы удалить старые обработчики
    const newBtn = btn.cloneNode(true);
    if (btn.parentNode) {
        btn.parentNode.replaceChild(newBtn, btn);
    }

    // Обновляем ссылки на элементы после замены
    const newPanel = document.getElementById('colorPanel');
    const newInput = document.getElementById('group_color');
    const newPreview = document.getElementById('colorPreview');
    const newCode = document.getElementById('colorCode');

    function setColor(color) {
        newPreview.style.backgroundColor = color;
        newCode.textContent = color.toUpperCase();
        newInput.value = color;
        document.querySelectorAll('.color-swatch').forEach(sw => {
            sw.classList.toggle('active', sw.dataset.color?.toLowerCase() === color.toLowerCase());
        });
    }

    newBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const isVisible = newPanel.style.display !== 'none';
        newPanel.style.display = isVisible ? 'none' : 'block';
        newBtn.classList.toggle('active', !isVisible);
        newPanel.style.zIndex = '99999';
        newPanel.style.position = 'absolute';
    });

    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', function(e) {
            e.stopPropagation();
            const color = swatch.dataset.color;
            if (color) {
                setColor(color);
                newPanel.style.display = 'none';
                newBtn.classList.remove('active');
            }
        });
    });

    newInput.addEventListener('input', function(e) {
        setColor(e.target.value);
    });

    document.addEventListener('click', function(e) {
        if (!e.target.closest('#colorPickerBtn') && !e.target.closest('#colorPanel')) {
            newPanel.style.display = 'none';
            newBtn.classList.remove('active');
        }
    });

    newPanel.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    const defaultColor = newInput.value || '#3498db';
    setColor(defaultColor);

    window.setColor = setColor;
}

// ===== Обработчик формы =====
function initFormHandler() {
    if (_formHandlerAttached) return;
    _formHandlerAttached = true;

    const form = document.getElementById('groupForm');
    if (!form) return;

    const newForm = form.cloneNode(true);
    if (form.parentNode) {
        form.parentNode.replaceChild(newForm, form);
    }

    newForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!newForm.checkValidity()) {
            e.stopPropagation();
            newForm.classList.add('was-validated');
            return;
        }

        const id = document.getElementById('group_id')?.value;
        const name = document.getElementById('group_name')?.value.trim();
        const color = document.getElementById('group_color')?.value;

        if (!name) {
            showToast('Ошибка', 'Введите название группы', 'error');
            return;
        }

        const submitBtn = document.getElementById('submitBtn');
        const btnText = submitBtn?.querySelector('.btn-text');
        const btnLoader = submitBtn?.querySelector('.btn-loader');

        if (btnText) btnText.classList.add('d-none');
        if (btnLoader) btnLoader.classList.remove('d-none');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const isEdit = !!id;
            const url = isEdit ? `/api/group/${id}` : '/api/group';
            const method = isEdit ? 'PUT' : 'POST';
            const body = isEdit
                ? { name, color }
                : { map_id: window.currentMapId, name, color };

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const errorMsg = await getErrorMessage(res);
                throw new Error(errorMsg);
            }

            showToast(isEdit ? 'Группа обновлена' : 'Группа создана', `Группа "${name}"`, 'success');
            resetGroupForm();
            loadGroupsList();
            if (typeof reloadMapElements === 'function') reloadMapElements();

        } catch (err) {
            Logger.error('Submit error:', err);
            showToast('Ошибка', err.message || 'Не удалось сохранить', 'error');
        } finally {
            if (btnText) btnText.classList.remove('d-none');
            if (btnLoader) btnLoader.classList.add('d-none');
            if (submitBtn) submitBtn.disabled = false;
        }
    });

    document.getElementById('resetFormBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        resetGroupForm();
    });
}

// ===== Сброс формы =====
function resetGroupForm() {
    currentGroupId = null;
    const form = document.getElementById('groupForm');
    form?.classList.remove('was-validated');
    form?.reset();

    const defaultColor = '#3498db';
    if (window.setColor) {
        window.setColor(defaultColor);
    }

    const btnText = document.querySelector('#submitBtn .btn-text');
    if (btnText) btnText.textContent = 'Добавить группу';

    const idField = document.getElementById('group_id');
    if (idField) idField.value = '';
}

// ===== Загрузка списка =====
async function loadGroupsList() {
    const tbody = document.getElementById('groupListBody');
    const emptyState = document.getElementById('emptyState');
    const skeleton = document.getElementById('skeletonLoader');
    const countBadge = document.getElementById('groupsCount');

    if (!tbody) return;

    skeleton?.classList.remove('d-none');
    tbody.closest('.table-responsive')?.classList.add('d-none');
    emptyState?.classList.add('d-none');

    try {
        const res = await fetch(`/api/map/${window.currentMapId}/groups`);
        if (!res.ok) throw new Error('Ошибка: ' + res.status);

        const groups = await res.json();

        if (countBadge) countBadge.textContent = groups.length;

        if (groups.length === 0) {
            skeleton?.classList.add('d-none');
            tbody.closest('.table-responsive')?.classList.add('d-none');
            emptyState?.classList.remove('d-none');
            tbody.innerHTML = '';
            return;
        }

        tbody.innerHTML = groups.map((group, idx) => `
            <tr style="animation: rowFadeIn 0.25s ease ${idx * 50}ms forwards; opacity: 0">
                <td><span class="fw-medium">${escapeHtml(group.name)}</span></td>
                <td><span class="color-preview" style="background:${group.color}" title="${group.color}"></span></td>
                <td class="text-center"><span class="badge bg-light text-dark">${group.device_count || 0}</span></td>
                <td class="text-end">
                    <div class="table-actions">
                        <button type="button" class="btn-action" data-action="edit" data-id="${group.id}" data-name="${escapeHtml(group.name)}" data-color="${group.color}">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button type="button" class="btn-action btn-danger" data-action="delete" data-id="${group.id}" data-name="${escapeHtml(group.name)}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        Logger.error('Load groups error:', err);
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">Ошибка загрузки</td></tr>`;
        showToast('Ошибка', 'Не удалось загрузить группы', 'error');
    } finally {
        skeleton?.classList.add('d-none');
        tbody.closest('.table-responsive')?.classList.remove('d-none');
    }
}

// ===== Действия таблицы =====
function initTableActions() {
    const tbody = document.getElementById('groupListBody');
    const searchInput = document.getElementById('groupsSearch');

    tbody?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-action');
        if (!btn) return;

        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);

        if (action === 'edit') {
            editGroup(id, btn.dataset.name, btn.dataset.color);
        } else if (action === 'delete') {
            deleteGroup(id, btn.dataset.name);
        }
    });

    searchInput?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        const rows = tbody?.querySelectorAll('tr') || [];
        rows.forEach(row => {
            const name = row.querySelector('td:first-child')?.textContent.toLowerCase() || '';
            row.style.display = name.includes(term) ? '' : 'none';
        });
    });
}

// ===== Редактирование =====
window.editGroup = function(id, name, color) {
    currentGroupId = id;
    const idField = document.getElementById('group_id');
    const nameField = document.getElementById('group_name');

    if (idField) idField.value = id;
    if (nameField) {
        nameField.value = name;
        nameField.focus();
        nameField.select();
    }
    if (window.setColor) window.setColor(color);

    const btnText = document.querySelector('#submitBtn .btn-text');
    if (btnText) btnText.textContent = 'Сохранить';
};

// ===== Удаление =====
window.deleteGroup = async function(id, name) {
    confirmAction('Удаление группы', `Удалить группу "${name}"? Устройства останутся без привязки.`, async () => {
        try {
            const res = await fetch(`/api/group/${id}`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            if (!res.ok) {
                const errorMsg = await getErrorMessage(res);
                throw new Error(errorMsg);
            }
            showToast('Группа удалена', `Группа "${name}" удалена`, 'success');
            loadGroupsList();
            if (currentGroupId === id) resetGroupForm();
            if (typeof reloadMapElements === 'function') reloadMapElements();
        } catch (err) {
            Logger.error('Delete error:', err);
            showToast('Ошибка', err.message || 'Не удалось удалить группу', 'error');
        }
    });
};

// ===== Открытие модалки =====
window.openGroupManager = function() {
    if (!window.isAdmin) {
        showToast('Доступ запрещён', 'Только администратор может управлять группами', 'error');
        return;
    }
    if (window.isOperator) {
        showToast('Доступ запрещён', 'Оператор не может управлять группами', 'error');
        return;
    }

    if (!groupModal) {
        const el = document.getElementById('groupModal');
        if (el) {
            groupModal = new bootstrap.Modal(el);
        } else {
            Logger.error('Modal #groupModal not found');
            return;
        }
    }

    resetGroupForm();
    groupModal.show();
};

// ===== События модалки =====
function initModalEvents() {
    const modalEl = document.getElementById('groupModal');

    modalEl?.addEventListener('shown.bs.modal', () => {
        initColorPicker();
        loadGroupsList();
        setTimeout(() => {
            document.getElementById('group_name')?.focus();
        }, 100);
    });
}

// ===== Toast =====
function initToast() {
    const toastEl = document.getElementById('liveToast');
    if (toastEl && !toastEl.toast) {
        toastEl.toast = new bootstrap.Toast(toastEl, { delay: 3500 });
    }
}

// ===== Утилиты =====
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==================== Инициализация (ОДИН раз!) ====================
document.addEventListener('DOMContentLoaded', function() {
    Logger.info('📄 modal.js loaded');

    // Обработчик переключения на вкладку истории
    const historyTab = document.querySelector('a[href="#device-history"]');
    if (historyTab) {
        historyTab.addEventListener('shown.bs.tab', function() {
            const deviceId = document.getElementById('dev_id').value;
            if (deviceId) loadHistory(deviceId, 1);
        });
    }

    // Обработчики кнопок пагинации
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

    // Инициализация для групп
    initFormHandler();
    initTableActions();
    initToast();
    initModalEvents();

    Logger.info('✅ modal.js инициализирован');
});

window.openShapeModal = function(shapeNode = null) {
    if (!shapeModal) {
        const el = document.getElementById('shapeModal');
        if (el) shapeModal = new bootstrap.Modal(el);
        else return;
    }

    const idField = document.getElementById('shape_id');
    const typeSelect = document.getElementById('shape_type');
    const widthInput = document.getElementById('shape_width');
    const heightInput = document.getElementById('shape_height');
    const colorInput = document.getElementById('shape_color');
    const opacityInput = document.getElementById('shape_opacity');
    const descriptionInput = document.getElementById('shape_description');
    const deleteBtn = document.getElementById('deleteShapeBtn');

    if (shapeNode) {
        // Редактирование
        currentShapeId = shapeNode.id().replace('shape_', '');
        typeSelect.value = shapeNode.data('shape_type');
        widthInput.value = shapeNode.data('width');
        heightInput.value = shapeNode.data('height');
        colorInput.value = shapeNode.data('color');
        opacityInput.value = shapeNode.data('opacity');
        descriptionInput.value = shapeNode.data('description') || '';
        deleteBtn.style.display = 'inline-block';
        deleteBtn.onclick = () => deleteShape(currentShapeId);
    } else {
        // Создание новой фигуры
        currentShapeId = null;
        typeSelect.value = 'square';
        widthInput.value = 80;
        heightInput.value = 80;
        colorInput.value = '#3498db';
        opacityInput.value = 1;
        descriptionInput.value = '';
        deleteBtn.style.display = 'none';
    }
    document.getElementById('opacity_value').textContent = opacityInput.value;

    // Инициализация цветового пикера (заменяет кнопку и вешает обработчики)
    initShapeColorPicker();

    // Устанавливаем цвет в пикер, если редактируем
    if (shapeNode) {
        const color = shapeNode.data('color');
        if (window.setShapeColor) {
            window.setShapeColor(color);
        }
    }

    shapeModal.show();
};

window.saveShape = function() {
    const id = currentShapeId;
    const shapeType = document.getElementById('shape_type').value;
    const width = parseFloat(document.getElementById('shape_width').value);
    const height = parseFloat(document.getElementById('shape_height').value);
    const color = document.getElementById('shape_color').value;
    const opacity = parseFloat(document.getElementById('shape_opacity').value);
    const description = document.getElementById('shape_description').value;

    // Определяем позицию: если создаём новую, ставим в центр видимой области
    let x, y;
    if (!id) {
        if (cy) {
            const container = document.getElementById('cy');
            const pan = cy.pan();
            const zoom = cy.zoom();
            x = (-pan.x + container.clientWidth / 2) / zoom;
            y = (-pan.y + container.clientHeight / 2) / zoom;
        } else {
            x = 100; y = 100;
        }
    } else {
        // При редактировании позицию не меняем, она будет обновлена только при перемещении
        const node = cy.getElementById(`shape_${id}`);
        if (node.length) {
            x = node.position().x;
            y = node.position().y;
        } else {
            x = 100; y = 100;
        }
    }

    const data = {
        map_id: window.currentMapId,
        shape_type: shapeType,
        x: x,
        y: y,
        width: width,
        height: height,
        color: color,
        opacity: opacity,
        description: description
    };

    const url = id ? `/api/shape/${id}` : '/api/shape';
    const method = id ? 'PUT' : 'POST';

    fetch(url, {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify(data)
    })
    .then(async res => {
        if (!res.ok) throw new Error(await getErrorMessage(res));
        return res.json();
    })
    .then(() => {
        reloadMapElements();
        shapeModal.hide();
        showToast('Успешно', id ? 'Фигура обновлена' : 'Фигура создана', 'success');
    })
    .catch(err => {
        Logger.error('Error saving shape:', err);
        showToast('Ошибка', err.message, 'error');
    });
};

window.deleteShape = function(id) {
    confirmAction('Удаление фигуры', 'Удалить эту фигуру?', () => {
        fetch(`/api/shape/${id}`, {
            method: 'DELETE',
            headers: { 'X-CSRFToken': getCsrfToken() }
        })
        .then(async res => {
            if (!res.ok) throw new Error(await getErrorMessage(res));
            reloadMapElements();
            shapeModal.hide();
            showToast('Успешно', 'Фигура удалена', 'success');
        })
        .catch(err => {
            Logger.error('Error deleting shape:', err);
            showToast('Ошибка', err.message, 'error');
        });
    });
};

function initShapeColorPicker() {
    const btn = document.getElementById('shapeColorPickerBtn');
    const panel = document.getElementById('shapeColorPanel');
    const input = document.getElementById('shape_color');
    const preview = document.getElementById('shapeColorPreview');
    const code = document.getElementById('shapeColorCode');

    if (!btn || !panel || !input || !preview || !code) {
        Logger.error('❌ Shape color picker: элементы не найдены');
        return;
    }

    // Заменяем кнопку, чтобы удалить старые обработчики
    const newBtn = btn.cloneNode(true);
    if (btn.parentNode) {
        btn.parentNode.replaceChild(newBtn, btn);
    }

    // Обновляем ссылки на элементы после замены
    const newPanel = document.getElementById('shapeColorPanel');
    const newInput = document.getElementById('shape_color');
    const newPreview = document.getElementById('shapeColorPreview');
    const newCode = document.getElementById('shapeColorCode');

    function setColor(color) {
        newPreview.style.backgroundColor = color;
        newCode.textContent = color.toUpperCase();
        newInput.value = color;
        document.querySelectorAll('.color-swatch').forEach(sw => {
            sw.classList.toggle('active', sw.dataset.color?.toLowerCase() === color.toLowerCase());
        });
    }

    newBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const isVisible = newPanel.style.display !== 'none';
        newPanel.style.display = isVisible ? 'none' : 'block';
        newBtn.classList.toggle('active', !isVisible);
        newPanel.style.zIndex = '99999';
        newPanel.style.position = 'absolute';
    });

    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', function(e) {
            e.stopPropagation();
            const color = swatch.dataset.color;
            if (color) {
                setColor(color);
                newPanel.style.display = 'none';
                newBtn.classList.remove('active');
            }
        });
    });

    newInput.addEventListener('input', function(e) {
        setColor(e.target.value);
    });

    document.addEventListener('click', function(e) {
        if (!e.target.closest('#shapeColorPickerBtn') && !e.target.closest('#shapeColorPanel')) {
            newPanel.style.display = 'none';
            newBtn.classList.remove('active');
        }
    });

    newPanel.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    // Устанавливаем начальный цвет из поля ввода
    const defaultColor = newInput.value || '#3498db';
    setColor(defaultColor);

    // Экспортируем функцию для внешнего использования
    window.setShapeColor = setColor;
}