// ============================================================================
// WebNetMap Pro - Карта сети (ИСПРАВЛЕНИЕ: ЗАГРУЗКА + ЛЕЙБЛЫ)
// ============================================================================

let cy = null;
let deviceModal = null;
let linkModal = null;
let linkMode = false;
let sourceNode = null;
let socket = null;
let dragTimeout = null;
let currentMode = 'pan';
let bgImageWidth = null;
let bgImageHeight = null;
let viewportTimeout = null;
let pendingFit = false;
let elementsLoaded = false; // Флаг: элементы загружены
let backgroundLoaded = false; // Флаг: фон загружен

function getMapId() {
    return window.currentMapId;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

// ============================================================================
// ОГРАНИЧЕНИЕ ПАНОРАМИРОВАНИЯ
// ============================================================================

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

// ============================================================================
// ОГРАНИЧЕНИЕ ПОЗИЦИИ УЗЛА
// ============================================================================

function boundNodePosition(pos) {
    if (!bgImageWidth || !bgImageHeight) return pos;

    const margin = 30;
    return {
        x: clamp(pos.x, margin, bgImageWidth - margin),
        y: clamp(pos.y, margin, bgImageHeight - margin)
    };
}

// ============================================================================
// ПОДГОНКА ИЗОБРАЖЕНИЯ (вызывается когда всё готово)
// ============================================================================

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

    console.log('📐 Изображение подогнано:', zoom.toFixed(2), 'pan:', panX.toFixed(0), panY.toFixed(0));
}

// ============================================================================
// ПРОВЕРКА ГОТОВНОСТИ (фон + элементы)
// ============================================================================

function checkReadyAndFit() {
    if (backgroundLoaded && elementsLoaded && !pendingFit) {
        // Проверяем, есть ли сохранённый viewport
        const cyEl = document.getElementById('cy');
        const panX = parseFloat(cyEl.dataset.panX) || 0;
        const panY = parseFloat(cyEl.dataset.panY) || 0;
        const zoom = parseFloat(cyEl.dataset.zoom) || 1;

        if (panX !== 0 || panY !== 0 || zoom !== 1) {
            cy.viewport({ pan: { x: panX, y: panY }, zoom: zoom });
            console.log('🖼️ Viewport восстановлен из БД');
        } else {
            fitImageToView();
        }
        updateBackgroundTransform();
        enforcePanBounds();
    }
}

// ============================================================================
// ИНИЦИАЛИЗАЦИЯ КАРТЫ
// ============================================================================

