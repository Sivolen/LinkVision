// ============================================================================
// LinkVision - Карта сети (ФИНАЛЬНАЯ ВЕРСИЯ С ИСПРАВЛЕНИЯМИ)
// ============================================================================
let cy = null;
//let deviceModal = null;
let linkModal = null;
let linkMode = false;
let sourceNode = null;
let dragTimeout = null;
let currentMode = 'pan';
let bgImageWidth = null;
let bgImageHeight = null;
let viewportTimeout = null;
let pendingFit = false;
let elementsLoaded = false;
let backgroundLoaded = false;
let groupDragTimeout = null;
let copyTimer = null;

// ============================================================================
// СТИЛИ CYTOSCAPE (вынесены в константу)
// ============================================================================
const CY_STYLE = [
    {
        selector: 'node[iconUrl][iconUrl != ""]',
        style: {
            'shape': 'round-rectangle',
            'width': function(node) { return node.data('width') || 54; },
            'height': function(node) { return node.data('height') || 54; },
            'background-color': '#000000',
            'background-opacity': 0,
            'background-image': 'data(iconUrl)',
            'background-fit': 'contain',
            'background-clip': 'node',
            'border-width': 3,
            'border-color': '#28a745',
            'border-style': 'solid',
            'label': function(node) {
                return node.data('name') + '\n' + (node.data('ip') || '');
            },
            'text-valign': 'bottom',
            'text-margin-y': 8,
            'font-size': '11px',
            'font-weight': 'bold',
            'text-wrap': 'wrap',
            'text-max-width': '80px',
            'color': '#000000',
            'text-background-color': '#ffffff',
            'text-background-opacity': 1,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle'
        }
    },
    {
        selector: 'node[iconUrl][iconUrl != ""][status="true"]',
        style: {
            'border-color': '#28a745',
            'border-style': 'solid',
            'border-width': 3,
            'opacity': 1
        }
    },
    {
        selector: 'node[iconUrl][iconUrl != ""][status="false"]',
        style: {
            'border-color': '#dc3545',
            'border-style': 'dashed',
            'border-width': 3,
            'opacity': 0.85,
            'overlay-color': '#dc3545',
            'overlay-opacity': 0.15,
            'overlay-padding': '4px'
        }
    },
    {
        selector: 'node[!iconUrl][status="true"], node[iconUrl=""][status="true"]',
        style: {
            'shape': 'round-rectangle',
            'width': 60,
            'height': 60,
            'background-color': '#d4edda',
            'border-width': 3,
            'border-color': '#28a745',
            'border-style': 'solid',
            'label': function(node) {
                return node.data('name') + '\n' + (node.data('ip') || '');
            },
            'text-wrap': 'wrap',
            'text-max-width': '70px',
            'font-size': '10px',
            'font-weight': 'bold',
            'color': '#155724',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-background-color': '#ffffff',
            'text-background-opacity': 1,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle'
        }
    },
    {
        selector: 'node[!iconUrl][status="false"], node[iconUrl=""][status="false"]',
        style: {
            'shape': 'round-rectangle',
            'width': 60,
            'height': 60,
            'background-color': '#f8d7da',
            'border-width': 3,
            'border-color': '#dc3545',
            'border-style': 'dashed',
            'label': function(node) {
                return node.data('name') + '\n' + (node.data('ip') || '');
            },
            'text-wrap': 'wrap',
            'text-max-width': '70px',
            'font-size': '10px',
            'font-weight': 'bold',
            'color': '#721c24',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-background-color': '#ffffff',
            'text-background-opacity': 1,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle',
            'opacity': 0.9,
            'overlay-color': '#dc3545',
            'overlay-opacity': 0.15,
            'overlay-padding': '4px'
        }
    },
    {
        selector: 'node:selected',
        style: {
            'border-color': '#007bff',
            'border-width': 5,
            'background-color': 'rgba(0,123,255,0.1)',
            'transition-property': 'border-width, background-color',
            'transition-duration': '0.2s'
        }
    },
    {
        selector: '.cy-node-highlight',
        style: {
            'border-color': '#007bff',
            'border-width': 4,
            'border-style': 'solid',
            'overlay-color': '#007bff',
            'overlay-opacity': 0.4,
            'overlay-padding': '6px',
            'z-index': 10
        }
    },
    {
        selector: 'node[isGroup]',
        style: {
            'shape': 'rectangle',
            'background-color': 'data(color)',
            'background-opacity': 0.1,
            'border-color': 'data(color)',
            'border-width': 1,
            'border-opacity': 0.3,
            'border-style': 'dashed',
            'label': 'data(name)',
            'font-size': '11px',
            'font-weight': 'bold',
            // 'color': '#000000',
            'text-valign': 'top',
            'text-halign': 'center',
            'padding': '5px',
            'compound-sizing-wrt-labels': 'include',
            'min-zoomed-font-size': 8,
            'min-width': 30,
            'min-height': 30
        }
    },
    {
        selector: 'node[isGroup]:selected',
        style: {
            'border-color': '#007bff',
            'border-width': 4
        }
    },
    {
        selector: 'edge',
        style: {
            'width': function(edge) { return edge.data('width') || 2; },
            'line-color': function(edge) { return edge.data('color') || '#6c757d'; },
            'line-style': function(edge) { return edge.data('style') || 'solid'; },
            'curve-style': 'bezier',
            'label': 'data(label)',
            'font-size': '8px',
            'text-rotation': 'autorotate',
            'text-margin-y': -8,
            'text-background-color': '#fff',
            'text-background-opacity': 0.8,
            'text-background-padding': '2px'
        }
    },
    {
        selector: 'edge:selected',
        style: {
            'width': 4,
            'line-color': '#007bff',
            'text-background-color': '#e7f3ff'
        }
    },
    {
        selector: 'node[monitoring_enabled="false"]',
        style: {
            'border-color': '#6c757d',
            'border-style': 'dotted',
            'border-width': 3,
            'opacity': 0.7
        }
    }
];

function updateGroupLabelColor() {
    if (!cy) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#ffffff' : '#000000';
    cy.style()
        .selector('node[isGroup]')
        .style('color', textColor)
        .update();
}

// Глобальный сокет (объявлен как window.socket)
// window.socket = null;

// ============================================================================
// УНИВЕРСАЛЬНАЯ ФУНКЦИЯ ДЛЯ FETCH С ПОВТОРНЫМИ ПОПЫТКАМИ
// ============================================================================
async function fetchWithRetry(url, options = {}, retries = 3, delay = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            return response;
        } catch (error) {
            const isLastAttempt = i === retries - 1;
            if (isLastAttempt) throw error;
            Logger.warn(`⚠️ fetch failed (attempt ${i+1}/${retries}), retrying in ${delay}ms...`, error);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
}

