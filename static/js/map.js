// ============================================================================
// WebNetMap Pro - Карта сети (ПОЛНАЯ ВЕРСИЯ С САЙДБАРОМ И ТЁМНОЙ ТЕМОЙ)
// ============================================================================

// Глобальные переменные
let cy = null;
let deviceModal = null;
let linkModal = null;
let linkMode = false;
let sourceNode = null;
let socket = null;
let dragTimeout = null;
let clickTimeout = null;
let currentMode = 'pan'; // 'pan' или 'select'

function getMapId() {
    return window.currentMapId;
}

// ============================================================================
// ИНИЦИАЛИЗАЦИЯ КАРТЫ
// ============================================================================
function initMap(mapId) {
    console.log('🗺️ Инициализация карты:', mapId);

    if (!socket) {
        socket = io();
    }

    socket.on('connect', () => {
        socket.emit('join_room', `map_${mapId}`);
        console.log('📡 Connected to room:', `map_${mapId}`);
    });
    // Установка фона
    const cyEl = document.getElementById('cy');
    const initialBg = cyEl.getAttribute('data-background');
    applyMapBackground(initialBg);
    // === Обновление статуса через WebSocket ===
    socket.on('device_status', (data) => {
        if (data.map_id === mapId && cy) {
            const node = cy.getElementById(String(data.id));
            if (node.length) {
                const statusStr = data.status ? 'true' : 'false';
                node.data('status', statusStr);

                if (node.data('iconUrl')) {
                    node.style({
                        'border-color': data.status ? '#28a745' : '#dc3545',
                        'border-style': data.status ? 'solid' : 'dashed'
                    });
                } else {
                    node.style({
                        'background-color': data.status ? '#d4edda' : '#f8d7da',
                        'border-color': data.status ? '#28a745' : '#dc3545'
                    });
                }
            }
        }
    });

    // === Cytoscape инициализация ===
    cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [],
        // === СТИЛИ ===
        style: [
            // === УЗЛЫ С ИКОНКОЙ ===
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
                    'label': 'data(label)',
                    'text-valign': 'bottom',
                    'text-margin-y': 8,
                    'font-size': '10px',
                    'text-wrap': 'wrap',
                    'text-max-width': '80px',
                    'color': '#000000',                          // чёрный текст
                    'text-background-color': '#ffffff',          // белый фон
                    'text-background-opacity': 0.7,              // полупрозрачный
                    'text-background-padding': '2px',             // отступы
                    'text-background-shape': 'roundrectangle'     // скруглённые углы
                }
            },
            // === УЗЛЫ С ИКОНКОЙ + СТАТУС DOWN ===
            {
                selector: 'node[iconUrl][iconUrl != ""][status = "false"]',
                style: {
                    'border-color': '#dc3545',
                    'border-style': 'dashed',
                    'opacity': 0.85
                }
            },
            // === УЗЛЫ БЕЗ ИКОНКИ + СТАТУС UP ===
            {
                selector: 'node[!iconUrl][status = "true"], node[iconUrl = ""][status = "true"]',
                style: {
                    'shape': 'round-rectangle',
                    'width': 50,
                    'height': 50,
                    'background-color': '#d4edda',
                    'background-image': 'none',
                    'border-width': 3,
                    'border-color': '#28a745',
                    'border-style': 'solid',
                    'label': 'data(name)',
                    'color': '#155724',
                    'font-weight': 'bold'
                }
            },
            // === УЗЛЫ БЕЗ ИКОНКИ + СТАТУС DOWN ===
            {
                selector: 'node[!iconUrl][status = "false"], node[iconUrl = ""][status = "false"]',
                style: {
                    'shape': 'round-rectangle',
                    'width': 50,
                    'height': 50,
                    'background-color': '#f8d7da',
                    'background-image': 'none',
                    'border-width': 3,
                    'border-color': '#dc3545',
                    'border-style': 'dashed',
                    'label': 'data(name)',
                    'color': '#721c24',
                    'font-weight': 'bold',
                    'opacity': 0.9
                }
            },
            // === ВЫДЕЛЕНИЕ ===
            {
                selector: 'node:selected',
                style: {
                    'border-color': '#007bff',
                    'border-width': 5,
                    'background-color': 'rgba(0,123,255,0.1)',
                    'overlay-padding': '0px',
                    'overlay-opacity': 0.1
                }
            },
            // === СВЯЗИ ===
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': '#6c757d',
                    'target-arrow-shape': 'none',
                    'source-arrow-shape': 'none',
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

        // === НАСТРОЙКИ ===
        layout: { name: 'preset' },
        boxSelectionEnabled: false, // Включается в режиме select
        autounselectify: true,
        minZoom: 0.25,
        maxZoom: 4,
        wheelSensitivity: 0.5,  // уменьшаем чувствительность колеса
    });
    // Сохранение позиции камеры
    cy.on('pan zoom', saveViewport);
    // === Инициализация модальных окон ===
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

    // === Загрузка элементов ===
    loadElements();
    loadDeviceTypes();

    // === Drag & Drop для одиночных устройств ===
    cy.on('dragfree', 'node', function(evt) {
        const node = evt.target;
        const pos = node.position();
        clearTimeout(dragTimeout);
        dragTimeout = setTimeout(() => {
            console.log(`📤 Сохраняю позицию узла ${node.id()} (карта ${getMapId()}): x=${pos.x}, y=${pos.y}`);
            fetch(`/api/device/${node.id()}/position`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({x: pos.x, y: pos.y})
            })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status} - ${res.statusText}`);
                return res.json();
            })
            .then(data => console.log('✅ Позиция сохранена:', data))
            .catch(err => console.error('❌ Ошибка сохранения позиции:', err.message));
        }, 500);
    });

    // === Перемещение выделенной группы устройств ===
    cy.on('dragfree', 'node:selected', function(evt) {
        const selectedNodes = cy.nodes(':selected');
        if (selectedNodes.length <= 1) return; // Если одно - обрабатывается выше

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
                    fetch(`/api/device/${node.id()}/position`, {
                        method: 'PUT',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            x: nodePos.x + deltaX,
                            y: nodePos.y + deltaY
                        })
                    }).catch(err => console.error('Save position error:', err));
                }
            });
        }, 500);
    });

    // === Сохранение позиции перед перетаскиванием ===
    cy.on('drag', 'node', function(evt) {
        evt.target._private.scratch._dragStartPos = evt.target.position();
    });

    // === Клик по узлу (ОДИНАРНЫЙ = выделение, ДВОЙНОЙ = редактирование) ===
    cy.on('tap', 'node', function(evt){
        const node = evt.target;

        if (linkMode) {
            evt.stopPropagation();

            if (!sourceNode) {
                sourceNode = node;
                sourceNode.style('border-color', '#007bff');
                sourceNode.style('border-width', 5);

                const linkInfo = document.getElementById('linkInfo');
                if (linkInfo) {
                    linkInfo.textContent = `✅ Источник: ${node.data('name')}\n👆 Выберите второе устройство`;
                    linkInfo.className = 'alert alert-warning position-fixed';
                }
            } else if (sourceNode.id() !== node.id()) {
                openLinkModal(sourceNode.id(), node.id());
            }
            return;
        }

        // Одинарный клик - выделение
        if (currentMode !== 'select') {
            cy.nodes().selected(false);
        }
        node.selected(true);
    });

    // === Двойной клик по узлу - редактирование ===
    cy.on('dbltap', 'node', function(evt){
        openDeviceModal(evt.target);
    });

    // === Клик по связи (ОДИНАРНЫЙ = выделение, ДВОЙНОЙ = редактирование) ===
    cy.on('tap', 'edge', function(evt){
        const edge = evt.target;
        if (currentMode !== 'select') {
            cy.edges().selected(false);
        }
        edge.selected(true);
    });

    // === Двойной клик по связи - редактирование ===
    cy.on('dbltap', 'edge', function(evt){
        openLinkModalForEdit(evt.target);
    });

    // === Клик по фону ===
    cy.on('tap', function(event){
        if (event.target === cy && linkMode) {
            resetLinkMode();
        }
        if (event.target === cy) {
            cy.elements().deselect();
        }
    });

    // === Инициализация режима ===
    setMode('pan');

    console.log('✅ Карта инициализирована');
}

// ============================================================================
// ЗАГРУЗКА ЭЛЕМЕНТОВ
// ============================================================================
function loadElements() {
    const mapId = getMapId();

    fetch(`/api/map/${mapId}/elements`)
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then(data => {
            if (cy) {
                const validNodes = data.nodes.filter(n => n.data && n.data.id);
                const validEdges = data.edges.filter(e =>
                    e.data && e.data.source && e.data.target &&
                    e.data.source !== 'None' && e.data.target !== 'None'
                );

                console.log(`📊 Загружено: ${validNodes.length} устройств, ${validEdges.length} связей`);

                cy.add(validNodes);
                cy.add(validEdges);
                cy.layout({name: 'preset'}).run();

                // === ВОССТАНОВЛЕНИЕ VIEWPORT ИЗ DATA-АТРИБУТОВ ===
                const cyEl = document.getElementById('cy');
                const panX = parseFloat(cyEl.dataset.panX) || 0;
                const panY = parseFloat(cyEl.dataset.panY) || 0;
                const zoom = parseFloat(cyEl.dataset.zoom) || 1;
                cy.viewport({ pan: { x: panX, y: panY }, zoom: zoom });
                console.log(`🖼️ Восстановлен viewport: pan=(${panX}, ${panY}), zoom=${zoom}`);

                // Загрузка иконок (без изменений)
                validNodes.forEach(n => {
                    if (n.data.iconUrl && n.data.iconUrl !== '') {
                        const img = new Image();
                        img.onload = () => console.log(`✅ Иконка: ${n.data.name}`);
                        img.onerror = () => {
                            console.warn(`❌ Иконка не загрузилась: ${n.data.iconUrl}`);
                            const node = cy.getElementById(n.data.id);
                            if (node.length) {
                                node.style({
                                    'background-color': '#e9ecef',
                                    'background-image': ''
                                });
                            }
                        };
                        img.src = n.data.iconUrl;
                    }
                });
            }
        })
        .catch(err => {
            console.error('❌ Ошибка загрузки:', err);
            document.getElementById('cy').innerHTML =
                '<div class="alert alert-danger m-3">Ошибка загрузки карты</div>';
        });
}

// ============================================================================
// ЗАГРУЗКА ТИПОВ
// ============================================================================
function loadDeviceTypes() {
    fetch('/api/types')
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status} - ${res.statusText}`);
            return res.json();
        })
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
            console.log('✅ Типы устройств загружены:', types.length);
        })
        .catch(err => {
            console.error('❌ Ошибка загрузки типов:', err.message);
            // Если нужно, покажите сообщение пользователю
            const select = document.getElementById('dev_type');
            if (select) {
                select.innerHTML = '<option value="">Ошибка загрузки типов</option>';
            }
        });
}

