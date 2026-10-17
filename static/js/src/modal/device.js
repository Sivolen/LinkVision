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
import { loadDeviceQuality, clearDeviceQuality } from './quality.js';

// Глобальные переменные модуля
let deviceModal = null;
let currentHistoryPage = 1;
let totalHistoryPages = 1;
let currentDeviceId = null;
let historyPerPage = 10;
// Keep the context-menu target until the server confirms device creation.
let pendingCreatePosition = null;
let deviceModalLoadId = 0;

function isCurrentDeviceModalLoad(loadId) {
    return deviceModalLoadId === loadId;
}

/**
 * Загрузить типы устройств
 */
function loadDeviceTypes(selectEl, callback, isCurrent = () => true) {
    if (!selectEl) return;
    
    http.get('/api/types')
        .then(types => {
            if (!isCurrent()) return;
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
            if (!isCurrent()) return;
            Logger.error('Ошибка загрузки типов:', err);
            if (callback) callback();
        });
}

/**
 * Загрузить группы для карты
 */
function loadGroups(selectEl, selectedGroupId, isCurrent = () => true) {
    if (!selectEl) return;
    
    const mapId = window.currentMapId;
    if (!mapId) return;
    
    fetch(`/api/map/${mapId}/groups`)
        .then(res => res.ok ? res.json() : [])
        .then(groups => {
            if (!isCurrent()) return;
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
 * Загрузить профили качества связи для устройства
 */
function loadQualityProfiles(selectEl, selectedProfileId, isCurrent = () => true) {
    if (!selectEl) return;

    fetch('/api/quality-profiles')
        .then(res => res.ok ? res.json() : [])
        .then(profiles => {
            if (!isCurrent()) return;
            selectEl.innerHTML = '<option value="">' + t('modal.device.defaultQualityProfileOpt') + '</option>';

            // Глобальный профиль по умолчанию уже представлен служебным
            // пунктом "— По умолчанию —". Поэтому сам профиль, отмеченный
            // is_default, не показываем отдельно в списке.
            const defaultProfile = profiles.find(p => p.is_default === true);

            profiles.forEach(p => {
                if (p.is_default === true) return;

                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name;
                selectEl.appendChild(option);
            });

            // NULL/пустое значение означает использовать текущий глобальный
            // профиль по умолчанию. Если старое устройство явно ссылалось на
            // default-профиль, визуально переводим его в этот режим.
            const selectedId = selectedProfileId ? Number(selectedProfileId) : null;
            selectEl.value = defaultProfile && selectedId === Number(defaultProfile.id)
                ? ''
                : (selectedProfileId || '');
        })
        .catch(err => Logger.error('Ошибка загрузки профилей качества:', err));
}

/**
 * Открыть модальное окно устройства
 */
/**
 * Применить свежие status/quality_* из /api/device/<id>/details к ноде на
 * карте. Раньше эти поля из ответа details использовались ТОЛЬКО для
 * рендера самой карточки (loadDeviceQuality), а на cy-ноду не попадали —
 * из-за этого при открытии карточки можно было увидеть "зелёное" состояние
 * в карточке (данные из БД свежие), пока сама нода на карте оставалась
 * старого цвета, если конкретный socket-эмит device_status_batch был
 * пропущен клиентом (сетевое моргание без формального disconnect/reconnect
 * у Socket.IO — сервер не узнаёт, что клиент что-то не получил, и повторно
 * ничего не шлёт). Открытие карточки — дешёвый и надёжный момент, чтобы
 * заодно починить это расхождение для конкретной ноды.
 */
function syncNodeFromDetails(node, data) {
    if (!node || !node.length || !window.cy) return;

    const monitoringEnabled = !!data.monitoring_enabled;
    if (!monitoringEnabled) {
        if (typeof window.removePulsingNode === 'function') window.removePulsingNode(window.cy, node);
        node.data({
            status: 'up',
            quality_status: 'unknown',
            quality_latency_ms: null,
            quality_jitter_ms: null,
            quality_loss_percent: null,
        });
        window.cy.style().update();
        return;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'quality_status')) {
        node.data({
            quality_status: data.quality_status || 'unknown',
            quality_latency_ms: data.quality_latency_ms ?? null,
            quality_jitter_ms: data.quality_jitter_ms ?? null,
            quality_loss_percent: data.quality_loss_percent ?? null,
        });
    }

    if (data.status && node.data('status') !== data.status) {
        const oldStatus = node.data('status');
        node.data('status', data.status);
        if (typeof window.removePulsingNode === 'function') window.removePulsingNode(window.cy, node);
        if (data.status === 'down' && typeof window.addPulsingNode === 'function') {
            window.addPulsingNode(window.cy, node, 'down');
        } else if (data.status === 'partial' && typeof window.addPulsingNode === 'function') {
            window.addPulsingNode(window.cy, node, 'partial');
        }
        // Счётчик в сайдбаре считается дельтами (+1/-1 на переход), поэтому
        // пропущенный эмит роняет и его. Те же условия, что в обработчике
        // device_status_batch (map/index.js): down/partial считаются
        // проблемными, up — нет.
        if (typeof window.updateSidebarCounter === 'function' && window.currentMapId) {
            const becameDown = (data.status === 'down' || data.status === 'partial') && oldStatus === 'up';
            const becameUp = data.status === 'up' && (oldStatus === 'down' || oldStatus === 'partial');
            if (becameDown) window.updateSidebarCounter(window.currentMapId, true);
            if (becameUp) window.updateSidebarCounter(window.currentMapId, false);
        }
    }

    window.cy.style().update();
    if (typeof window.refreshAllCollapsedStatuses === 'function') window.refreshAllCollapsedStatuses();
}

export function openDeviceModal(node, options = {}) {
    const loadId = ++deviceModalLoadId;
    const isCurrentLoad = () => isCurrentDeviceModalLoad(loadId);
    const sourceDefaults = !node && options?.initialData && typeof options.initialData === 'object'
        ? options.initialData
        : null;
    // Keep creation prefill limited to fields supported by the existing form;
    // never accept source IDs, status/history, or source coordinates here.
    const createDefaults = sourceDefaults ? {
        name: typeof sourceDefaults.name === 'string' ? sourceDefaults.name : '',
        type_id: sourceDefaults.type_id ?? null,
        ips: Array.isArray(sourceDefaults.ips)
            ? sourceDefaults.ips.filter(ip => typeof ip === 'string').slice()
            : [],
        group_id: sourceDefaults.group_id ?? null,
        font_size: sourceDefaults.font_size ?? null,
        monitoring_enabled: sourceDefaults.monitoring_enabled === true
            || sourceDefaults.monitoring_enabled === 'true',
        quality_profile_id: sourceDefaults.quality_profile_id ?? null
    } : null;

    if (!node) {
        const position = options?.position;
        pendingCreatePosition = position && Number.isFinite(position.x) && Number.isFinite(position.y)
            ? { x: position.x, y: position.y }
            : null;
    }

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
    const qualityTabItem = document.querySelector('a[href="#device-quality"]')?.closest('.nav-item');
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
        if (qualityTabItem) qualityTabItem.style.display = 'block';

        fetch(`/api/device/${node.id()}/details`)
            .then(res => res.ok ? res.json() : Promise.reject(t('toast.errorTitle')))
            .then(data => {
                if (!isCurrentLoad()) return;
                loadDeviceTypes(devType, () => {
                    if (!isCurrentLoad()) return;
                    if (data.type_id) devType.value = data.type_id;
                }, isCurrentLoad);
                
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
                loadGroups(devGroup, data.group_id, isCurrentLoad);
                loadQualityProfiles(document.getElementById('dev_quality_profile'), data.quality_profile_id, isCurrentLoad);
                loadDeviceQuality(node.id(), 24, data, data.quality_history, isCurrentLoad);
                syncNodeFromDetails(node, data);
            })
            .catch(err => {
                if (!isCurrentLoad()) return;
                Logger.error('Ошибка загрузки деталей:', err);
                neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">' + t('common.loadError') + '</td></tr>';
                showToast(t('toast.errorTitle'), t('modal.device.loadFail'), 'error');
            });
    } else {
        devId.value = '';
        devName.value = createDefaults?.name ?? '';
        fontSizeInput.value = createDefaults?.font_size ?? '';
        if (devType) devType.value = '';
        deleteBtn.style.display = 'none';
        neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">' + t('modal.device.noData') + '</td></tr>';
        loadGroups(devGroup, createDefaults?.group_id, isCurrentLoad);
        loadQualityProfiles(document.getElementById('dev_quality_profile'), createDefaults?.quality_profile_id, isCurrentLoad);
        setIpsInForm(createDefaults?.ips ?? []);
        if (monitoringCheck && createDefaults) {
            monitoringCheck.checked = createDefaults.monitoring_enabled;
        }

        if (historyTabItem) historyTabItem.style.display = 'none';
        if (neighborsTabItem) neighborsTabItem.style.display = 'none';
        if (qualityTabItem) qualityTabItem.style.display = 'none';
        clearDeviceQuality();
        loadDeviceTypes(devType, () => {
            if (!isCurrentLoad()) return;
            if (createDefaults?.type_id) devType.value = String(createDefaults.type_id);
        }, isCurrentLoad);
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
    const qualityProfileId = document.getElementById('dev_quality_profile')?.value || '';
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
        monitoring_enabled: monitoring,
        quality_profile_id: qualityProfileId ? parseInt(qualityProfileId) : null
    };
    if (fontSize !== '') data.font_size = parseInt(fontSize, 10);
    else data.font_size = null;

    let revealSnapshot = null;
    if (!devId) {
        if (!window.currentMapId) {
            showToast(t('toast.errorTitle'), t('modal.device.noCurrentMap'), 'error');
            return;
        }
        data.map_id = window.currentMapId;
        if (pendingCreatePosition) {
            data.x = pendingCreatePosition.x;
            data.y = pendingCreatePosition.y;
        } else if (window.cy && typeof window.cy.pan === 'function') {
            const container = document.getElementById('cy');
            const pan = window.cy.pan();
            const zoom = window.cy.zoom();
            data.x = Math.round((-pan.x + container.clientWidth / 2) / zoom);
            data.y = Math.round((-pan.y + container.clientHeight / 2) / zoom);
            revealSnapshot = {
                pan: { x: pan.x, y: pan.y },
                zoom,
                interactionVersion: typeof window.getMapInteractionVersion === 'function'
                    ? window.getMapInteractionVersion()
                    : null
            };
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
            // Highlight only after the API succeeds and the returned ID exists in Cytoscape.
            if (window.cy?.getElementById(String(result.id)).length) {
                if (typeof window.highlightNewMapNode === 'function') window.highlightNewMapNode(result.id);
                // Toolbar-created nodes stay at the calculated center. Adjust the camera
                // only when the node is off-screen/near an edge and the user did not move it.
                if (revealSnapshot && typeof window.revealNewMapNode === 'function') {
                    window.revealNewMapNode(result.id, revealSnapshot);
                }
            }
            pendingCreatePosition = null;
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
        deviceModalLoadId += 1;
        // Closing without saving cancels the saved context-menu point.
        pendingCreatePosition = null;
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