// ============================================================================
// ПУЛЬСАЦИЯ КРАСНЫХ УЗЛОВ
// ============================================================================
let pulsingNodes = new Set();
let pulsingInterval = null;
let pulsePhase = 0;
const pulseStep = 0.015;
const pulseMinOpacity = 0.15;
const pulseMaxOpacity = 0.4;

function addPulsingNode(node) {
    const nodeId = node.id();
    if (!pulsingNodes.has(nodeId)) {
        pulsingNodes.add(nodeId);
        if (!pulsingInterval) {
            pulsePhase = 0;
            pulsingInterval = setInterval(() => {
                pulsePhase += pulseStep;
                if (pulsePhase > 1) pulsePhase -= 2;
                const opacity = pulseMinOpacity + (pulseMaxOpacity - pulseMinOpacity) * (0.5 + 0.5 * Math.sin(pulsePhase * Math.PI));
                pulsingNodes.forEach(id => {
                    const n = cy.getElementById(id);
                    if (n.length) n.style('overlay-opacity', opacity);
                });
            }, 50);
        }
    }
}

function removePulsingNode(node) {
    const nodeId = node.id();
    if (pulsingNodes.has(nodeId)) {
        pulsingNodes.delete(nodeId);
        node.style('overlay-opacity', null);
        if (pulsingNodes.size === 0 && pulsingInterval) {
            clearInterval(pulsingInterval);
            pulsingInterval = null;
        }
    }
}

// ============================================================================
// ОБНОВЛЕНИЕ СЧЁТЧИКА DOWN В САЙДБАРЕ
// ============================================================================
function updateSidebarCounter(mapId, becameDown) {
    const mapLink = document.querySelector(`.map-item[href="/map/${mapId}"]`);
    if (!mapLink) return;
    const rightDiv = mapLink.querySelector('.map-item-right');
    if (!rightDiv) return;
    let badge = rightDiv.querySelector('.badge');
    let currentCount = badge ? parseInt(badge.textContent) : 0;
    if (becameDown) currentCount++; else currentCount--;
    if (currentCount <= 0) {
        if (badge) badge.remove();
    } else {
        if (badge) {
            badge.textContent = currentCount;
        } else {
            badge = document.createElement('span');
            badge.className = 'badge bg-danger ms-2';
            badge.textContent = currentCount;
            const actionsDiv = rightDiv.querySelector('.map-item-actions');
            if (actionsDiv) {
                actionsDiv.insertAdjacentElement('afterend', badge);
            } else {
                rightDiv.appendChild(badge);
            }
        }
    }
}

function getMapId() { return window.currentMapId; }

function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

function enforcePanBounds() {
    if (!cy || !bgImageWidth || !bgImageHeight) return;
    const zoom = cy.zoom();
    const containerWidth = cy.width();
    const containerHeight = cy.height();
    const scaledImgWidth = bgImageWidth * zoom;
    const scaledImgHeight = bgImageHeight * zoom;
    let minPanX, maxPanX, minPanY, maxPanY;
    if (scaledImgWidth > containerWidth) {
        minPanX = containerWidth - scaledImgWidth;
        maxPanX = 0;
    } else {
        minPanX = (containerWidth - scaledImgWidth) / 2;
        maxPanX = (containerWidth - scaledImgWidth) / 2;
    }
    if (scaledImgHeight > containerHeight) {
        minPanY = containerHeight - scaledImgHeight;
        maxPanY = 0;
    } else {
        minPanY = (containerHeight - scaledImgHeight) / 2;
        maxPanY = (containerHeight - scaledImgHeight) / 2;
    }
    const currentPan = cy.pan();
    const newPanX = clamp(currentPan.x, minPanX, maxPanX);
    const newPanY = clamp(currentPan.y, minPanY, maxPanY);
    if (Math.abs(newPanX - currentPan.x) > 0.5 || Math.abs(newPanY - currentPan.y) > 0.5) {
        cy.pan({ x: newPanX, y: newPanY });
    }
}

function boundNodePosition(pos) {
    if (!bgImageWidth || !bgImageHeight) return pos;
    const margin = 30;
    return {
        x: clamp(pos.x, margin, bgImageWidth - margin),
        y: clamp(pos.y, margin, bgImageHeight - margin)
    };
}

function fitImageToView() {
    if (!cy || !bgImageWidth || !bgImageHeight) return;
    const container = document.getElementById('cy').getBoundingClientRect();
    const containerW = container.width;
    const containerH = container.height;
    const zoom = Math.min(containerW / bgImageWidth, containerH / bgImageHeight) * 0.95;
    const panX = (containerW / zoom - bgImageWidth) / 2;
    const panY = (containerH / zoom - bgImageHeight) / 2;
    cy.viewport({ pan: { x: panX, y: panY }, zoom: zoom });
    updateBackgroundTransform();
    enforcePanBounds();
    Logger.debug('📐 Изображение подогнано:', zoom.toFixed(2), 'pan:', panX.toFixed(0), panY.toFixed(0));
}

function checkReadyAndFit() {
    //console.log('checkReadyAndFit called', {backgroundLoaded, elementsLoaded, pendingFit});
    if (backgroundLoaded && elementsLoaded && !pendingFit) {
        const cyEl = document.getElementById('cy');
        const panX = parseFloat(cyEl.dataset.panX) || 0;
        const panY = parseFloat(cyEl.dataset.panY) || 0;
        const zoom = parseFloat(cyEl.dataset.zoom) || 1;
        //console.log('data attributes:', {panX, panY, zoom});
        if (panX !== 0 || panY !== 0 || zoom !== 1) {
            cy.viewport({ pan: { x: panX, y: panY }, zoom: zoom });
            Logger.debug('🖼️ Viewport восстановлен из БД');
        } else {
            fitImageToView();
        }
        updateBackgroundTransform();
        enforcePanBounds();
    }
}

