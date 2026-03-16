// ============================================================================
// LinkVision - Карта сети (ФИНАЛЬНАЯ ВЕРСИЯ С ИСПРАВЛЕНИЯМИ)
// ============================================================================
let cy = null;
let deviceModal = null;
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
    if (backgroundLoaded && elementsLoaded && !pendingFit) {
        const cyEl = document.getElementById('cy');
        const panX = parseFloat(cyEl.dataset.panX) || 0;
        const panY = parseFloat(cyEl.dataset.panY) || 0;
        const zoom = parseFloat(cyEl.dataset.zoom) || 1;
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
    // Присоединяемся к комнате карты через глобальный сокет
        // Проверка: если mapId не число (например, null) – создаём пустую карту (режим новой карты)
    if (!mapId || isNaN(parseInt(mapId))) {
        Logger.warn('initMap: mapId невалиден, создаётся пустая карта');
        cy = cytoscape({
            container: document.getElementById('cy'),
            elements: [],
            style: [ /* ВСТАВЬТЕ СЮДА ПОЛНЫЙ МАССИВ СТИЛЕЙ ИЗ ОСНОВНОГО КОДА */ ],
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
        // Не подключаемся к сокету, не загружаем элементы и фон
        return;
        }
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

    window.socket.on('device_status', (data) => {
        Logger.debug('📡 [RAW] device_status получен:', data);

        if (Number(data.map_id) !== Number(mapId)) {
            Logger.debug('⏭️ Событие для другой карты, игнорируем');
            return;
        }

        if (!cy) {
            Logger.debug('⏭️ Cytoscape ещё не инициализирован');
            return;
        }

        const node = cy.getElementById(String(data.id));
        if (!node.length) {
            Logger.warn(`⚠️ Узел с id ${data.id} не найден на карте`);
            return;
        }

        try {
            const statusValue = data.status === 'true' ? 'true' : 'false';
            const oldStatus = node.data('status');

            Logger.debug(`🔄 Узел: ${node.data('name')} (id=${data.id})`);
            Logger.debug(`   Старый статус: ${oldStatus}, новый: ${statusValue}`);

            if (oldStatus === statusValue) {
                Logger.debug('   Статус не изменился, пропускаем обновление');
                return;
            }

            node.data('status', statusValue);

            if (statusValue === 'false') {
                addPulsingNode(node);
            } else {
                removePulsingNode(node);
            }

            cy.style().update();

            const becameDown = (statusValue === 'false');
            updateSidebarCounter(data.map_id, becameDown);

            const computedBorderColor = node.style('border-color');
            Logger.debug(`   Применённый border-color: ${computedBorderColor}`);
            Logger.debug('✅ Статус успешно обновлён');
        } catch (e) {
            Logger.error('❌ Ошибка в обработчике device_status:', e);
        }
    });

    cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [],
        style: [
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
                    'text-background-opacity': 0.8,
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
                    'text-background-opacity': 0.8,
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
                    'text-background-opacity': 0.8,
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
                    'background-color': 'rgba(0,123,255,0.1)'
                }
            },
                // Новый селектор для подсветки при поиске
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
                    'font-weight': 'normal',
                    'color': '#888',
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
        ],
        layout: { name: 'preset' },
        boxSelectionEnabled: false,
        autounselectify: true,
        minZoom: 0.1,
        maxZoom: 5,
        wheelSensitivity: 0.5,
        fit: false
    });

    cy.on('pan zoom', () => {
        updateBackgroundTransform();
        enforcePanBounds();
        saveViewportToServer();
    });
    cy.on('select unselect', updateBulkEditButton);
    const deviceModalEl = document.getElementById('deviceModal');
    if (deviceModalEl && !deviceModal) {
        deviceModal = new bootstrap.Modal(deviceModalEl);
    }

    const linkModalEl = document.getElementById('linkModal');
    if (linkModalEl && !linkModal) {
        linkModal = new bootstrap.Modal(linkModalEl);
        ['link_src_iface', 'link_tgt_iface'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', updateLinkPreview);
        });
    }

    const bgEl = document.getElementById('cy-background');
    if (bgEl && bgEl.dataset.background) {
        loadBackground(bgEl.dataset.background);
    } else {
        backgroundLoaded = true;
        checkReadyAndFit();
    }

    loadElements(mapId);
    loadDeviceTypes();

    window.addEventListener('resize', () => {
        if (cy) {
            cy.resize();
            updateBackgroundTransform();
            enforcePanBounds();
        }
    });

    cy.on('dragfree', 'node', function(evt) {
        if (window.isOperator) return; // запрет для оператора
        const node = evt.target;
        let pos = node.position();
        const boundedPos = boundNodePosition(pos);
        if (boundedPos.x !== pos.x || boundedPos.y !== pos.y) {
            node.position(boundedPos);
            pos = boundedPos;
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

    cy.on('drag', 'node', function(evt) {
        evt.target._private.scratch._dragStartPos = evt.target.position();
    });

    cy.on('dragfree', 'node:selected', function(evt) {
        if (window.isOperator) return;
        const selectedNodes = cy.nodes(':selected');
        if (selectedNodes.length <= 1) return;
        const draggedNode = evt.target;
        const oldPos = draggedNode._private.scratch._dragStartPos || draggedNode.position();
        const newPos = draggedNode.position();
        const deltaX = newPos.x - oldPos.x;
        const deltaY = newPos.y - oldPos.y;
        clearTimeout(dragTimeout);
        dragTimeout = setTimeout(() => {
            selectedNodes.forEach(node => {
                if (node.id() !== draggedNode.id()) {
                    const nodePos = node.position();
                    const boundedPos = boundNodePosition({ x: nodePos.x + deltaX, y: nodePos.y + deltaY });
                    node.position(boundedPos);
                    fetch(`/api/device/${node.id()}/position`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ x: Math.round(boundedPos.x), y: Math.round(boundedPos.y) })
                    }).catch(err => Logger.error('Ошибка при сохранении позиции:', err));
                }
            });
        }, 500);
    });

    cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        if (linkMode) {
            evt.stopPropagation();
            if (!sourceNode) {
                sourceNode = node;
                sourceNode.style('border-color', '#007bff');
                sourceNode.style('border-width', 5);
                const linkInfo = document.getElementById('linkInfo');
                if (linkInfo) linkInfo.textContent = `✅ Источник: ${node.data('name')}\n👆 Выберите второе устройство`;
            } else if (sourceNode.id() !== node.id()) {
                openLinkModal(sourceNode.id(), node.id());
            }
            return;
        }
        if (currentMode !== 'select') cy.nodes().selected(false);
        node.selected(true);
    });

    cy.on('dbltap', 'node', function(evt) { openDeviceModal(evt.target); });
    cy.on('tap', 'edge', function(evt) {
        if (currentMode !== 'select') cy.edges().selected(false);
        evt.target.selected(true);
    });
    cy.on('dbltap', 'edge', function(evt) { openLinkModalForEdit(evt.target); });
    cy.on('tap', function(event) {
        if (event.target === cy && linkMode) resetLinkMode();
        if (event.target === cy) cy.elements().deselect();
    });

    setMode('pan');
}