// ============================================================================
// МОДАЛЬНОЕ ОКНО УСТРОЙСТВА
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
            .then(data => { if (data && devType) devType.value = data.type_id; })
            .catch(err => console.error('Error:', err));

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
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        }).then(res => res.ok ? (deviceModal?.hide(), location.reload()) : alert('❌ Ошибка'));
    } else {
        body.map_id = getMapId();
        if (cy) {
            const extent = cy.extent();
            body.x = (extent.x1 + extent.x2) / 2;
            body.y = (extent.y1 + extent.y2) / 2;
            console.log(`📍 Новое устройство появится в центре экрана: (${body.x}, ${body.y})`);
        } else {
            body.x = 100;
            body.y = 100;
        }

        fetch('/api/device', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        })
        .then(res => {
            if (res.ok) {
                deviceModal?.hide();
                location.reload();
            } else {
                alert('❌ Ошибка при создании устройства');
            }
        })
        .catch(err => {
            console.error('Ошибка сети:', err);
            alert('❌ Ошибка соединения');
        });
    }
}

function deleteDevice(id) {
    if (confirm('⚠️ Удалить?')) {
        fetch(`/api/device/${id}`, { method: 'DELETE' })
        .then(res => res.ok ? (deviceModal?.hide(), location.reload()) : alert('❌ Ошибка'));
    }
}