function initMap(mapId) {
    Logger.info('🗺️ Инициализация карты:', mapId);

    // Проверка: если mapId не число (например, null) – создаём пустую карту (режим новой карты)
    if (!mapId || isNaN(parseInt(mapId))) {
        Logger.warn('initMap: mapId невалиден, создаётся пустая карта');
        cy = cytoscape({
            container: document.getElementById('cy'),
            elements: [],
            style: CY_STYLE,
            layout: { name: 'preset' },
            boxSelectionEnabled: false,
            autounselectify: true,
            minZoom: 0.1,
            maxZoom: 5,
            wheelSensitivity: 0.5,
            fit: false
        });
        backgroundLoaded = true;
        elementsLoaded = true;
        return;
    }

    // Подключение к Socket.IO
    if (window.socket) {
        if (window.socket.connected) {
            window.socket.emit('join_room', `map_${mapId}`);
        } else {
            const onConnect = () => {
                window.socket.emit('join_room', `map_${mapId}`);
                window.socket.off('connect', onConnect);
            };
            window.socket.on('connect', onConnect);
        }
    } else {
        Logger.error('❌ Глобальный сокет не инициализирован');
    }

    // Обработчик обновления статуса устройства
    window.socket.on('device_status', (data) => {
        Logger.debug('📡 [RAW] device_status получен:', data);
        if (Number(data.map_id) !== Number(mapId)) return;
        if (!cy) return;
        const node = cy.getElementById(String(data.id));
        if (!node.length) {
            Logger.warn(`⚠️ Узел с id ${data.id} не найден на карте`);
            return;
        }
        try {
            const statusValue = data.status === 'true' ? 'true' : 'false';
            const oldStatus = node.data('status');
            if (oldStatus === statusValue) return;
            node.data('status', statusValue);
            if (statusValue === 'false') {
                addPulsingNode(node);
            } else {
                removePulsingNode(node);
            }
            cy.style().update();
            const becameDown = (statusValue === 'false');
            updateSidebarCounter(data.map_id, becameDown);
        } catch (e) {
            Logger.error('❌ Ошибка в обработчике device_status:', e);
        }
    });

    // Инициализация Cytoscape
    cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [],
        style: CY_STYLE,
        layout: { name: 'preset' },
        boxSelectionEnabled: false,
        autounselectify: true,
        minZoom: 0.1,
        maxZoom: 5,
        wheelSensitivity: 0.5,
        fit: false
    });

    // Обновление фона и сохранение viewport при перемещении/масштабировании
    cy.on('pan zoom', () => {
        updateBackgroundTransform();
        enforcePanBounds();
        saveViewportToServer();
    });

    // Обновление кнопки массового редактирования при изменении выделения
    cy.on('select unselect', updateBulkEditButton);

    // Инициализация модальных окон Need remove
    // const deviceModalEl = document.getElementById('deviceModal');
    // if (deviceModalEl && !deviceModal) {
    //    deviceModal = new bootstrap.Modal(deviceModalEl);
    // }
    const linkModalEl = document.getElementById('linkModal');
    if (linkModalEl && !linkModal) {
        linkModal = new bootstrap.Modal(linkModalEl);
        ['link_src_iface', 'link_tgt_iface'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', updateLinkPreview);
        });
    }

    // Обновление состояния кнопки блокировки
    updateLockButton();

    updateGroupLabelColor();

    // Загрузка фона
    const bgEl = document.getElementById('cy-background');
    if (bgEl && bgEl.dataset.background) {
        loadBackground(bgEl.dataset.background);
    } else {
        backgroundLoaded = true;
        checkReadyAndFit();
    }

    // Загрузка элементов карты и типов устройств
    loadElements(mapId);
    // loadDeviceTypes(); need remove

    // Обработчик изменения размера окна
    window.addEventListener('resize', () => {
        if (cy) {
            cy.resize();
            updateBackgroundTransform();
            enforcePanBounds();
        }
    });

    // ==================== ОБРАБОТЧИКИ ПЕРЕТАСКИВАНИЯ ====================

    // Завершение перетаскивания одиночного узла
    cy.on('dragfree', 'node', function(evt) {
        const node = evt.target;
        // Пропускаем группы (группы не должны перемещаться отдельно)
        if (node.data('isGroup')) return;

        // Запрет для оператора и при активной блокировке
        if (window.isOperator) return;
        if (dragLocked) return;

        let pos = node.position();
        // Если фон загружен, ограничиваем позицию (чтобы не уходить за границы)
        if (bgImageWidth && bgImageHeight) {
            const boundedPos = boundNodePosition(pos);
            if (boundedPos.x !== pos.x || boundedPos.y !== pos.y) {
                node.position(boundedPos);
                pos = boundedPos;
            }
        }

        clearTimeout(dragTimeout);
        dragTimeout = setTimeout(() => {
            fetch(`/api/device/${node.id()}/position`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) })
            }).catch(err => Logger.error('Ошибка при сохранении позиции:', err));
        }, 500);
    });

    // Начало перетаскивания (запоминаем стартовую позицию)
    cy.on('drag', 'node', function(evt) {
        const node = evt.target;
        // Группы можно перетаскивать, но не запоминаем для них стартовую позицию (она не используется)
        if (node.data('isGroup')) {
            // Разрешаем перетаскивание, выходим без запоминания
            return;
        }
        if (window.isOperator) {
            evt.preventDefault();
            return;
        }
        if (dragLocked) {
            evt.preventDefault();
            return;
        }
        evt.target._private.scratch._dragStartPos = evt.target.position();
    });

    // Завершение перетаскивания группы выбранных узлов
    cy.on('dragfree', 'node:selected', function(evt) {
        if (window.isOperator) return;
        if (dragLocked) return;

        const selectedNodes = cy.nodes(':selected').filter(node => !node.data('isGroup'));
        if (selectedNodes.length <= 1) return;

        const draggedNode = evt.target;
        // Если перетащили группу – игнорируем (группы не участвуют в групповом выделении)
        if (draggedNode.data('isGroup')) return;

        const oldPos = draggedNode._private.scratch._dragStartPos || draggedNode.position();
        const newPos = draggedNode.position();
        const deltaX = newPos.x - oldPos.x;
        const deltaY = newPos.y - oldPos.y;

        clearTimeout(dragTimeout);
        dragTimeout = setTimeout(() => {
            selectedNodes.forEach(node => {
                if (node.id() !== draggedNode.id()) {
                    const nodePos = node.position();
                    let newX = nodePos.x + deltaX;
                    let newY = nodePos.y + deltaY;
                    // Если есть фон, ограничиваем
                    if (bgImageWidth && bgImageHeight) {
                        const bounded = boundNodePosition({ x: newX, y: newY });
                        newX = bounded.x;
                        newY = bounded.y;
                    }
                    node.position({ x: newX, y: newY });
                    // Сохраняем позицию
                    fetch(`/api/device/${node.id()}/position`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ x: Math.round(newX), y: Math.round(newY) })
                    }).catch(err => Logger.error('Ошибка при сохранении позиции:', err));
                }
            });
        }, 500);
    });

    // Обработчик перетаскивания группы