function applyLinkTypePreset(type) {
    const presets = {
        '100m':  { color: '#FFA500', width: 2, style: 'solid' },
        '1G':    { color: '#00FF00', width: 3, style: 'solid' },
        '10G':   { color: '#0000FF', width: 4, style: 'solid' },
        '25G':   { color: '#FF00FF', width: 5, style: 'solid' },
        '100G':  { color: '#800080', width: 6, style: 'solid' },
        '400G':  { color: '#800080', width: 8, style: 'solid' },
        'vlan':  { color: '#A9A9A9', width: 2, style: 'dashed' },
        'radio': { color: '#00FFFF', width: 2, style: 'dotted' }
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

        // Обработка групп
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
                        isGroup: true
                    }
                };
                groupNodes.push(groupNode);
                groupMap[g.id] = `group_${g.id}`;
            });
        }

        // Обработка устройств
        const validNodes = data.nodes.filter(n => n.data && n.data.id);
        const deviceNodes = validNodes.map(n => {
            // Устанавливаем parent, если устройство принадлежит группе
            if (n.data.group_id && groupMap[n.data.group_id]) {
                n.data.parent = groupMap[n.data.group_id];
            }
            // Корректировка позиции
            if (bgImageWidth && bgImageHeight) {
                if (n.data.x !== undefined && n.data.y !== undefined) {
                    const bounded = boundNodePosition({ x: n.data.x, y: n.data.y });
                    n.data.x = bounded.x;
                    n.data.y = bounded.y;
                }
            }
            return n;
        });

        // Отладка
        Logger.debug('Группы добавлены:', groupNodes.length);
        deviceNodes.forEach(n => {
            if (n.data.parent) {
                Logger.debug('Устройство', n.data.id, 'принадлежит группе', n.data.parent);
            }
        });

        // Обработка рёбер
        const validEdges = data.edges.filter(e =>
            e.data && e.data.source && e.data.target &&
            e.data.source !== 'None' && e.data.target !== 'None'
        );

        // Добавляем всё в cy
        cy.add(groupNodes);
        cy.add(deviceNodes);
        cy.add(validEdges);

        const layout = cy.layout({ name: 'preset' });
        layout.one('layoutstop', () => {
            elementsLoaded = true;
            Logger.info('✅ Элементы загружены:', deviceNodes.length, 'узлов,', validEdges.length, 'связей');
            checkReadyAndFit();
            cy.nodes().forEach(node => {
                if (node.data('status') === 'false') {
                    addPulsingNode(node);
                }
            });
        });
        layout.run();

        // Предзагрузка иконок
        validNodes.forEach(n => {
            if (n.data.iconUrl && n.data.iconUrl !== '') {
                const img = new Image();
                img.src = n.data.iconUrl;
            }
        });
    })
    .catch(err => {
        Logger.error('❌ Ошибка загрузки элементов:', err);
        elementsLoaded = true;
        checkReadyAndFit();
    });
}