// ============================================================================
// ПРЕВЬЮ СВЯЗИ
// ============================================================================
function updateLinkPreview() {
    const src = document.getElementById('link_src_iface')?.value || 'eth0';
    const tgt = document.getElementById('link_tgt_iface')?.value || 'eth0';
    const preview = document.getElementById('link_preview');
    if (preview) preview.textContent = `${src} ↔ ${tgt}`;
}

// ============================================================================
// ОТКРЫТИЕ МОДАЛКИ ДЛЯ НОВОЙ СВЯЗИ
// ============================================================================
function openLinkModal(sourceId, targetId) {
    document.getElementById('link_id').value = '';
    document.getElementById('link_source').value = sourceId;
    document.getElementById('link_target').value = targetId;
    document.getElementById('link_src_iface').value = 'eth0';
    document.getElementById('link_tgt_iface').value = 'eth0';

    document.getElementById('linkModalTitle').textContent = 'Новая связь';
    document.getElementById('linkDeleteBtn').style.display = 'none';

    updateLinkPreview();

    if (linkModal) {
        linkModal.show();
    }
}

// ============================================================================
// ОТКРЫТИЕ МОДАЛКИ ДЛЯ РЕДАКТИРОВАНИЯ СВЯЗИ
// ============================================================================
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

    if (linkModal) {
        linkModal.show();
    }
}