// Обработчик перетаскивания группы
cy.on('dragfree', 'node[isGroup]', function(evt) {
    const groupNode = evt.target;
    if (window.isOperator) return;
    if (dragLocked) return;

    const children = groupNode.children().filter(child => !child.data('isGroup'));
    if (children.length === 0) return;

    clearTimeout(groupDragTimeout);
    groupDragTimeout = setTimeout(() => {
        children.forEach(child => {
            let pos = child.position();
            if (bgImageWidth && bgImageHeight) {
                const bounded = boundNodePosition(pos);
                if (bounded.x !== pos.x || bounded.y !== pos.y) {
                    child.position(bounded);
                    pos = bounded;
                }
            }
            fetch(`/api/device/${child.id()}/position`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) })
            }).catch(err => Logger.error('Ошибка сохранения позиции устройства:', err));
        });
    }, 500);
});
    // ==================== ОБРАБОТЧИКИ КЛИКОВ ====================

    cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        if (linkMode) {
            evt.stopPropagation();
            if (!sourceNode) {
                sourceNode = node;
                sourceNode.style('border-color', '#007bff');
                sourceNode.style('border-width', 5);
                const linkInfo = document.getElementById('linkInfo');
                if (linkInfo) linkInfo.textContent = `✅ Источник: ${node.data('name')}\n Выберите второе устройство`;
            } else if (sourceNode.id() !== node.id()) {
                openLinkModal(sourceNode.id(), node.id());
            }
            return;
        }

        // Копирование IP при одиночном клике (с задержкой)
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
            const ip = node.data('ip');
            if (ip && ip.trim()) {
                navigator.clipboard.writeText(ip).then(() => {
                    showToast('Скопировано', `IP ${ip} скопирован в буфер обмена`, 'info');
                }).catch(err => {
                    Logger.error('Ошибка копирования:', err);
                });
            }
            copyTimer = null;
        }, 200);

        // Выделение узла (если не в режиме выделения, снимаем выделение с других)
        if (currentMode !== 'select') cy.nodes().selected(false);
        node.selected(true);
    });

    cy.on('dbltap', 'node', function(evt) {
        // Отменяем копирование при двойном клике
        if (copyTimer) {
            clearTimeout(copyTimer);
            copyTimer = null;
        }
        const node = evt.target;
        if (node.data('isGroup')) return;
        openDeviceModal(node);
    });

    cy.on('tap', 'edge', function(evt) {
        if (currentMode !== 'select') cy.edges().selected(false);
        evt.target.selected(true);
    });

    cy.on('dbltap', 'edge', function(evt) {
        openLinkModalForEdit(evt.target);
    });

    cy.on('tap', function(event) {
        if (event.target === cy && linkMode) resetLinkMode();
        if (event.target === cy) cy.elements().deselect();
    });

    // Устанавливаем начальный режим
    setMode('pan');
}

function applyLinkTypePreset(type) {
    const presets = {
        '100m':  { color: '#d1d5db', width: 2, style: 'solid' },   // очень светлый серый
        '1G':    { color: '#3b82f6', width: 3, style: 'solid' },   // синий
        '10G':   { color: '#2563eb', width: 4, style: 'solid' },   // тёмно-синий
        '25G':   { color: '#4f46e5', width: 5, style: 'solid' },   // индиго
        '100G':  { color: '#6b7280', width: 6, style: 'solid' },   // серый (бывший 100m)
        '400G':  { color: '#8b5cf6', width: 8, style: 'solid' },   // мягкий фиолетовый
        'vlan':  { color: '#94a3b8', width: 2, style: 'dashed' },  // серо-голубой пунктир
        'radio': { color: '#84cc16', width: 2, style: 'dotted' }   // оливково-зелёный (можно заменить)
    };
    if (type && presets[type]) {
        document.getElementById('link_line_color').value = presets[type].color;
        document.getElementById('link_line_width').value = presets[type].width;
        document.getElementById('link_line_style').value = presets[type].style;
    }
}

function loadBackground(bgUrl) {
    if (!bgUrl) {
        backgroundLoaded = true;
        checkReadyAndFit();
        return;
    }
    const img = new Image();
    img.onload = () => {
        bgImageWidth = img.naturalWidth;
        bgImageHeight = img.naturalHeight;
        const bgEl = document.getElementById('cy-background');
        if (bgEl) {
            bgEl.style.backgroundImage = `url(/static/uploads/maps/${bgUrl})`;
            bgEl.style.backgroundSize = `${bgImageWidth}px ${bgImageHeight}px`;
            bgEl.style.width = `${bgImageWidth}px`;
            bgEl.style.height = `${bgImageHeight}px`;
            bgEl.classList.add('has-image');
        }
        backgroundLoaded = true;
        Logger.debug('🖼️ Фон загружен:', bgImageWidth, 'x', bgImageHeight);
        checkReadyAndFit();
    };
    img.onerror = () => {
        Logger.error('❌ Не удалось загрузить фон');
        backgroundLoaded = true;
        checkReadyAndFit();
    };
    img.src = `/static/uploads/maps/${bgUrl}`;
}

function updateBackgroundTransform() {
    if (!cy) return;
    const bgEl = document.getElementById('cy-background');
    if (!bgEl) return;
    if (!bgImageWidth || !bgImageHeight) {
        bgEl.style.transform = 'none';
        return;
    }
    const pan = cy.pan();
    const zoom = cy.zoom();
    const x = pan.x;
    const y = pan.y;
    bgEl.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    bgEl.style.transformOrigin = '0 0';
}

