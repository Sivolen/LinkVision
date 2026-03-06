// ============================================================================
// WebNetMap Pro - Карта сети (ФИНАЛЬНАЯ ВЕРСИЯ С МОДАЛКАМИ)
// ============================================================================

// Глобальные переменные
let cy = null;
let deviceModal = null;
let linkModal = null;
let linkMode = false;
let sourceNode = null;
let socket = null;
let dragTimeout = null;

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
    });

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

    cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [],

        style: [
            {
                selector: 'node[iconUrl][iconUrl != ""]',
                style: {
                    'shape': 'round-rectangle',
                    'width': 54,
                    'height': 54,
                    'background-color': 'rgba(255, 255, 255, 0.95)',
                    'background-image': 'data(iconUrl)',
                    'background-fit': 'contain',
                    'background-clip': 'node',
                    'background-opacity': 1,
                    'border-width': 3,
                    'border-color': '#28a745',
                    'border-style': 'solid',
                    'label': 'data(label)',
                    'text-valign': 'bottom',
                    'text-margin-y': 8,
                    'font-size': '10px',
                    'text-wrap': 'wrap',
                    'text-max-width': '80px',
                    'color': '#333',
                    'text-outline-color': '#fff',
                    'text-outline-width': 1
                }
            },
            {
                selector: 'node[iconUrl][iconUrl != ""][status = "false"]',
                style: {
                    'border-color': '#dc3545',
                    'border-style': 'dashed',
                    'opacity': 0.85
                }
            },
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
            {
                selector: 'node:selected',
                style: {
                    'border-color': '#007bff',
                    'border-width': 5,
                    'background-color': 'rgba(0,123,255,0.2)'
                }
            },
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

        layout: { name: 'preset' },
        boxSelectionEnabled: true,
        minZoom: 0.25,
        maxZoom: 4
    });

    // === Инициализация модальных окон ===
    const deviceModalEl = document.getElementById('deviceModal');
    if (deviceModalEl && !deviceModal) {
        deviceModal = new bootstrap.Modal(deviceModalEl);
    }

    const linkModalEl = document.getElementById('linkModal');
    if (linkModalEl && !linkModal) {
        linkModal = new bootstrap.Modal(linkModalEl);

        // Обновление превью при вводе
        ['link_src_iface', 'link_tgt_iface'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', updateLinkPreview);
        });
    }

    loadElements();
    loadDeviceTypes();

    // === Drag & Drop ===
    cy.on('dragfree', 'node', function(evt) {
        const node = evt.target;
        const pos = node.position();
        clearTimeout(dragTimeout);
        dragTimeout = setTimeout(() => {
            fetch(`/api/device/${node.id()}/position`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({x: pos.x, y: pos.y})
            }).catch(err => console.error('Save position error:', err));
        }, 500);
    });

    // === Клик по узлу ===
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

        openDeviceModal(node);
    });

    // === Клик по связи (редактирование) ===
    cy.on('tap', 'edge', function(evt){
        if (!linkMode) {
            const edge = evt.target;
            openLinkModalForEdit(edge);
        }
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
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(types => {
            const select = document.getElementById('dev_type');
            if (select) {
                select.innerHTML = '<option value="">-- Выберите тип --</option>';
                types.forEach(t => {
                    const option = document.createElement('option');
                    option.value = t.id;
                    option.text = t.name;
                    select.appendChild(option);
                });
            }
        })
        .catch(err => console.error('Error loading types:', err));
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
        body.x = cy ? cy.width()/2 : 100;
        body.y = cy ? cy.height()/2 : 100;

        fetch('/api/device', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
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
    // Сброс формы для новой связи
    document.getElementById('link_id').value = '';
    document.getElementById('link_source').value = sourceId;
    document.getElementById('link_target').value = targetId;
    document.getElementById('link_src_iface').value = 'eth0';
    document.getElementById('link_tgt_iface').value = 'eth0';

    // Обновляем заголовок и кнопки
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

    // Заполняем форму данными связи
    document.getElementById('link_id').value = data.id;
    document.getElementById('link_source').value = data.source;
    document.getElementById('link_target').value = data.target;

    // Парсим интерфейсы из подписи (формат: "src↔tgt")
    const labelParts = (data.label || 'eth0↔eth0').split('↔');
    document.getElementById('link_src_iface').value = labelParts[0] || 'eth0';
    document.getElementById('link_tgt_iface').value = labelParts[1] || 'eth0';

    // Обновляем заголовок и кнопки
    document.getElementById('linkModalTitle').textContent = 'Редактировать связь';
    document.getElementById('linkDeleteBtn').style.display = 'inline-block';

    // Сохраняем ссылку на ребро для удаления
    document.getElementById('linkDeleteBtn').onclick = () => deleteLink(data.id);

    updateLinkPreview();

    if (linkModal) {
        linkModal.show();
    }
}

// ============================================================================
// СОХРАНЕНИЕ СВЯЗИ (создание или обновление)
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
        // Обновление существующей связи
        updateLink(linkId, srcIface, tgtIface);
    } else {
        // Создание новой связи
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
            cy.add({
                group: 'edges',
                data: {
                    id: `link_${data.id}`,
                    source: String(sourceId),
                    target: String(targetId),
                    label: `${srcIface}↔${tgtIface}`
                }
            });
            cy.layout({name: 'preset'}).run();
            resetLinkMode();
        }
    })
    .catch(err => {
        console.error('❌ Link error:', err);
        alert('❌ Ошибка: ' + err.message);
    });
}

// ============================================================================
// ОБНОВЛЕНИЕ СУЩЕСТВУЮЩЕЙ СВЯЗИ
// ============================================================================
function updateLink(linkId, srcIface, tgtIface) {
    // Извлекаем числовой ID из строки "link_123"
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
            // Обновляем подпись на карте
            const edge = cy.getElementById(linkId);
            if (edge.length) {
                edge.data('label', `${srcIface}↔${tgtIface}`);
            }
            location.reload(); // Перезагружаем для надёжности
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
// ============================================================================
// УДАЛЕНИЕ СВЯЗИ (исправлено)
// ============================================================================
function deleteLink(linkId) {
    if (!confirm('⚠️ Удалить эту связь?')) return;

    // Извлекаем числовой ID (убираем префикс "link_" если есть)
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
            // ✅ Удаляем ребро из Cytoscape по нескольким возможным ID
            const edgeIds = [
                `link_${numericId}`,  // Наш формат
                numericId,            // На случай если ID без префикса
                String(numericId)     // На всякий случай как строка
            ];

            let removed = false;
            for (const eid of edgeIds) {
                const edge = cy.getElementById(eid);
                if (edge.length) {
                    edge.remove();
                    console.log(`🎨 Edge removed from cytoscape: ${eid}`);
                    removed = true;
                    break;
                }
            }

            if (!removed) {
                console.warn('⚠️ Edge not found in cytoscape, reloading...');
                // Если не нашли — перезагружаем карту
                location.reload();
            }
        }

        // ✅ Закрываем модальное окно
        if (linkModal) {
            linkModal.hide();
        }

        // ✅ Сбрасываем режим связи если был активен
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

function saveLayout() {
    alert('ℹ️ Координаты сохраняются автоматически');
}