function initMap(mapId) {
    console.log('🗺️ Инициализация карты:', mapId);

    if (!socket) {
        socket = io();
    }
    socket.onAny((event, ...args) => {
        console.log(`📨 Событие сокета: ${event}`, args);
    });
    socket.on('connect', () => {
        console.log('✅ Socket connected');
        socket.emit('join_room', `map_${mapId}`);
    });

socket.on('device_status', (data) => {
    console.log('📡 Получен device_status:', data);
    if (data.map_id === mapId && cy) {
        const node = cy.getElementById(String(data.id));
        if (node.length) {
            // Обновляем данные статуса (для будущих селекторов)
            node.data('status', data.status ? 'true' : 'false');

            // Принудительно применяем стили в зависимости от наличия иконки
            if (node.data('iconUrl')) {
                // Узлы с иконкой
                node.style({
                    'border-color': data.status ? '#28a745' : '#dc3545',
                    'border-style': data.status ? 'solid' : 'dashed',
                    'opacity': data.status ? 1 : 0.85
                });
            } else {
                // Узлы без иконки
                node.style({
                    'background-color': data.status ? '#d4edda' : '#f8d7da',
                    'border-color': data.status ? '#28a745' : '#dc3545',
                    'border-style': data.status ? 'solid' : 'dashed',
                    'color': data.status ? '#155724' : '#721c24'
                });
            }

            // Пересчитываем все стили для согласованности
            cy.style().update();

            // Пульсация (если функция определена)
            if (typeof pulseNode === 'function') {
                pulseNode(node);
            }
        }
    }
});

    // === Cytoscape инициализация ===
    cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [],
        style: [
            // Узлы с иконкой
            {
                selector: 'node[iconUrl][iconUrl != ""]',
                style: {
                    'shape': 'round-rectangle',
                    'width': 54,
                    'height': 54,
                    'background-color': '#000000',
                    'background-opacity': 0,
                    'background-image': 'data(iconUrl)',
                    'background-fit': 'contain',
                    'background-clip': 'node',
                    'border-width': 3,
                    'border-color': '#28a745',
                    'border-style': 'solid',
                    // Имя устройства
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
            // Узлы с иконкой + статус DOWN
            {
                selector: 'node[iconUrl][iconUrl != ""][status = "false"]',
                style: {
                    'border-color': '#dc3545',
                    'border-style': 'dashed',
                    'opacity': 0.85
                }
            },
            // Узлы без иконки + статус UP
            {
                selector: 'node[!iconUrl][status = "true"], node[iconUrl = ""][status = "true"]',
                style: {
                    'shape': 'round-rectangle',
                    'width': 60,
                    'height': 60,
                    'background-color': '#d4edda',
                    'border-width': 3,
                    'border-color': '#28a745',
                    'border-style': 'solid',
                    // Имя + IP адрес (разделены переносом строки)
                    // 'label': 'data(name) "\A" data(ip)',
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
            // Узлы без иконки + статус DOWN
            {
                selector: 'node[!iconUrl][status = "false"], node[iconUrl = ""][status = "false"]',
                style: {
                    'shape': 'round-rectangle',
                    'width': 60,
                    'height': 60,
                    'background-color': '#f8d7da',
                    'border-width': 3,
                    'border-color': '#dc3545',
                    'border-style': 'dashed',
                    //'label': 'data(name) "\A" data(ip)',
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
                    'opacity': 0.9
                }
            },
            // Выделение
            {
                selector: 'node:selected',
                style: {
                    'border-color': '#007bff',
                    'border-width': 5,
                    'background-color': 'rgba(0,123,255,0.1)'
                }
            },
            // Связи
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': '#6c757d',
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

    // Подписка на pan/zoom
    cy.on('pan zoom', () => {
        updateBackgroundTransform();
        enforcePanBounds();
        saveViewportToServer();
    });

    // Модальные окна
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

    // Загрузка фона
    const bgEl = document.getElementById('cy-background');
    if (bgEl && bgEl.dataset.background) {
        loadBackground(bgEl.dataset.background);
    } else {
        // Фона нет - считаем что фон "загружен"
        backgroundLoaded = true;
        checkReadyAndFit();
    }

    // Загрузка элементов
    loadElements(mapId);
    loadDeviceTypes();

    // Resize
    window.addEventListener('resize', () => {
        if (cy) {
            cy.resize();
            updateBackgroundTransform();
            enforcePanBounds();
        }
    });

    // Drag & Drop с ограничением
    cy.on('dragfree', 'node', function(evt) {
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
            });
        }, 500);
    });

    // Групповое перемещение
    cy.on('drag', 'node', function(evt) {
        evt.target._private.scratch._dragStartPos = evt.target.position();
    });

    cy.on('dragfree', 'node:selected', function(evt) {
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
                    });
                }
            });
        }, 500);
    });

    // Клик по узлу
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

// ============================================================================
// ЗАГРУЗКА ФОНА
// ============================================================================

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
        console.log('🖼️ Фон загружен:', bgImageWidth, 'x', bgImageHeight);

        checkReadyAndFit();
    };

    img.onerror = () => {
        console.error('❌ Не удалось загрузить фон');
        backgroundLoaded = true;
        checkReadyAndFit();
    };

    img.src = `/static/uploads/maps/${bgUrl}`;
}

// ============================================================================
// УПРАВЛЕНИЕ ФОНОМ
// ============================================================================

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

// ============================================================================
// ЗАГРУЗКА ЭЛЕМЕНТОВ
// ============================================================================