function loadElements(mapId) {
    fetchWithRetry(`/api/map/${mapId}/elements`)
    .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    })
    .then(data => {
        if (!cy) return;

        // Группы
        const groupNodes = [];
        const groupMap = {};
        if (data.groups) {
            data.groups.forEach(g => {
                const groupNode = {
                    group: 'nodes',
                    data: {
                        id: `group_${g.id}`,
                        name: g.name,
                        color: g.color,
                        isGroup: true,
                        group_id: g.id
                    }
                };
                groupNodes.push(groupNode);
                groupMap[g.id] = `group_${g.id}`;
            });
        }

        // Узлы устройств — работаем с исходными объектами, только приводим id к строке
        const validNodes = data.nodes.filter(n => n.data && n.data.id);
        validNodes.forEach(n => {
            n.data.id = String(n.data.id);                 // обязательно строка
            if (n.data.group_id && groupMap[n.data.group_id]) {
                n.data.parent = groupMap[n.data.group_id];
            } else {
                delete n.data.parent;                        // удалить parent, если группы нет
            }
            // Корректировка позиции (если есть фон)
            if (bgImageWidth && bgImageHeight) {
                if (n.data.x !== undefined && n.data.y !== undefined) {
                    const bounded = boundNodePosition({ x: n.data.x, y: n.data.y });
                    n.data.x = bounded.x;
                    n.data.y = bounded.y;
                }
            }
        });

        // Рёбра — приводим source/target к строке и добавляем префикс к ID
        const validEdges = data.edges.filter(e =>
            e.data && e.data.source && e.data.target &&
            e.data.source !== 'None' && e.data.target !== 'None'
        );
        validEdges.forEach(e => {
            e.data.source = String(e.data.source);
            e.data.target = String(e.data.target);
            if (e.data.id) {
                e.data.id = `link_${String(e.data.id)}`;   // ← добавляем префикс
            }
        });

        // Добавляем в граф
        cy.add(groupNodes);
        cy.add(validNodes);      // теперь это массив исходных объектов с изменёнными data
        cy.add(validEdges);

        elementsLoaded = true;
        Logger.info('✅ Элементы загружены:', validNodes.length, 'узлов,', validEdges.length, 'связей');
        checkReadyAndFit();

        // Пульсация для недоступных узлов
        cy.nodes().forEach(node => {
            if (node.data('status') === 'false') {
                addPulsingNode(node);
            }
        });

        // Предзагрузка иконок
        validNodes.forEach(n => {
            if (n.data.iconUrl && n.data.iconUrl !== '') {
                const img = new Image();
                img.src = n.data.iconUrl;
            }
        });

        // Отладка
        validEdges.forEach(e => {
            if (!cy.getElementById(e.data.source).length || !cy.getElementById(e.data.target).length) {
                console.warn('⚠️ Ребро', e.data.id, 'ссылается на отсутствующий узел!', e.data.source, '→', e.data.target);
            }
        });
    })
    .catch(err => {
        Logger.error('❌ Ошибка загрузки элементов:', err);
        elementsLoaded = true;
        checkReadyAndFit();
    });
}

function saveDevicePosition(node) {
    if (window.isOperator) return;
    if (dragLocked) return;
    if (node.data('isGroup')) return; // группы не сохраняем

    let pos = node.position();
    // Если есть фон, ограничиваем позицию
    if (bgImageWidth && bgImageHeight) {
        const bounded = boundNodePosition(pos);
        if (bounded.x !== pos.x || bounded.y !== pos.y) {
            node.position(bounded);
            pos = bounded;
        }
    }

    clearTimeout(dragTimeout);
    dragTimeout = setTimeout(() => {
        fetch(`/api/device/${node.id()}/position`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) })
        }).catch(err => Logger.error('Ошибка при сохранении позиции:', err));
    }, 500);
}



function saveViewportToServer() {
    // Оператор не сохраняет viewport – все изменения временные
    // if (window.isOperator) return;

    if (!cy) return;
    const pan = cy.pan();
    const zoom = cy.zoom();
    clearTimeout(viewportTimeout);
    viewportTimeout = setTimeout(() => {
        fetch(`/api/map/${getMapId()}/viewport`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pan_x: pan.x, pan_y: pan.y, zoom: zoom })
        }).catch(err => Logger.error('Ошибка сохранения viewport:', err));
    }, 500);
}

function updateMapBackground(background) {
    const bgEl = document.getElementById('cy-background');
    if (!bgEl) return;
    if (background) {
        bgEl.dataset.background = background;
        backgroundLoaded = false;
        loadBackground(background);
    } else {
        bgImageWidth = bgImageHeight = null;
        bgEl.classList.remove('has-image');
        bgEl.style.backgroundImage = 'none';
        bgEl.style.transform = 'none';
        backgroundLoaded = true;
        checkReadyAndFit();
    }
}

function updateLinkPreview() {
    const src = document.getElementById('link_src_iface')?.value || 'eth0';
    const tgt = document.getElementById('link_tgt_iface')?.value || 'eth0';
    const preview = document.getElementById('link_preview');
    if (preview) preview.textContent = `${src} ↔ ${tgt}`;
}

function openLinkModal(sourceId, targetId) {
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
    updateLinkPreview();

    // ========== БЛОКИРОВКА ДЛЯ ОПЕРАТОРА ==========
    if (window.isOperator) {
        document.querySelectorAll('#linkModal input, #linkModal select').forEach(el => el.disabled = true);
        const saveBtn = document.querySelector('#linkModal .btn-primary');
        const deleteBtn = document.querySelector('#linkModal .btn-danger');
        if (saveBtn) saveBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }
    // =============================================

    if (linkModal) linkModal.show();
}

function openLinkModalForEdit(edge) {
    const data = edge.data();
    document.getElementById('link_id').value = data.id;
    document.getElementById('link_source').value = data.source;
    document.getElementById('link_target').value = data.target;
    const labelParts = (data.label || 'eth0↔eth0').split('↔');
    document.getElementById('link_src_iface').value = labelParts[0] || 'eth0';
    document.getElementById('link_tgt_iface').value = labelParts[1] || 'eth0';
    document.getElementById('link_type').value = data.link_type || '';
    document.getElementById('link_line_color').value = data.color || '#6c757d';
    document.getElementById('link_line_width').value = data.width || 2;
    document.getElementById('link_line_style').value = data.style || 'solid';
    document.getElementById('linkModalTitle').textContent = 'Редактировать связь';
    document.getElementById('linkDeleteBtn').style.display = 'inline-block';
    document.getElementById('linkDeleteBtn').onclick = () => deleteLink(data.id);
    updateLinkPreview();

    // ========== БЛОКИРОВКА ДЛЯ ОПЕРАТОРА ==========
    if (window.isOperator) {
        document.querySelectorAll('#linkModal input, #linkModal select').forEach(el => el.disabled = true);
        const saveBtn = document.querySelector('#linkModal .btn-primary');
        const deleteBtn = document.querySelector('#linkModal .btn-danger');
        if (saveBtn) saveBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }
    // =============================================

    if (linkModal) linkModal.show();
}

function confirmCreateLink() {
    const linkId = document.getElementById('link_id').value;
    const src = document.getElementById('link_source')?.value;
    const tgt = document.getElementById('link_target')?.value;
    const srcIface = document.getElementById('link_src_iface')?.value || 'eth0';
    const tgtIface = document.getElementById('link_tgt_iface')?.value || 'eth0';
    const linkType = document.getElementById('link_type')?.value;
    const lineColor = document.getElementById('link_line_color')?.value;
    const lineWidth = parseInt(document.getElementById('link_line_width')?.value) || 2;
    const lineStyle = document.getElementById('link_line_style')?.value;

    if (!src || !tgt) { alert('⚠️ Ошибка: не выбраны устройства'); return; }
    if (linkModal) linkModal.hide();
    if (linkId) {
        updateLink(linkId, srcIface, tgtIface, linkType, lineColor, lineWidth, lineStyle);
    } else {
        createLinkWithInterfaces(src, tgt, srcIface, tgtIface, linkType, lineColor, lineWidth, lineStyle);
    }
}

