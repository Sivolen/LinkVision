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

// ==================== УПРАВЛЕНИЕ СПИСКОМ IP ====================
function addIpRow(value = '') {
    const container = document.getElementById('ips-container');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'ip-row';
    row.innerHTML = `
        <div class="ip-input-wrapper">
            <input type="text" class="form-control ip-input" placeholder="IPv4 или IPv6" value="${escapeHtml(value)}">
            <button class="btn-remove-ip" type="button" title="Удалить IP">&times;</button>
        </div>
    `;
    const removeBtn = row.querySelector('.btn-remove-ip');
    removeBtn.addEventListener('click', () => {
        if (container.children.length > 1) row.remove();
        else row.querySelector('.ip-input').value = '';
    });
    const ipInput = row.querySelector('.ip-input');
    ipInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = ipInput.value.trim();
            if (val) {
                addIpRow('');
                ipInput.disabled = true;
                const newInput = container.lastChild.querySelector('.ip-input');
                newInput.focus();
            }
        }
    });
    container.appendChild(row);
    return row;
}

function getIpsFromForm() {
    return Array.from(document.querySelectorAll('#ips-container .ip-input'))
        .map(inp => inp.value.trim())
        .filter(v => v);
}

function setIpsInForm(ips) {
    const container = document.getElementById('ips-container');
    if (!container) return;
    container.innerHTML = '';
    if (!ips || ips.length === 0) {
        addIpRow('');
    } else {
        ips.forEach(ip => addIpRow(ip));
        addIpRow('');
    }
}

