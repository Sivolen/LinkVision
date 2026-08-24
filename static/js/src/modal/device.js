/**
 * Device Modal Module
 * Управление модальным окном устройств
 */

// Импорты
import { addIpRow, getIpsFromForm, setIpsInForm } from './ipManager.js';
import { t } from '../i18n/i18n.js';
import { showToast } from '../utils/toast.js';
import { getErrorMessage, escapeHtml } from './utils.js';
import { withViewportRestore, reloadMapWithViewportRestore } from './mapIntegration.js';
import { http } from '../utils/http.js';
import { beginSelfUpdate, endSelfUpdate } from '../utils/state.js';

// Глобальные переменные модуля
let deviceModal = null;
let currentHistoryPage = 1;
let totalHistoryPages = 1;
let currentDeviceId = null;
let historyPerPage = 10;

/**
 * Загрузить типы устройств
 */
function loadDeviceTypes(selectEl, callback) {
    if (!selectEl) return;
    
    http.get('/api/types')
        .then(types => {
            window.deviceTypes = types;
            selectEl.innerHTML = '<option value="">' + t('modal.device.selectTypeOpt') + '</option>';
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

/**
 * Загрузить группы для карты
 */
function loadGroups(selectEl, selectedGroupId) {
    if (!selectEl) return;
    
    const mapId = window.currentMapId;
    if (!mapId) return;
    
    fetch(`/api/map/${mapId}/groups`)
        .then(res => res.ok ? res.json() : [])
        .then(groups => {
            selectEl.innerHTML = '<option value="">' + t('modal.device.noGroupOpt') + '</option>';
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

/**
 * Открыть модальное окно устройства
 */
export function openDeviceModal(node) {
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

    if (historyBody) historyBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">' + t('modal.device.switchToHistory') + '</td></tr>';
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
            .then(res => res.ok ? res.json() : Promise.reject(t('toast.errorTitle')))
            .then(data => {
                loadDeviceTypes(devType, () => {
                    if (data.type_id) devType.value = data.type_id;
                });
                
                if (data.ips) setIpsInForm(data.ips);
                else setIpsInForm([]);

                if (data.neighbors && data.neighbors.length > 0) {
                    neighborsBody.innerHTML = '';
                    data.neighbors.forEach(n => {
                        const row = neighborsBody.insertRow();
                        row.insertCell().innerHTML =
                            `<a href="#" onclick="goToDevice(${Number(n.device_id) || 0})">${escapeHtml(n.device_name)}</a>`;
                        row.insertCell().textContent = n.interface;
                        row.insertCell().textContent = '↔';
                        row.insertCell().textContent = n.neighbor_interface;
                        row.insertCell().textContent = n.link_type || '—';
                    });
                } else {
                    neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">' + t('modal.device.noLinks') + '</td></tr>';
                }
                if (monitoringCheck) monitoringCheck.checked = data.monitoring_enabled;
                fontSizeInput.value = node.data('fontSize') || '';
                loadGroups(devGroup, data.group_id);
            })
            .catch(err => {
                Logger.error('Ошибка загрузки деталей:', err);
                neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">' + t('common.loadError') + '</td></tr>';
                showToast(t('toast.errorTitle'), t('modal.device.loadFail'), 'error');
            });
    } else {
        devId.value = '';
        devName.value = '';
        fontSizeInput.value = '';
        if (devType) devType.value = '';
        deleteBtn.style.display = 'none';
        neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">' + t('modal.device.noData') + '</td></tr>';
        loadGroups(devGroup);
        setIpsInForm([]);

        if (historyTabItem) historyTabItem.style.display = 'none';
        if (neighborsTabItem) neighborsTabItem.style.display = 'none';
        loadDeviceTypes(devType);
    }

    if (infoTabLink) {
        const infoTab = new bootstrap.Tab(infoTabLink);
        infoTab.show();
    }

    // Права считаем каждый раз заново и выставляем ОБЕ ветки явно (а не только
    // "запрещено"), иначе disabled/скрытое состояние, выставленное при прошлом
    // открытии модалки без прав на редактирование, остаётся навсегда — даже
    // после того как карту разблокировали, ведь ничего не возвращает элементы
    // обратно во "включено". Кнопки теперь только отключаются, не скрываются —
    // видимость Save/Delete зависит от того, новое это устройство или нет
    // (см. выше), а не от прав редактирования.
    const canEdit = window.canEditMap === true;
    devName.disabled = !canEdit;
    document.querySelectorAll('#ips-container .ip-input').forEach(inp => inp.disabled = !canEdit);
    const addIpBtn = document.getElementById('add-ip-btn');
    if (addIpBtn) addIpBtn.disabled = !canEdit;
    devType.disabled = !canEdit;
    devGroup.disabled = !canEdit;
    if (monitoringCheck) monitoringCheck.disabled = !canEdit;
    const saveBtn = document.querySelector('#deviceModal .btn-primary');
    if (saveBtn) {
        saveBtn.disabled = !canEdit;
        saveBtn.title = canEdit ? '' : t('common.accessDenied');
    }
    if (deleteBtn) {
        deleteBtn.disabled = !canEdit;
        deleteBtn.title = canEdit ? '' : t('common.accessDenied');
    }

    deviceModal.show();
}

/**
 * Сохранить устройство
 */
export async function saveDevice() {
    const devId = document.getElementById('dev_id').value;
    const name = document.getElementById('dev_name').value.trim();
    const typeId = document.getElementById('dev_type').value;
    const groupId = document.getElementById('dev_group').value;
    const monitoring = document.getElementById('dev_monitoring').checked;
    const fontSize = document.getElementById('dev_font_size').value;
    const ips = getIpsFromForm();

    if (!name || !typeId) {
        showToast(t('toast.errorTitle'), t('modal.device.nameTypeRequired'), 'error');
        return;
    }

    // Валидация IP
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^(([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$/;
    for (let ip of ips) {
        if (ip && ip.trim() && !ipv4Regex.test(ip.trim()) && !ipv6Regex.test(ip.trim())) {
            showToast(t('toast.errorTitle'), t('modal.device.invalidIp', { ip }), 'error');
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
    if (fontSize !== '') data.font_size = parseInt(fontSize, 10);
    else data.font_size = null;

    if (!devId) {
        if (!window.currentMapId) {
            showToast(t('toast.errorTitle'), t('modal.device.noCurrentMap'), 'error');
            return;
        }
        data.map_id = window.currentMapId;
        if (window.cy && typeof window.cy.pan === 'function') {
            const container = document.getElementById('cy');
            const pan = window.cy.pan();
            const zoom = window.cy.zoom();
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

    beginSelfUpdate();

    try {
        const result = await (method === 'POST' ? http.post : http.put)(url, data);

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
                status: 'up',
                iconUrl: result.iconUrl,
                width: result.width,
                height: result.height
            };
            if (typeof window.addDeviceToGraph === 'function') {
                try {
                    await window.addDeviceToGraph(newDevice);
                    console.log('Device added to graph:', newDevice.id);
                    // Обновить группы и метки рёбер
                    if (typeof window.updateAllGroups === 'function') window.updateAllGroups();
                    if (typeof window.updateAllEdgeLabels === 'function') window.updateAllEdgeLabels();
                } catch (e) {
                    console.error('addDeviceToGraph failed:', e);
                    showToast(t('toast.errorTitle'), t('modal.device.renderFail'), 'error');
                    // Не прерываем выполнение – устройство уже создано на сервере
                }
            }
            showToast(t('toast.successTitle'), t('modal.device.created'), 'success');
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

            // Восстановление viewport через общий модуль
            await reloadMapWithViewportRestore();

            if (typeof window.loadSidebarMaps === 'function') {
                setTimeout(() => window.loadSidebarMaps(), 200);
            }
            showToast(t('toast.successTitle'), t('modal.device.updated'), 'success');
        }
        
        deviceModal.hide();
    } catch (err) {
        Logger.error('Ошибка сохранения устройства:', err);
        showToast(t('toast.errorTitle'), err.message || t('modal.device.saveFail'), 'error');
    } finally {
        if (btnText) btnText.classList.remove('d-none');
        if (btnLoader) btnLoader.classList.add('d-none');
        if (saveBtn) saveBtn.disabled = false;
        endSelfUpdate();
    }
}

/**
 * Удалить устройство
 */
export function deleteDevice(deviceId) {
    window.confirmAction(t('modal.device.deleteTitle'), t('modal.device.deleteMsg'), async () => {
        beginSelfUpdate();

        try {
            const result = await http.del(`/api/device/${deviceId}`);

            if (typeof window.removeDeviceFromGraph === 'function') {
                window.removeDeviceFromGraph(deviceId);
            }

            // Восстановление viewport через общий модуль
            await reloadMapWithViewportRestore();

            deviceModal.hide();
            showToast(t('toast.successTitle'), t('modal.device.deleted'), 'success');
        } catch (err) {
            Logger.error('Ошибка удаления устройства:', err);
            showToast(t('toast.errorTitle'), err.message || t('modal.device.deleteFail'), 'error');
        } finally {
            endSelfUpdate();
        }
    });
}

/**
 * Инициализация модального окна устройства
 */
export function initDeviceModal() {
    // Обработчик скрытия модального окна
    document.getElementById('deviceModal')?.addEventListener('hidden.bs.modal', function() {
        const historyBody = document.getElementById('device-history-body');
        if (historyBody) historyBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">' + t('modal.device.switchToHistory') + '</td></tr>';
        
        const neighborsBody = document.getElementById('device-neighbors-body');
        if (neighborsBody) neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">' + t('common.loading') + '</td></tr>';
        
        const paginationDiv = document.getElementById('history-pagination');
        if (paginationDiv) paginationDiv.style.display = 'none';
    });

    Logger.info('Device modal инициализирован');
}

// Экспорт для глобального доступа
window.openDeviceModal = openDeviceModal;
window.saveDevice = saveDevice;
window.deleteDevice = deleteDevice;