function createLinkWithInterfaces(src, tgt, srcIface, tgtIface, linkType, lineColor, lineWidth, lineStyle) {
    const sourceId = typeof src === 'number' ? src : parseInt(src);
    const targetId = typeof tgt === 'number' ? tgt : parseInt(tgt);
    if (isNaN(sourceId) || isNaN(targetId)) { alert('⚠️ Ошибка: неверные ID'); return; }

    fetch('/api/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            map_id: getMapId(),
            source_id: sourceId,
            target_id: targetId,
            src_iface: srcIface,
            tgt_iface: tgtIface,
            link_type: linkType || null,
            line_color: lineColor,
            line_width: lineWidth,
            line_style: lineStyle
        })
    })
    .then(res => res.ok ? res.json() : Promise.reject())
    .then(data => {
        if (data.id && cy) {
            cy.add({
                group: 'edges',
                data: {
                    id: `link_${data.id}`,
                    source: String(sourceId),      // обязательно строка!
                    target: String(targetId),      // обязательно строка!
                    label: `${srcIface}↔${tgtIface}`,
                    link_type: linkType,
                    color: lineColor,
                    width: lineWidth,
                    style: lineStyle
                }
            });
            resetLinkMode();
        }
    })
    .catch(err => {
        Logger.error('Ошибка создания связи:', err);
        alert('❌ Ошибка: ' + err.message);
    });
}