// ============================================================================
// СОХРАНЕНИЕ СВЯЗИ
// ============================================================================
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

// ============================================================================
// СОЗДАНИЕ НОВОЙ СВЯЗИ
// ============================================================================
function createLinkWithInterfaces(src, tgt, srcIface, tgtIface) {
    const sourceId = typeof src === 'number' ? src : parseInt(src);
    const targetId = typeof tgt === 'number' ? tgt : parseInt(tgt);

    console.log(`🔗 Creating link: ${sourceId} -> ${targetId}`);

    if (isNaN(sourceId) || isNaN(targetId)) {
        alert('⚠️ Ошибка: неверные ID');
        return;
    }

    fetch('/api/link', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            map_id: getMapId(),
            source_id: sourceId,
            target_id: targetId,
            src_iface: srcIface,
            tgt_iface: tgtIface
        })
    })
    .then(async res => {
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
        return JSON.parse(text);
    })
    .then(data => {
        console.log('✅ Link created:', data);
        if (data.id && cy) {
            // Сохраняем текущий viewport
            const currentPan = cy.pan();
            const currentZoom = cy.zoom();

            cy.add({
                group: 'edges',
                data: {
                    id: `link_${data.id}`,
                    source: String(sourceId),
                    target: String(targetId),
                    label: `${srcIface}↔${tgtIface}`
                }
            });

            // Восстанавливаем viewport
            cy.viewport({ pan: currentPan, zoom: currentZoom });

            resetLinkMode();
        }
    })
    .catch(err => {
        console.error('❌ Link error:', err);
        alert('❌ Ошибка: ' + err.message);
    });
}