function loadElements(mapId) {
    fetch(`/api/map/${mapId}/elements`)
    .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    })
    .then(data => {
        if (!cy) return;

        const validNodes = data.nodes.filter(n => n.data && n.data.id);
        const validEdges = data.edges.filter(e =>
            e.data && e.data.source && e.data.target &&
            e.data.source !== 'None' && e.data.target !== 'None'
        );

        // Ограничиваем позиции при загрузке
        if (bgImageWidth && bgImageHeight) {
            validNodes.forEach(n => {
                if (n.data.x !== undefined && n.data.y !== undefined) {
                    const bounded = boundNodePosition({ x: n.data.x, y: n.data.y });
                    n.data.x = bounded.x;
                    n.data.y = bounded.y;
                }
            });
        }

        cy.add(validNodes);
        cy.add(validEdges);

        const layout = cy.layout({ name: 'preset' });
        layout.one('layoutstop', () => {
            elementsLoaded = true;
            console.log('✅ Элементы загружены:', validNodes.length, 'узлов,', validEdges.length, 'связей');
            checkReadyAndFit();
        });
        layout.run();

        // Загрузка иконок
        validNodes.forEach(n => {
            if (n.data.iconUrl && n.data.iconUrl !== '') {
                const img = new Image();
                img.src = n.data.iconUrl;
            }
        });
    })
    .catch(err => {
        console.error('❌ Ошибка загрузки элементов:', err);
        elementsLoaded = true;
        checkReadyAndFit();
    });
}

// ============================================================================
// ЗАГРУЗКА ТИПОВ УСТРОЙСТВ
// ============================================================================

function loadDeviceTypes() {
    fetch('/api/types')
    .then(res => res.ok ? res.json() : Promise.reject())
    .then(types => {
        const select = document.getElementById('dev_type');
        if (!select) return;
        select.innerHTML = '<option value="">-- Выберите тип --</option>';
        types.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.text = t.name;
            select.appendChild(option);
        });
    })
    .catch(err => console.error('❌ Ошибка типов:', err));
}

// ============================================================================
// СОХРАНЕНИЕ VIEWPORT
// ============================================================================

function saveViewportToServer() {
    if (!cy) return;
    const pan = cy.pan();
    const zoom = cy.zoom();
    clearTimeout(viewportTimeout);
    viewportTimeout = setTimeout(() => {
        fetch(`/api/map/${getMapId()}/viewport`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pan_x: pan.x, pan_y: pan.y, zoom: zoom })
        });
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
// ============================================================================
// ПУЛЬСАЦИЯ УЗЛА ПРИ ИЗМЕНЕНИИ СТАТУСА (через overlay)
// ============================================================================
function pulseNode(node) {
    if (!node) return;

    // Сохраняем текущие значения overlay (по умолчанию 0)
    const originalOverlayOpacity = node.style('overlay-opacity');
    const originalOverlayPadding = node.style('overlay-padding');
    const originalOverlayColor = node.style('overlay-color');

    // Устанавливаем яркий overlay
    node.style({
        'overlay-color': '#ffff00',
        'overlay-opacity': 0.6,
        'overlay-padding': '10px',
        'transition': 'overlay-opacity 0.1s, overlay-padding 0.1s'
    });

    // Через 200 мс возвращаем исходные значения (скрываем overlay)
    setTimeout(() => {
        node.style({
            'overlay-opacity': originalOverlayOpacity,
            'overlay-padding': originalOverlayPadding,
            'overlay-color': originalOverlayColor,
            'transition': ''
        });
    }, 200);
}
// ============================================================================
// МОДАЛКИ И УПРАВЛЕНИЕ
// ============================================================================

function openDeviceModal(node) {
    if (!deviceModal) {
        const el = document.getElementById('deviceModal');
        if (el) deviceModal = new bootstrap.Modal(el);
        else return;
    }
    const modal = document.getElementById('deviceModal');
    const title = modal.querySelector('.modal-title');
    const devId = document.getElementById('dev_id');
    const devName = document.getElementById('dev_name');
    const devIp = document.getElementById('dev_ip');
    const devType = document.getElementById('dev_type');
    const deleteBtn = document.getElementById('deleteDeviceBtn');

    if (node) {
        title.textContent = 'Редактировать устройство';
        devId.value = node.id();
        devName.value = node.data('name') || '';
        devIp.value = node.data('ip') || '';
        fetch(`/api/device/${node.id()}`)
            .then(res => res.ok ? res.json() : null)
            .then(data => { if (data && devType) devType.value = data.type_id; });
        if (deleteBtn) {
            deleteBtn.style.display = 'inline-block';
            deleteBtn.onclick = () => deleteDevice(node.id());
        }
    } else {
        title.textContent = 'Новое устройство';
        devId.value = '';
        devName.value = '';
        devIp.value = '';
        if (devType) devType.value = '';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }
    deviceModal.show();
}