function updateLink(linkId, srcIface, tgtIface, linkType, lineColor, lineWidth, lineStyle) {
    const numericId = linkId.replace('link_', '');
    fetch(`/api/link/${numericId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            source_interface: srcIface,
            target_interface: tgtIface,
            link_type: linkType || null,
            line_color: lineColor,
            line_width: lineWidth,
            line_style: lineStyle
        })
    })
    .then(res => {
        if (!res.ok) throw new Error('Ошибка обновления');
        // Обновляем данные ребра в графе
        const edge = cy.getElementById(linkId);
        if (edge.length) {
            edge.data({
                label: `${srcIface}↔${tgtIface}`,
                link_type: linkType,
                color: lineColor,
                width: lineWidth,
                style: lineStyle
            });
            cy.style().update(); // переприменяем стили
        }
        if (typeof window.showToast === 'function') {
            window.showToast('Успешно', 'Связь обновлена', 'success');
        }
    })
    .catch(err => {
        Logger.error('Ошибка обновления связи:', err);
        alert('❌ Ошибка сети при обновлении');
    });
}

function deleteLink(linkId) {
    if (!confirm('⚠️ Удалить эту связь?')) return;
    const numericId = String(linkId).replace('link_', '');
    fetch(`/api/link/${numericId}`, { method: 'DELETE' })
    .then(res => {
        if (!res.ok) throw new Error('Ошибка удаления');
        // Удаляем ребро из графа
        removeLinkFromGraph(linkId);
        // Закрываем модальное окно
        if (linkModal) linkModal.hide();
    })
    .catch(err => {
        Logger.error('Ошибка удаления связи:', err);
        alert('❌ Ошибка сети при удалении');
    });
}

function resetLinkMode() {
    linkMode = false;
    if (sourceNode && cy) sourceNode.style({});
    sourceNode = null;
    document.body.style.cursor = 'default';
    const inf = document.getElementById('linkInfo');
    if (inf) inf.remove();
}

function startLinkMode() {
    // ========== ПРОВЕРКА ДЛЯ ОПЕРАТОРА ==========
    if (window.isOperator) {
        alert('Оператор не может создавать связи');
        return;
    }
    // =============================================

    if (!cy) { alert('⚠️ Карта не загружена'); return; }
    resetLinkMode();
    linkMode = true;
    sourceNode = null;
    document.body.style.cursor = 'crosshair';
    const oldInfo = document.getElementById('linkInfo');
    if (oldInfo) oldInfo.remove();
    const info = document.createElement('div');
    info.id = 'linkInfo';
    info.className = 'alert alert-info position-fixed';
    info.style.cssText = 'top:80px;left:50%;transform:translateX(-50%);z-index:1000;';
    info.textContent = 'Выберите ПЕРВОЕ устройство';
    document.body.appendChild(info);
}

function setMode(mode) {
    currentMode = mode;
    const panBtn = document.getElementById('panMode');
    const selectBtn = document.getElementById('selectMode');
    if (panBtn) panBtn.classList.toggle('active', mode === 'pan');
    if (selectBtn) selectBtn.classList.toggle('active', mode === 'select');
    if (cy) {
        if (mode === 'select') {
            cy.boxSelectionEnabled(true);
            cy.autounselectify(false);
            cy.panningEnabled(false);
            cy.userPanningEnabled(false);
            document.body.style.cursor = 'crosshair';
        } else {
            cy.boxSelectionEnabled(false);
            cy.autounselectify(true);
            cy.panningEnabled(true);
            cy.userPanningEnabled(true);
            document.body.style.cursor = 'default';
        }
        cy.style().update();
    }
}

function zoomIn() {
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * 1.2, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
}

function zoomOut() {
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * 0.8, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
}

function resetZoom() {
    if (!cy) return;
    if (bgImageWidth && bgImageHeight) {
        fitImageToView();
    } else {
        cy.fit(null, 50);
    }
}
// Открытие истории изменений устройства
function openDeviceHistory(deviceId) {
    if (!deviceId) return;
    fetch(`/api/device/${deviceId}/history`)
        .then(res => {
            if (!res.ok) throw new Error('Ошибка загрузки истории');
            return res.json();
        })
        .then(history => {
            const tbody = document.getElementById('device-history-body');
            tbody.innerHTML = '';
            if (history.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Нет записей</td></tr>';
            } else {
                history.forEach(entry => {
                    const row = tbody.insertRow();
                    row.insertCell().textContent = new Date(entry.timestamp).toLocaleString();
                    row.insertCell().innerHTML = entry.old_status === 'true' ? '<span class="badge bg-success">UP</span>' : '<span class="badge bg-danger">DOWN</span>';
                    row.insertCell().innerHTML = entry.new_status === 'true' ? '<span class="badge bg-success">UP</span>' : '<span class="badge bg-danger">DOWN</span>';
                });
            }
            const modal = new bootstrap.Modal(document.getElementById('deviceHistoryModal'));
            modal.show();
        })
        .catch(err => {
            Logger.error('Ошибка загрузки истории:', err);
            alert('Не удалось загрузить историю');
        });
}
// ============================================================================
// ПОИСК И ФИЛЬТРАЦИЯ
// ============================================================================
let currentFilterStatus = 'all'; // 'all', 'true', 'false'
let searchTimeout;

// Фильтрация по статусу
window.filterByStatus = function(status) {
    Logger.debug('Фильтр по статусу:', status);
    currentFilterStatus = status;
    applyFilterAndSearch();
};

// Применить фильтр и поиск
function applyFilterAndSearch() {
    Logger.debug('applyFilterAndSearch вызван');
    if (!cy) {
        Logger.debug('cy не инициализирован');
        return;
    }

    const searchInput = document.getElementById('searchInput');
    if (!searchInput) {
        Logger.debug('searchInput не найден');
        return;
    }

    const searchTerm = searchInput.value.toLowerCase().trim();
    Logger.debug('Поисковый запрос:', searchTerm);

    // Сбрасываем подсветку
    cy.nodes().removeClass('cy-node-highlight');

    // Применяем фильтр по статусу
    let visibleCount = 0;
    cy.nodes().forEach(node => {
        if (node.data('isGroup')) {
            node.show(); // группы всегда видимы
            return;
        }
        const nodeStatus = node.data('status');
        const shouldShow = (currentFilterStatus === 'all' || nodeStatus === currentFilterStatus);
        if (shouldShow) {
            node.show();
            visibleCount++;
        } else {
            node.hide();
        }
    });
    Logger.debug(`После фильтра видимо узлов: ${visibleCount}`);

    // Применяем поиск (подсвечиваем совпадения среди всех узлов, включая скрытые)
    if (searchTerm) {
        let matchCount = 0;
        cy.nodes().forEach(node => {
            if (node.data('isGroup')) return; // группы не участвуют в поиске
            const name = (node.data('name') || '').toLowerCase();
            const ip = (node.data('ip') || '').toLowerCase();
            const type = (node.data('type') || '').toLowerCase();
            if (name.includes(searchTerm) || ip.includes(searchTerm) || type.includes(searchTerm)) {
                node.addClass('cy-node-highlight');
                matchCount++;
            }
        });
        Logger.debug(`Найдено совпадений: ${matchCount}`);
    }
}

// Очистка поиска
window.clearSearch = function() {
    Logger.debug('Очистка поиска');
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = '';
    }
    if (cy) {
        cy.nodes().removeClass('cy-node-highlight');
        // Переприменяем фильтр (без поиска)
        filterByStatus(currentFilterStatus);
    }
};

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', function() {
    Logger.debug('DOM загружен, инициализация поиска');
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        // Обработка ввода с задержкой (debounce)
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(applyFilterAndSearch, 300);
        });
        // Обработка нажатия Enter
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(searchTimeout);
                applyFilterAndSearch();
            }
        });
        Logger.debug('Слушатели навешены');
    } else {
        Logger.error('searchInput не найден при инициализации');
    }
});
function goToDevice(deviceId) {
    const node = cy.getElementById(String(deviceId));
    if (node.length) {
        // Сбрасываем zoom до 1.0 и центрируем на узле
        cy.zoom(1.0);
        cy.center(node);
        node.select();
        const modal = bootstrap.Modal.getInstance(document.getElementById('deviceModal'));
        if (modal) modal.hide();
    }
}

// ============================================================================
// АВТОМАТИЧЕСКАЯ РАССТАНОВКА УЗЛОВ
// ============================================================================
function confirmLayout(layoutName) {
    const layoutNames = {
        'grid': 'Сетка',
        'circle': 'Круг',
        'concentric': 'Концентрический',
        'breadthfirst': 'Дерево',
        'cose': 'Силовой'
    };
    const name = layoutNames[layoutName] || layoutName;
    if (confirm(`Применить автораскладку "${name}"? Текущее расположение будет изменено.`)) {
        applyLayout(layoutName);
    }
}

function applyLayout(layoutName) {
    if (!cy) return;

    // Параметры для разных лэйаутов
    const layoutOptions = {
        name: layoutName,
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 30
    };

    // Дополнительные настройки для конкретных лэйаутов
    if (layoutName === 'grid') {
        layoutOptions.rows = undefined; // авто
    } else if (layoutName === 'circle') {
        // стандартные настройки
    } else if (layoutName === 'concentric') {
        layoutOptions.minNodeSpacing = 50;
    } else if (layoutName === 'breadthfirst') {
        layoutOptions.directed = true;
        layoutOptions.circle = false;
        layoutOptions.spacingFactor = 1.5;
    } else if (layoutName === 'cose') {
        layoutOptions.idealEdgeLength = 100;
        layoutOptions.nodeOverlap = 20;
        layoutOptions.refresh = 20;
        layoutOptions.fit = true;
        layoutOptions.padding = 30;
        layoutOptions.randomize = false;
        layoutOptions.componentSpacing = 100;
        layoutOptions.nodeRepulsion = 400000;
        layoutOptions.edgeElasticity = 100;
        layoutOptions.nestingFactor = 5;
        layoutOptions.gravity = 80;
        layoutOptions.numIter = 1000;
        layoutOptions.initialTemp = 200;
        layoutOptions.coolingFactor = 0.95;
        layoutOptions.minTemp = 1.0;
    }

    const layout = cy.layout(layoutOptions);
    layout.run();
}
// ============================================================================
// МАССОВОЕ РЕДАКТИРОВАНИЕ
// ============================================================================

// Обновление видимости кнопки при изменении выделения
function updateBulkEditButton() {
    const selectedCount = cy.nodes(':selected').filter(node => !node.data('isGroup')).length;
    const group = document.getElementById('bulkEditGroup');
    if (group) {
        group.style.display = selectedCount > 0 ? 'flex' : 'none';
    }
}

// Открыть модальное окно массового редактирования
function openBulkEditModal() {
    // ========== ПРОВЕРКА ДЛЯ ОПЕРАТОРА ==========
    if (window.isOperator) {
        alert('Оператор не может редактировать устройства');
        return;
    }
    // =============================================

    const selected = cy.nodes(':selected').filter(node => !node.data('isGroup'));
    if (selected.length === 0) {
        alert('Нет выбранных устройств');
        return;
    }
    document.getElementById('selectedCount').textContent = selected.length;
    document.getElementById('bulk_monitoring').value = '';
    loadDeviceTypesForBulk();
    loadGroupsForBulk();
    const modal = new bootstrap.Modal(document.getElementById('bulkEditModal'));
    modal.show();
}

// Загрузка типов для массового редактирования
function loadDeviceTypesForBulk() {
    fetchWithRetry('/api/types')
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(types => {
            const select = document.getElementById('bulk_type');
            select.innerHTML = '<option value="">-- Не изменять --</option>';
            types.forEach(t => {
                const option = document.createElement('option');
                option.value = t.id;
                option.text = t.name;
                select.appendChild(option);
            });
        })
        .catch(err => Logger.error('Ошибка загрузки типов:', err));
}

// Загрузка групп для массового редактирования
function loadGroupsForBulk() {
    fetchWithRetry(`/api/map/${getMapId()}/groups`)
        .then(res => res.ok ? res.json() : [])
        .then(groups => {
            const select = document.getElementById('bulk_group');
            select.innerHTML = '<option value="">-- Не изменять --</option>';
            groups.forEach(g => {
                const option = document.createElement('option');
                option.value = g.id;
                option.text = g.name;
                select.appendChild(option);
            });
        })
        .catch(err => Logger.error('Ошибка загрузки групп:', err));
}

// Применить массовое редактирование
function applyBulkEdit() {
    const selected = cy.nodes(':selected').filter(node => !node.data('isGroup'));
    if (selected.length === 0) return;

    const typeId = document.getElementById('bulk_type').value;
    const groupId = document.getElementById('bulk_group').value;
    const center = document.getElementById('bulk_center').checked;
    const monitoring = document.getElementById('bulk_monitoring').value;

    // Определяем координаты центра видимой области
    let centerX, centerY;
    if (center) {
        const container = document.getElementById('cy');
        const pan = cy.pan();
        const zoom = cy.zoom();
        centerX = (-pan.x + container.clientWidth / 2 / zoom);
        centerY = (-pan.y + container.clientHeight / 2 / zoom);
    }

    const promises = [];
    selected.forEach(node => {
        const update = {};
        if (typeId) update.type_id = parseInt(typeId);
        if (groupId !== '') update.group_id = parseInt(groupId);
        if (center) {
            update.pos_x = Math.round(centerX);
            update.pos_y = Math.round(centerY);
        }
        if (monitoring !== '') update.monitoring_enabled = (monitoring === 'true');

        if (Object.keys(update).length === 0) return;

        promises.push(
            fetch(`/api/device/${node.id()}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(update)
            }).then(res => {
                if (!res.ok) throw new Error(`Ошибка обновления устройства ${node.id()}`);
                return res.json();
            })
        );
    });

    if (promises.length === 0) {
        alert('Нет изменений для применения');
        return;
    }

    Promise.all(promises)
        .then(() => {
            bootstrap.Modal.getInstance(document.getElementById('bulkEditModal')).hide();
            reloadMapElements();
        })
        .catch(err => {
            Logger.error('Ошибка массового редактирования:', err);
            alert('Не удалось обновить все устройства');
        });
}
// ============================================================================
// БЛОКИРОВКА ПЕРЕТАСКИВАНИЯ (с сохранением в localStorage)
// ============================================================================
let dragLocked = localStorage.getItem('dragLocked') === 'true';