// ============================================================================
// ОБНОВЛЕНИЕ СВЯЗИ
// ============================================================================
function updateLink(linkId, srcIface, tgtIface) {
    const numericId = linkId.startsWith('link_') ? linkId.replace('link_', '') : linkId;

    console.log(`✏️ Updating link ${numericId}: ${srcIface} ↔ ${tgtIface}`);

    fetch(`/api/link/${numericId}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            source_interface: srcIface,
            target_interface: tgtIface
        })
    })
    .then(async res => {
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
        return JSON.parse(text);
    })
    .then(data => {
        console.log('✅ Link updated:', data);
        if (cy) {
            const edge = cy.getElementById(linkId);
            if (edge.length) {
                edge.data('label', `${srcIface}↔${tgtIface}`);
            }
            location.reload();
        }
    })
    .catch(err => {
        console.error('❌ Update error:', err);
        alert('❌ Ошибка обновления: ' + err.message);
    });
}

// ============================================================================
// УДАЛЕНИЕ СВЯЗИ
// ============================================================================
function deleteLink(linkId) {
    if (!confirm('⚠️ Удалить эту связь?')) return;

    const numericId = String(linkId).startsWith('link_')
        ? String(linkId).replace('link_', '')
        : String(linkId);

    console.log(`🗑️ Deleting link ${numericId}`);

    fetch(`/api/link/${numericId}`, { method: 'DELETE' })
    .then(async res => {
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
        return JSON.parse(text);
    })
    .then(data => {
        console.log('✅ Link deleted:', data);

        if (cy) {
            const edgeIds = [
                `link_${numericId}`,
                numericId,
                String(numericId)
            ];

            let removed = false;
            for (const eid of edgeIds) {
                const edge = cy.getElementById(eid);
                if (edge.length) {
                    edge.animate({
                        style: { 'opacity': 0, 'width': 0 },
                        duration: 200
                    }, {
                        complete: function() {
                            edge.remove();
                            console.log(`🎨 Edge removed: ${eid}`);
                        }
                    });
                    removed = true;
                    break;
                }
            }

            if (!removed) {
                console.warn('⚠️ Edge not found in cytoscape, reloading...');
                location.reload();
            }
        }

        if (linkModal) {
            linkModal.hide();
        }

        if (linkMode) {
            resetLinkMode();
        }
    })
    .catch(err => {
        console.error('❌ Delete error:', err);
        alert('❌ Ошибка удаления: ' + err.message);
    });
}

// ============================================================================
// СБРОС РЕЖИМА СВЯЗИ
// ============================================================================
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

// ============================================================================
// ЗАПУСК РЕЖИМА СВЯЗИ
// ============================================================================
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

// ============================================================================
// ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ (ПАН / ВЫДЕЛЕНИЕ)
// ============================================================================
// ============================================================================
// ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ (исправлено)
// ============================================================================
function setMode(mode) {
    currentMode = mode;

    // Обновляем визуальное состояние кнопок
    const panBtn = document.getElementById('panMode');
    const selectBtn = document.getElementById('selectMode');

    if (panBtn) panBtn.classList.toggle('active', mode === 'pan');
    if (selectBtn) selectBtn.classList.toggle('active', mode === 'select');

    if (cy) {
        if (mode === 'select') {
            // Режим выделения: можно рисовать рамку, выделять несколько
            cy.boxSelectionEnabled(true);
            cy.autounselectify(false);
            cy.autolock(false);
            cy.panningEnabled(false);      // отключаем панорамирование, чтобы рамка работала
            cy.userPanningEnabled(false);
            cy.userZoomingEnabled(true);   // зум оставляем
            document.body.style.cursor = 'crosshair';
        } else {
            // Режим пан: только перемещение карты, клик = выделение одного
            cy.boxSelectionEnabled(false);
            cy.autounselectify(true);
            cy.autolock(false);
            cy.panningEnabled(true);       // включаем панорамирование
            cy.userPanningEnabled(true);
            cy.userZoomingEnabled(true);
            document.body.style.cursor = 'default';
        }

        cy.style().update();
    }

    console.log(`🎯 Режим: ${mode}`, {
        boxSelection: cy.boxSelectionEnabled(),
        autounselectify: cy.autounselectify()
    });
}

// ============================================================================
// ZOOM
// ============================================================================
function zoomIn() {
    if (!cy) return;
    cy.zoom({
        level: cy.zoom() * 1.2,
        renderedPosition: { x: cy.width()/2, y: cy.height()/2 }
    });
}

function zoomOut() {
    if (!cy) return;
    cy.zoom({
        level: cy.zoom() * 0.8,
        renderedPosition: { x: cy.width()/2, y: cy.height()/2 }
    });
}

function resetZoom() {
    if (!cy) return;
    cy.fit(null, 50);
}

// ============================================================================
// СОХРАНЕНИЕ
// ============================================================================
function saveLayout() {
    alert('ℹ️ Координаты сохраняются автоматически при перетаскивании');
}
function applyMapBackground(background) {
    const cyEl = document.getElementById('cy');
    if (!cyEl) return;
    if (background) {
        cyEl.style.backgroundImage = `url(/static/uploads/maps/${background}), radial-gradient(var(--cy-grid) 1px, transparent 1px)`;
        cyEl.style.backgroundSize = 'contain, 25px 25px';
        cyEl.style.backgroundPosition = 'center, 0 0';
        cyEl.style.backgroundRepeat = 'no-repeat, repeat';
    } else {
        cyEl.style.backgroundImage = `radial-gradient(var(--cy-grid) 1px, transparent 1px)`;
        cyEl.style.backgroundSize = '25px 25px';
        cyEl.style.backgroundPosition = '0 0';
        cyEl.style.backgroundRepeat = 'repeat';
    }
}

let viewportTimeout = null;
function saveViewport() {
    if (!cy) return;
    const pan = cy.pan();
    const zoom = cy.zoom();
    clearTimeout(viewportTimeout);
    viewportTimeout = setTimeout(() => {
        fetch(`/api/map/${getMapId()}/viewport`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({pan_x: pan.x, pan_y: pan.y, zoom: zoom})
        }).catch(err => console.error('Ошибка сохранения viewport:', err));
    }, 500);
}