function saveDevice() {
    const id = document.getElementById('dev_id').value;
    const name = document.getElementById('dev_name').value;
    const ip = document.getElementById('dev_ip').value;
    const type_id = document.getElementById('dev_type').value;

    if (!name) { alert('⚠️ Введите имя'); return; }
    if (!type_id) { alert('⚠️ Выберите тип'); return; }

    const body = { name, ip_address: ip, type_id: parseInt(type_id) };

    if (id) {
        fetch(`/api/device/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(res => res.ok ? (deviceModal?.hide(), location.reload()) : alert('❌ Ошибка'));
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
        }).then(res => res.ok ? (deviceModal?.hide(), location.reload()) : alert('❌ Ошибка'));
    }
}

function deleteDevice(id) {
    if (confirm('⚠️ Удалить?')) {
        fetch(`/api/device/${id}`, { method: 'DELETE' })
        .then(res => res.ok ? (deviceModal?.hide(), location.reload()) : alert('❌ Ошибка'));
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
    document.getElementById('linkModalTitle').textContent = 'Новая связь';
    document.getElementById('linkDeleteBtn').style.display = 'none';
    updateLinkPreview();
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
    document.getElementById('linkModalTitle').textContent = 'Редактировать связь';
    document.getElementById('linkDeleteBtn').style.display = 'inline-block';
    document.getElementById('linkDeleteBtn').onclick = () => deleteLink(data.id);
    updateLinkPreview();
    if (linkModal) linkModal.show();
}

function confirmCreateLink() {
    const linkId = document.getElementById('link_id').value;
    const src = document.getElementById('link_source')?.value;
    const tgt = document.getElementById('link_target')?.value;
    const srcIface = document.getElementById('link_src_iface')?.value || 'eth0';
    const tgtIface = document.getElementById('link_tgt_iface')?.value || 'eth0';

    if (!src || !tgt) { alert('⚠️ Ошибка: не выбраны устройства'); return; }
    if (linkModal) linkModal.hide();

    if (linkId) {
        updateLink(linkId, srcIface, tgtIface);
    } else {
        createLinkWithInterfaces(src, tgt, srcIface, tgtIface);
    }
}

function createLinkWithInterfaces(src, tgt, srcIface, tgtIface) {
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
            tgt_iface: tgtIface
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
                    label: `${srcIface}↔${tgtIface}`
                }
            });
            resetLinkMode();
        }
    })
    .catch(err => alert('❌ Ошибка: ' + err.message));
}

function updateLink(linkId, srcIface, tgtIface) {
    const numericId = linkId.replace('link_', '');
    fetch(`/api/link/${numericId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_interface: srcIface, target_interface: tgtIface })
    }).then(res => res.ok ? location.reload() : alert('❌ Ошибка'));
}

function deleteLink(linkId) {
    if (!confirm('⚠️ Удалить эту связь?')) return;
    const numericId = String(linkId).replace('link_', '');
    fetch(`/api/link/${numericId}`, { method: 'DELETE' })
    .then(res => res.ok ? location.reload() : alert('❌ Ошибка'));
}

function resetLinkMode() {
    linkMode = false;
    if (sourceNode && cy) {
        const status = sourceNode.data('status');
        sourceNode.style({
            'border-color': status !== 'false' ? '#28a745' : '#dc3545',
            'border-style': status !== 'false' ? 'solid' : 'dashed',
            'border-width': 3
        });
    }
    sourceNode = null;
    document.body.style.cursor = 'default';
    const inf = document.getElementById('linkInfo');
    if (inf) inf.remove();
}

function startLinkMode() {
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

function saveLayout() {
    alert('ℹ️ Координаты сохраняются автоматически при перетаскивании');
}