function updateLockButton() {
    const lockBtn = document.getElementById('lockMode');
    if (!lockBtn) return;

    if (window.isOperator) {
        lockBtn.disabled = true;
        lockBtn.classList.add('active');
        lockBtn.innerHTML = '<i class="fas fa-lock"></i>';
        lockBtn.title = 'Оператор не может разблокировать карту';
        return;
    }

    lockBtn.disabled = false;
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

function toggleLock() {
    // Оператор не может переключать блокировку
    if (window.isOperator) return;

    dragLocked = !dragLocked;
    localStorage.setItem('dragLocked', dragLocked);
    updateLockButton();
}

// ============================================================================
// ДОБАВЛЕНИЕ НОВОГО УСТРОЙСТВА НА КАРТУ
// ============================================================================
window.addDeviceToGraph = function(device) {
    if (!cy) return;
    if (cy.getElementById(String(device.id)).length > 0) return;

    const groupParent = device.group_id ? `group_${device.group_id}` : undefined;

    cy.add({
        group: 'nodes',
        data: {
            id: String(device.id),
            name: device.name,
            ip: device.ip,
            type_id: device.type_id,
            group_id: device.group_id,
            parent: groupParent,
            monitoring_enabled: device.monitoring_enabled,
            status: device.status || 'true'
        },
        position: {
            x: device.x || 100,
            y: device.y || 100
        }
    });

    cy.style().update();
    Logger.info('✅ Новое устройство добавлено на карту:', device.name);
};

window.removeDeviceFromGraph = function(deviceId) {
    if (!cy) return;
    const node = cy.getElementById(String(deviceId));
    if (node.length) {
        cy.remove(node);
        Logger.info('✅ Устройство удалено с карты:', deviceId);
    }
};

window.updateDevice = function(device) {
    if (!cy) return;
    const node = cy.getElementById(String(device.id));
    if (node.length) {
        // Обновляем основные данные
        node.data({
            name: device.name,
            ip: device.ip_address || device.ip,
            type_id: device.type_id,
            group_id: device.group_id,
            monitoring_enabled: device.monitoring_enabled
        });
        // Обновляем принадлежность к группе (parent)
        const groupParent = device.group_id ? `group_${device.group_id}` : undefined;
        node.data('parent', groupParent);
        // Принудительно обновляем стили
        cy.style().update();
        Logger.info('✅ Устройство обновлено на карте:', device.name);
    }
};
// ============================================================================
// ПЕРЕЗАГРУЗКА ЭЛЕМЕНТОВ КАРТЫ (после изменений)
// ============================================================================
window.reloadMapElements = function() {
    if (!cy) return;
    const mapId = getMapId();
    if (!mapId) return;
    Logger.info('🔄 Перезагрузка элементов карты...');
    // Удаляем все существующие элементы (узлы и рёбра)
    cy.elements().remove();
    // Загружаем элементы заново
    loadElements(mapId);
};
// ============================================================================
// УДАЛЕНИЕ СВЯЗИ С КАРТЫ
// ============================================================================
function removeLinkFromGraph(linkId) {
    if (!cy) return;
    const edge = cy.getElementById(String(linkId));
    if (edge.length) {
        cy.remove(edge);
        Logger.info('✅ Связь удалена с карты:', linkId);
        if (typeof window.showToast === 'function') {
            window.showToast('Успешно', 'Связь удалена', 'success');
        }
    }
}