function loadDeviceTypes() {
    fetchWithRetry('/api/types')
    .then(res => res.ok ? res.json() : Promise.reject())
    .then(types => {
        const select = document.getElementById('dev_type');
        if (!select) return;
        select.innerHTML = '-- Выберите тип --';
        types.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.text = t.name;
            select.appendChild(option);
        });
    })
    .catch(err => Logger.error('❌ Ошибка типов:', err));
}

function saveViewportToServer() {
    if (window.isOperator) {
        // Оператор не сохраняет viewport – все изменения временные
        return;
    }
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

function openDeviceModal(node) {
    if (!deviceModal) {
        const el = document.getElementById('deviceModal');
        if (el) deviceModal = new bootstrap.Modal(el);
        else return;
    }
    const modal = document.getElementById('deviceModal');
    const devId = document.getElementById('dev_id');
    const devName = document.getElementById('dev_name');
    const devIp = document.getElementById('dev_ip');
    const devType = document.getElementById('dev_type');
    const deleteBtn = document.getElementById('deleteDeviceBtn');
    const historyBody = document.getElementById('device-history-body');
    const neighborsBody = document.getElementById('device-neighbors-body');
    const devGroup = document.getElementById('dev_group');
    const monitoringCheck = document.getElementById('dev_monitoring');

    if (node) {
        // Режим редактирования
        devId.value = node.id();
        devName.value = node.data('name') || '';
        devIp.value = node.data('ip') || '';
        deleteBtn.style.display = 'inline-block';
        deleteBtn.onclick = () => deleteDevice(node.id());

        fetch(`/api/device/${node.id()}/details`)
            .then(res => res.ok ? res.json() : Promise.reject('Ошибка загрузки'))
            .then(data => {
                if (data.type_id && devType) devType.value = data.type_id;
                if (data.history && data.history.length > 0) {
                    historyBody.innerHTML = '';
                    data.history.forEach(entry => {
                        const row = historyBody.insertRow();
                        row.insertCell().textContent = new Date(entry.timestamp).toLocaleString();
                        row.insertCell().innerHTML = entry.old_status === 'true' ? '<span class="badge bg-success">UP</span>' : '<span class="badge bg-danger">DOWN</span>';
                        row.insertCell().innerHTML = entry.new_status === 'true' ? '<span class="badge bg-success">UP</span>' : '<span class="badge bg-danger">DOWN</span>';
                    });
                } else {
                    historyBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Нет записей</td></tr>';
                }
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

                fetch(`/api/map/${getMapId()}/groups`)
                    .then(res => res.ok ? res.json() : [])
                    .then(groups => {
                        devGroup.innerHTML = '<option value="">-- Без группы --</option>';
                        groups.forEach(g => {
                            const option = document.createElement('option');
                            option.value = g.id;
                            option.textContent = g.name;
                            option.style.backgroundColor = g.color;
                            devGroup.appendChild(option);
                        });
                        if (data.group_id) devGroup.value = data.group_id;
                        else devGroup.value = '';
                    })
                    .catch(err => Logger.error('Ошибка загрузки групп:', err));
            })
            .catch(err => {
                Logger.error('Ошибка загрузки деталей:', err);
                historyBody.innerHTML = '<tr><td colspan="3" class="text-center text-danger">Ошибка загрузки</td></tr>';
                neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Ошибка загрузки</td></tr>';
            });
    } else {
        // Режим создания
        devId.value = '';
        devName.value = '';
        devIp.value = '';
        if (devType) devType.value = '';
        deleteBtn.style.display = 'none';
        historyBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Нет данных</td></tr>';
        neighborsBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Нет данных</td></tr>';

        fetch(`/api/map/${getMapId()}/groups`)
            .then(res => res.ok ? res.json() : [])
            .then(groups => {
                devGroup.innerHTML = '<option value="">-- Без группы --</option>';
                groups.forEach(g => {
                    const option = document.createElement('option');
                    option.value = g.id;
                    option.textContent = g.name;
                    option.style.backgroundColor = g.color;
                    devGroup.appendChild(option);
                });
            })
            .catch(err => Logger.error('Ошибка загрузки групп:', err));
    }

    // Активируем первую вкладку
    const tab = new bootstrap.Tab(document.querySelector('#deviceModal .nav-link.active'));
    tab.show();

    // ========== БЛОКИРОВКА ДЛЯ ОПЕРАТОРА ==========
    if (window.isOperator) {
        // Блокируем все поля ввода
        devName.disabled = true;
        devIp.disabled = true;
        devType.disabled = true;
        devGroup.disabled = true;
        if (monitoringCheck) monitoringCheck.disabled = true;
        // Скрываем кнопки "Сохранить" и "Удалить"
        const saveBtn = document.querySelector('#deviceModal .btn-primary');
        if (saveBtn) saveBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
    } else {
        // Обычный режим – поля доступны
        devName.disabled = false;
        devIp.disabled = false;
        devType.disabled = false;
        devGroup.disabled = false;
        if (monitoringCheck) monitoringCheck.disabled = false;
    }
    // =============================================

    deviceModal.show();
}

function saveDevice() {
    const id = document.getElementById('dev_id').value;
    const name = document.getElementById('dev_name').value;
    const ip = document.getElementById('dev_ip').value;
    const type_id = document.getElementById('dev_type').value;
    const group_id = document.getElementById('dev_group').value;
    const monitoring = document.getElementById('dev_monitoring')?.checked;

    if (!name) { alert('⚠️ Введите имя'); return; }
    if (!type_id) { alert('⚠️ Выберите тип'); return; }

    const body = {
        name,
        ip_address: ip,
        type_id: parseInt(type_id),
        group_id: group_id ? parseInt(group_id) : null,
        monitoring_enabled: monitoring
    };

    if (id) {
        fetch(`/api/device/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(res => res.ok ? (deviceModal?.hide(), location.reload()) : alert('❌ Ошибка'))
        .catch(err => {
            Logger.error('Ошибка при сохранении устройства:', err);
            alert('❌ Ошибка сети при сохранении');
        });
    } else {
        body.map_id = getMapId();
        if (cy) {
            const center = {
                x: (-cy.pan().x + cy.width() / 2 / cy.zoom()),
                y: (-cy.pan().y + cy.height() / 2 / cy.zoom())
            };
            const bounded = boundNodePosition(center);
            body.x = Math.round(bounded.x);
            body.y = Math.round(bounded.y);
        } else {
            body.x = 100; body.y = 100;
        }
        fetch('/api/device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(res => res.ok ? (deviceModal?.hide(), location.reload()) : alert('❌ Ошибка'))
        .catch(err => {
            Logger.error('Ошибка при создании устройства:', err);
            alert('❌ Ошибка сети при создании');
        });
    }
}

function deleteDevice(id) {
    if (confirm('⚠️ Удалить?')) {
        fetch(`/api/device/${id}`, { method: 'DELETE' })
        .then(res => res.ok ? (deviceModal?.hide(), location.reload()) : alert('❌ Ошибка'))
        .catch(err => {
            Logger.error('Ошибка при удалении устройства:', err);
            alert('❌ Ошибка сети при удалении');
        });
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
                    source: String(sourceId),
                    target: String(targetId),
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
    .then(res => res.ok ? location.reload() : alert('❌ Ошибка'))
    .catch(err => {
        Logger.error('Ошибка обновления связи:', err);
        alert('❌ Ошибка сети при обновлении');
    });
}

function deleteLink(linkId) {
    if (!confirm('⚠️ Удалить эту связь?')) return;
    const numericId = String(linkId).replace('link_', '');
    fetch(`/api/link/${numericId}`, { method: 'DELETE' })
    .then(res => res.ok ? location.reload() : alert('❌ Ошибка'))
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
    info.textContent = '👆 Выберите ПЕРВОЕ устройство';
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
        bootstrap.Modal.getInstance(document.getElementById('deviceModal')).hide();
    }
}

// ============================================================================
// УПРАВЛЕНИЕ ГРУППАМИ
// ============================================================================
function openGroupManager() {
    // ========== ПРОВЕРКА ДЛЯ ОПЕРАТОРА ==========
    if (window.isOperator) {
        alert('Оператор не может управлять группами');
        return;
    }
    // =============================================

    loadGroups();
    const modal = new bootstrap.Modal(document.getElementById('groupModal'));
    modal.show();
}

function loadGroups() {
    fetch(`/api/map/${getMapId()}/groups`)
        .then(res => res.ok ? res.json() : [])
        .then(groups => {
            const tbody = document.getElementById('group-list-body');
            tbody.innerHTML = '';
            groups.forEach(g => {
                const row = tbody.insertRow();
                row.insertCell().textContent = g.name;
                row.insertCell().innerHTML = `<span style="display:inline-block; width:20px; height:20px; background:${g.color}; border-radius:4px;"></span> ${g.color}`;
                // Количество устройств в группе (можно получить отдельно или добавить в ответ API)
                row.insertCell().textContent = g.device_count || 0;
                const actions = row.insertCell();
                actions.innerHTML = `
                    <button class="btn btn-sm btn-outline-primary" onclick="editGroup(${g.id}, '${g.name}', '${g.color}')">✏️</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteGroup(${g.id})">🗑️</button>
                `;
            });
        })
        .catch(err => Logger.error('Ошибка загрузки групп:', err));
}

document.getElementById('groupForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const id = document.getElementById('group_id').value;
    const name = document.getElementById('group_name').value;
    const color = document.getElementById('group_color').value;
    const mapId = getMapId();

    const url = id ? `/api/group/${id}` : '/api/group';
    const method = id ? 'PUT' : 'POST';
    const body = id ? { name, color } : { name, color, map_id: mapId };

    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(res => res.ok ? res.json() : Promise.reject())
    .then(() => {
        document.getElementById('groupForm').reset();
        document.getElementById('group_id').value = '';
        loadGroups();
        reloadMapElements(); // обновить карту (перезагрузить элементы)
    })
    .catch(err => Logger.error('Ошибка сохранения группы:', err));
});

function editGroup(id, name, color) {
    document.getElementById('group_id').value = id;
    document.getElementById('group_name').value = name;
    document.getElementById('group_color').value = color;
}

function deleteGroup(id) {
    if (!confirm('Удалить группу? Устройства останутся без группы.')) return;
    fetch(`/api/group/${id}`, { method: 'DELETE' })
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(() => {
            loadGroups();
            reloadMapElements();
        })
        .catch(err => Logger.error('Ошибка удаления группы:', err));
}

function reloadMapElements() {
    // Функция для перезагрузки элементов карты
    cy.elements().remove();
    loadElements(getMapId());
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