// ==================== Устройство ====================
window.openDeviceModal = function(node) {
    if (!deviceModal) {
        const el = document.getElementById('deviceModal');
        if (el) deviceModal = new bootstrap.Modal(el);
        else return;
    }

    const devId = document.getElementById('dev_id');
    const devName = document.getElementById('dev_name');
    const devType = document.getElementById('dev_type');
    const deleteBtn = document.getElementById('deleteDeviceBtn');
    const neighborsBody = document.getElementById('device-neighbors-body');
    const devGroup = document.getElementById('dev_group');
    const monitoringCheck = document.getElementById('dev_monitoring');

    const historyTabItem = document.querySelector('a[href="#device-history"]')?.closest('.nav-item');
    const neighborsTabItem = document.querySelector('a[href="#device-neighbors"]')?.closest('.nav-item');
    const infoTabLink = document.querySelector('a[href="#device-info"]');

    const historyBody = document.getElementById('device-history-body');
    const fontSizeInput = document.getElementById('dev_font_size');

    if (historyBody) historyBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Переключитесь на вкладку "История"</td></tr>';
    const paginationDiv = document.getElementById('history-pagination');
    if (paginationDiv) paginationDiv.style.display = 'none';

    if (node) {
        devId.value = node.id();
        devName.value = node.data('name') || '';
        deleteBtn.style.display = 'inline-block';
        deleteBtn.onclick = () => window.deleteDevice(node.id());

        if (historyTabItem) historyTabItem.style.display = 'block';
        if (neighborsTabItem) neighborsTabItem.style.display = 'block';

        fetch(`/api/device/${node.id()}/details`)
            .then(res => res.ok ? res.json() : Promise.reject('Ошибка'))
            .then(data => {
                loadDeviceTypes(devType, () => {
                    if (data.type_id) devType.value = data.type_id;
                });
                // Загружаем список IP
                if (data.ips) setIpsInForm(data.ips);
                else setIpsInForm([]);

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
                fontSizeInput.value = node.data('fontSize') || '';
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
        fontSizeInput.value = '';
        if (devType) devType.value = '';
        deleteBtn.style.display = 'none';
        neighborsBody.innerHTML = '</tr><td colspan="5" class="text-center text-muted">Нет данных</td></tr>';
        loadGroups(devGroup);
        setIpsInForm([]); // чистый список для нового устройства

        if (historyTabItem) historyTabItem.style.display = 'none';
        if (neighborsTabItem) neighborsTabItem.style.display = 'none';
        loadDeviceTypes(devType);
    }

    if (infoTabLink) {
        const infoTab = new bootstrap.Tab(infoTabLink);
        infoTab.show();
    }

    if (window.isOperator) {
        devName.disabled = true;
        document.querySelectorAll('#ips-container .ip-input').forEach(inp => inp.disabled = true);
        document.getElementById('add-ip-btn')?.setAttribute('disabled', 'disabled');
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

window.saveDevice = async function() {
    const devId = document.getElementById('dev_id').value;
    const name = document.getElementById('dev_name').value.trim();
    const typeId = document.getElementById('dev_type').value;
    const groupId = document.getElementById('dev_group').value;
    const monitoring = document.getElementById('dev_monitoring').checked;
    const fontSize = document.getElementById('dev_font_size').value;
    const ips = getIpsFromForm();

    if (!name || !typeId) {
        showToast('Ошибка', 'Имя и тип устройства обязательны', 'error');
        return;
    }

    // Валидация IP-адресов
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^(([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$/;
    for (let ip of ips) {
        if (ip && ip.trim() && !ipv4Regex.test(ip.trim()) && !ipv6Regex.test(ip.trim())) {
            showToast('Ошибка', `Неверный IP-адрес: ${ip}`, 'error');
            return;
        }
    }

    const data = {
        name: name,
        ips: ips,
        type_id: parseInt(typeId),
        group_id: groupId ? parseInt(groupId) : null,
        monitoring_enabled: monitoring
    };
    if (fontSize !== '') {
        data.font_size = parseInt(fontSize, 10);
    } else {
        data.font_size = null;
    }

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
    .then(async result => {
        if (!devId) {
            const newDevice = {
                id: result.id,
                name: data.name,
                ips: data.ips,
                type_id: data.type_id,
                group_id: data.group_id,
                monitoring_enabled: data.monitoring_enabled,
                x: data.x,
                y: data.y,
                status: 'true',
                iconUrl: result.iconUrl,
                width: result.width,
                height: result.height
            };
            if (typeof window.addDeviceToGraph === 'function') {
                await window.addDeviceToGraph(newDevice);
            }
            if (typeof window.saveState === 'function') window.saveState('Создание устройства');
            showToast('Успешно', 'Устройство создано', 'success');
            } else {
                if (typeof window.updateDevice === 'function') {
                    window.updateDevice({
                        id: devId,
                        name: data.name,
                        ips: data.ips,
                        type_id: data.type_id,
                        group_id: data.group_id,
                        monitoring_enabled: data.monitoring_enabled,
                        font_size: data.font_size
                    });
                }

                // Если мониторинг выключен – перезагружаем карту, чтобы убрать пульсацию
                if (!monitoring) {
                    if (typeof window.stopAllPulsing === 'function') {
                        window.stopAllPulsing();
                    }
                    const node = window.cy ? window.cy.getElementById(String(devId)) : null;
                    if (node && node.length) {
                        // Сохраняем настоящий статус
                        const originalStatus = node.data('status');
                        node.data('_original_status', originalStatus);
                        // Временно ставим статус 'up', чтобы убрать жёлтый/красный
                        node.data('status', 'up');
                        node.data('monitoring_enabled', 'false');
                        if (typeof window.applyGrayStyle === 'function') {
                            window.applyGrayStyle(node);
                        }
                        window.cy.style().update();
                    }

                } else {
                    const node = window.cy ? window.cy.getElementById(String(devId)) : null;
                    if (node && node.length) {
                        node.data('monitoring_enabled', 'true');
                        // Восстанавливаем статус
                        const savedStatus = node.data('_original_status');
                        if (savedStatus && (savedStatus === 'down' || savedStatus === 'partial')) {
                            node.data('status', savedStatus);
                            if (typeof window.addPulsingNode === 'function') {
                                window.addPulsingNode(window.cy, node, savedStatus);
                            }
                        }
                        window.cy.style().update();
                    }
                }
                if (typeof window.saveState === 'function') window.saveState('Редактирование устройства');
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
            if (typeof window.saveState === 'function') window.saveState('Удаление устройства');
            if (typeof window.reloadMapElements === 'function') {
                window.reloadMapElements();
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

// Предварительная загрузка типов устройств
function preloadDeviceTypes() {
    fetch('/api/types')
        .then(res => res.ok ? res.json() : [])
        .then(types => {
            window.deviceTypes = types;
        })
        .catch(err => Logger.error('Ошибка предзагрузки типов:', err));
}

// Обновлённая loadDeviceTypes (сохраняет в глобальную переменную)
function loadDeviceTypes(selectEl, callback) {
    if (!selectEl) return;
    fetch('/api/types')
    .then(res => res.ok ? res.json() : [])
    .then(types => {
        window.deviceTypes = types;
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
        if (callback) callback();
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

// ==================== ГРУППЫ ====================

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

    const newBtn = btn.cloneNode(true);
    if (btn.parentNode) {
        btn.parentNode.replaceChild(newBtn, btn);
    }

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
        const fontSize = parseInt(document.getElementById('group_font_size').value, 10) || 11;

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
                ? { name, color, font_size: fontSize }
                : { map_id: window.currentMapId, name, color, font_size: fontSize };

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

    const fontSizeInput = document.getElementById('group_font_size');
    if (fontSizeInput) fontSizeInput.value = 11;

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
                        <button type="button" class="btn-action" data-action="edit" data-id="${group.id}" data-name="${escapeHtml(group.name)}" data-color="${group.color}" data-fontsize="${group.font_size || 11}">
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
            const name = btn.dataset.name;
            const color = btn.dataset.color;
            const fontSize = btn.dataset.fontsize || 11;
            editGroup(id, name, color, fontSize);
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
window.editGroup = function(id, name, color, fontSize) {
    currentGroupId = id;
    const idField = document.getElementById('group_id');
    const nameField = document.getElementById('group_name');
    const fontSizeInput = document.getElementById('group_font_size');

    if (idField) idField.value = id;
    if (nameField) {
        nameField.value = name;
        nameField.focus();
        nameField.select();
    }
    if (window.setColor) window.setColor(color);
    if (fontSizeInput) fontSizeInput.value = fontSize || 11;

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
            if (typeof window.saveState === 'function') window.saveState('Удаление группы');
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
    const fontSizeInput = document.getElementById('group_font_size');
    if (fontSizeInput) fontSizeInput.value = 11;
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

// ==================== Фигуры ====================
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
        currentShapeId = null;
        typeSelect.value = 'square';
        widthInput.value = 80;
        heightInput.value = 80;
        colorInput.value = '#3498db';
        opacityInput.value = 1;
        descriptionInput.value = '';
        deleteBtn.style.display = 'none';
    }
    const opacitySpan = document.getElementById('opacity_value');
    if (opacitySpan) {
        const percent = Math.round(opacityInput.value * 100);
        opacitySpan.textContent = `${percent}%`;
    }
    const fontSizeInput = document.getElementById('shape_font_size');
    if (shapeNode) {
        fontSizeInput.value = shapeNode.data('fontSize') || 12;
    } else {
        fontSizeInput.value = 12;
    }

    initShapeColorPicker();
    initShapeModalEvents();

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
    const fontSize = parseInt(document.getElementById('shape_font_size').value, 10) || 12;
    const color = document.getElementById('shape_color').value;
    const opacity = parseFloat(document.getElementById('shape_opacity').value);
    const description = document.getElementById('shape_description').value;

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
        description: description,
        font_size: fontSize
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
        if (typeof window.saveState === 'function') window.saveState(id ? 'Редактирование фигуры' : 'Создание фигуры');
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
            if (typeof window.saveState === 'function') window.saveState('Удаление фигуры');
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

    const newBtn = btn.cloneNode(true);
    if (btn.parentNode) {
        btn.parentNode.replaceChild(newBtn, btn);
    }

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

    const defaultColor = newInput.value || '#3498db';
    setColor(defaultColor);

    window.setShapeColor = setColor;
}

function initShapeModalEvents() {
    const opacitySlider = document.getElementById('shape_opacity');
    const opacitySpan = document.getElementById('opacity_value');
    if (opacitySlider && opacitySpan) {
        opacitySlider.addEventListener('input', function() {
            const percent = Math.round(this.value * 100);
            opacitySpan.textContent = `${percent}%`;
        });
        const initialPercent = Math.round(opacitySlider.value * 100);
        opacitySpan.textContent = `${initialPercent}%`;
    }
}

// ==================== СВЯЗИ (LINKS) ====================
let linkModal = null;

function updateLinkPreview() {
    const src = document.getElementById('link_src_iface')?.value || 'eth0';
    const tgt = document.getElementById('link_tgt_iface')?.value || 'eth0';
    const preview = document.getElementById('link_preview');
    if (preview) preview.textContent = `${src} ↔ ${tgt}`;
}

window.openLinkModal = function(sourceId, targetId) {
    if (!linkModal) {
        const el = document.getElementById('linkModal');
        if (el) linkModal = new bootstrap.Modal(el);
        else return;
    }
    document.getElementById('link_id').value = '';
    document.getElementById('link_source').value = sourceId;
    document.getElementById('link_target').value = targetId;
    document.getElementById('link_src_iface').value = 'eth0';
    document.getElementById('link_tgt_iface').value = 'eth0';
    document.getElementById('link_type').value = '';
    document.getElementById('link_line_color').value = '#6c757d';
    document.getElementById('link_line_width').value = 2;
    document.getElementById('link_line_style').value = 'solid';
    document.getElementById('linkModalTitle').textContent = 'Новая связь';
    document.getElementById('linkDeleteBtn').style.display = 'none';
    document.getElementById('link_font_size').value = 8;
    updateLinkPreview();

    if (window.isOperator) {
        document.querySelectorAll('#linkModal input, #linkModal select').forEach(el => el.disabled = true);
        const saveBtn = document.querySelector('#linkModal .btn-primary');
        const deleteBtn = document.querySelector('#linkModal .btn-danger');
        if (saveBtn) saveBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }
    linkModal.show();
};

window.openLinkModalForEdit = function(edge) {
    if (!linkModal) {
        const el = document.getElementById('linkModal');
        if (el) linkModal = new bootstrap.Modal(el);
        else return;
    }
    const data = edge.data();
    document.getElementById('link_id').value = data.id;
    document.getElementById('link_source').value = data.source;
    document.getElementById('link_target').value = data.target;
    let srcIface = data.srcIface;
    let tgtIface = data.tgtIface;
    if (!srcIface || !tgtIface) {
        const parts = (data.label || 'eth0↔eth0').split('↔');
        srcIface = parts[0].trim();
        tgtIface = parts[1].trim();
    }
    document.getElementById('link_src_iface').value = srcIface;
    document.getElementById('link_tgt_iface').value = tgtIface;
    document.getElementById('link_type').value = data.link_type || '';
    document.getElementById('link_line_color').value = data.color || '#6c757d';
    document.getElementById('link_line_width').value = data.width || 2;
    document.getElementById('link_line_style').value = data.style || 'solid';
    document.getElementById('linkModalTitle').textContent = 'Редактировать связь';
    document.getElementById('linkDeleteBtn').style.display = 'inline-block';
    document.getElementById('linkDeleteBtn').onclick = () => window.deleteLink(data.id);
    document.getElementById('link_font_size').value = data.font_size || 8;
    updateLinkPreview();

    if (window.isOperator) {
        document.querySelectorAll('#linkModal input, #linkModal select').forEach(el => el.disabled = true);
        const saveBtn = document.querySelector('#linkModal .btn-primary');
        const deleteBtn = document.querySelector('#linkModal .btn-danger');
        if (saveBtn) saveBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }
    linkModal.show();
};

window.confirmCreateLink = function() {
    const linkId = document.getElementById('link_id').value;
    const src = document.getElementById('link_source')?.value;
    const tgt = document.getElementById('link_target')?.value;
    const srcIface = document.getElementById('link_src_iface')?.value || 'eth0';
    const tgtIface = document.getElementById('link_tgt_iface')?.value || 'eth0';
    const linkType = document.getElementById('link_type')?.value;
    const lineColor = document.getElementById('link_line_color')?.value;
    const lineWidth = parseInt(document.getElementById('link_line_width')?.value) || 2;
    const lineStyle = document.getElementById('link_line_style')?.value;
    const fontSize = parseInt(document.getElementById('link_font_size').value, 10) || 8;

    if (!src || !tgt) {
        showToast('Ошибка', 'Не выбраны устройства', 'error');
        return;
    }

    window.setLinkSaving(true);
    if (linkModal) linkModal.hide();

    if (linkId) {
        window.updateLink(linkId, srcIface, tgtIface, linkType, lineColor, lineWidth, lineStyle, fontSize);
    } else {
        window.createLinkWithInterfaces(src, tgt, srcIface, tgtIface, linkType, lineColor, lineWidth, lineStyle, fontSize);
    }
};

window.createLinkWithInterfaces = function(src, tgt, srcIface, tgtIface, linkType, lineColor, lineWidth, lineStyle, fontSize) {
    const sourceId = typeof src === 'number' ? src : parseInt(src);
    const targetId = typeof tgt === 'number' ? tgt : parseInt(tgt);
    if (isNaN(sourceId) || isNaN(targetId)) {
        showToast('Ошибка', 'Неверные ID устройств', 'error');
        return;
    }

    fetch('/api/link', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            map_id: window.currentMapId,
            source_id: sourceId,
            target_id: targetId,
            src_iface: srcIface,
            tgt_iface: tgtIface,
            link_type: linkType || null,
            line_color: lineColor,
            line_width: lineWidth,
            line_style: lineStyle,
            font_size: fontSize
        })
    })
    .then(async res => {
        if (!res.ok) throw new Error(await getErrorMessage(res));
        return res.json();
    })
    .then(data => {
        if (data.id && window.cy) {
            const sourceNode = window.cy.getElementById(String(sourceId));
            const targetNode = window.cy.getElementById(String(targetId));
            const srcX = sourceNode.position().x;
            const tgtX = targetNode.position().x;
            let label;
            if (srcX <= tgtX) {
                label = `${srcIface} ↔ ${tgtIface}`;
            } else {
                label = `${tgtIface} ↔ ${srcIface}`;
            }
            window.cy.add({
                group: 'edges',
                data: {
                    id: `link_${data.id}`,
                    source: String(sourceId),
                    target: String(targetId),
                    label: label,
                    srcIface: srcIface,
                    tgtIface: tgtIface,
                    link_type: linkType,
                    color: lineColor,
                    width: lineWidth,
                    style: lineStyle,
                    font_size: fontSize
                }
            });
            if (typeof window.saveState === 'function') window.saveState('Создание связи');
            if (typeof window.resetLinkMode === 'function') window.resetLinkMode();
            showToast('Успешно', 'Связь создана', 'success');
        }
        if (linkModal) linkModal.hide();
    })
    .catch(err => {
        console.error(err);
        showToast('Ошибка', err.message || 'Не удалось создать связь', 'error');
    })
    .finally(() => window.setLinkSaving(false));
};

window.updateLink = function(linkId, srcIface, tgtIface, linkType, lineColor, lineWidth, lineStyle, fontSize) {
    const numericId = linkId.replace('link_', '');
    fetch(`/api/link/${numericId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            source_interface: srcIface,
            target_interface: tgtIface,
            link_type: linkType || null,
            line_color: lineColor,
            line_width: lineWidth,
            line_style: lineStyle,
            font_size: fontSize
        })
    })
    .then(async res => {
        if (!res.ok) {
            const errorMsg = await getErrorMessage(res);
            throw new Error(errorMsg);
        }
        const edge = window.cy.getElementById(linkId);
        if (edge.length) {
            const sourceNode = edge.source();
            const targetNode = edge.target();
            const srcX = sourceNode.position().x;
            const tgtX = targetNode.position().x;
            let label;
            if (srcX <= tgtX) {
                label = `${srcIface} ↔ ${tgtIface}`;
            } else {
                label = `${tgtIface} ↔ ${srcIface}`;
            }
            edge.data({
                label: label,
                srcIface: srcIface,
                tgtIface: tgtIface,
                link_type: linkType,
                color: lineColor,
                width: lineWidth,
                style: lineStyle,
                font_size: fontSize
            });
            edge.style({
                'line-color': lineColor,
                'width': lineWidth,
                'line-style': lineStyle
            });
            window.cy.style().update();
            if (typeof window.saveState === 'function') window.saveState('Редактирование связи');
        }
        showToast('Успешно', 'Связь обновлена', 'success');
        if (linkModal) linkModal.hide();
    })
    .catch(err => {
        console.error(err);
        showToast('Ошибка', err.message || 'Не удалось обновить связь', 'error');
    })
    .finally(() => window.setLinkSaving(false));
};

window.deleteLink = function(linkId) {
    confirmAction('Удаление связи', 'Удалить эту связь?', () => {
        const numericId = String(linkId).replace('link_', '');
        fetch(`/api/link/${numericId}`, {
            method: 'DELETE',
            headers: { 'X-CSRFToken': getCsrfToken() }
        })
        .then(async res => {
            if (!res.ok) throw new Error(await getErrorMessage(res));
            if (window.cy) window.cy.getElementById(String(linkId)).remove();
            if (typeof window.saveState === 'function') window.saveState('Удаление связи');
            if (linkModal) linkModal.hide();
            showToast('Успешно', 'Связь удалена', 'success');
        })
        .catch(err => {
            console.error(err);
            showToast('Ошибка', err.message || 'Не удалось удалить связь', 'error');
        });
    });
};

window.setLinkSaving = function(isSaving) {
    const saveBtn = document.getElementById('saveLinkBtn');
    const btnText = saveBtn?.querySelector('.btn-text');
    const btnLoader = saveBtn?.querySelector('.btn-loader');
    if (!saveBtn) return;
    if (isSaving) {
        if (btnText) btnText.classList.add('d-none');
        if (btnLoader) btnLoader.classList.remove('d-none');
        saveBtn.disabled = true;
    } else {
        if (btnText) btnText.classList.remove('d-none');
        if (btnLoader) btnLoader.classList.add('d-none');
        saveBtn.disabled = false;
    }
};

window.applyLinkTypePreset = function(type) {
    const presets = {
        '100m':  { color: '#d1d5db', width: 2, style: 'solid' },
        '1G':    { color: '#3b82f6', width: 3, style: 'solid' },
        '10G':   { color: '#2563eb', width: 4, style: 'solid' },
        '25G':   { color: '#4f46e5', width: 5, style: 'solid' },
        '100G':  { color: '#6b7280', width: 6, style: 'solid' },
        '400G':  { color: '#8b5cf6', width: 8, style: 'solid' },
        'vlan':  { color: '#94a3b8', width: 2, style: 'dashed' },
        'radio': { color: '#84cc16', width: 2, style: 'dotted' },
        'tunnel': { color: '#06b6d4', width: 2, style: 'dashed' }
    };
    if (type && presets[type]) {
        const colorInput = document.getElementById('link_line_color');
        const widthInput = document.getElementById('link_line_width');
        const styleSelect = document.getElementById('link_line_style');
        if (colorInput) colorInput.value = presets[type].color;
        if (widthInput) widthInput.value = presets[type].width;
        if (styleSelect) styleSelect.value = presets[type].style;
        if (typeof updateLinkPreview === 'function') updateLinkPreview();
    }
};

// ==================== ЭКСПОРТ КАРТЫ ====================
window.exportMap = function() {
    const mapId = document.getElementById('edit_map_id').value;
    if (!mapId) {
        showToast('Ошибка', 'Не удалось определить карту', 'error');
        return;
    }
    fetch(`/api/map/${mapId}/export`, {
        method: 'GET',
        headers: { 'X-CSRFToken': getCsrfToken() }
    })
    .then(async res => {
        if (!res.ok) throw new Error(await getErrorMessage(res));
        return res.json();
    })
    .then(data => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `map_${mapId}_export.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Успешно', 'Карта экспортирована', 'success');
    })
    .catch(err => {
        console.error('Error exporting map:', err);
        showToast('Ошибка', err.message || 'Не удалось экспортировать карту', 'error');
    });
};

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
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
    preloadDeviceTypes();

    // Инициализация кнопки добавления IP
    document.getElementById('add-ip-btn')?.addEventListener('click', () => addIpRow(''));

    Logger.info('✅ modal.js инициализирован');
});

// Экспорты
window.openDeviceModal = openDeviceModal;
window.openShapeModal = openShapeModal;
window.openLinkModal = openLinkModal;
window.openLinkModalForEdit = openLinkModalForEdit;
window.saveDevice = saveDevice;
window.deleteDevice = deleteDevice;