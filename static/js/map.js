// ============================================================================
// LinkVision - Карта сети (ФИНАЛЬНАЯ ВЕРСИЯ С ОБРАБОТКОЙ ОШИБОК)
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
let elementsLoaded = false;
let backgroundLoaded = false;

// ============================================================================
// УНИВЕРСАЛЬНАЯ ФУНКЦИЯ ДЛЯ FETCH С ПОВТОРНЫМИ ПОПЫТКАМИ
// ============================================================================
/**
 * Выполняет fetch с повторными попытками при ошибках сети.
 * @param {string} url - URL запроса
 * @param {object} options - опции fetch (method, headers, body и т.д.)
 * @param {number} retries - количество повторных попыток (по умолчанию 3)
 * @param {number} delay - начальная задержка между попытками в мс (по умолчанию 500)
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}, retries = 3, delay = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            // Если ответ успешный, возвращаем его
            return response;
        } catch (error) {
            const isLastAttempt = i === retries - 1;
            if (isLastAttempt) {
                throw error; // пробрасываем ошибку, если попытки кончились
            }
            console.warn(`⚠️ fetch failed (attempt ${i+1}/${retries}), retrying in ${delay}ms...`, error);
            await new Promise(resolve => setTimeout(resolve, delay));
            // Увеличиваем задержку для следующей попытки (экспоненциально)
            delay *= 2;
        }
    }
}

// ============================================================================
// ПУЛЬСАЦИЯ КРАСНЫХ УЗЛОВ
// ============================================================================
let pulsingNodes = new Set();         // множество id красных узлов
let pulsingInterval = null;           // общий интервал
let pulsePhase = 0;                    // фаза для плавного изменения (0..1)
const pulseStep = 0.015;               // шаг изменения фазы
const pulseMinOpacity = 0.15;           // мин. прозрачность overlay
const pulseMaxOpacity = 0.4;            // макс. прозрачность overlay

// Запуск пульсации для красного узла
function addPulsingNode(node) {
    const nodeId = node.id();
    if (!pulsingNodes.has(nodeId)) {
        pulsingNodes.add(nodeId);
        // Если интервал ещё не запущен, запускаем
        if (!pulsingInterval) {
            pulsePhase = 0;
            pulsingInterval = setInterval(() => {
                // Обновляем фазу
                pulsePhase += pulseStep;
                if (pulsePhase > 1) pulsePhase -= 2; // будем использовать sin
                // Вычисляем текущую прозрачность по синусоиде
                const opacity = pulseMinOpacity + (pulseMaxOpacity - pulseMinOpacity) * (0.5 + 0.5 * Math.sin(pulsePhase * Math.PI));
                // Применяем ко всем красным узлам
                pulsingNodes.forEach(id => {
                    const n = cy.getElementById(id);
                    if (n.length) {
                        n.style('overlay-opacity', opacity);
                    }
                });
            }, 50); // ~20 кадров/сек, достаточно плавно
        }
    }
}

// Удаление красного узла из пульсации
function removePulsingNode(node) {
    const nodeId = node.id();
    if (pulsingNodes.has(nodeId)) {
        pulsingNodes.delete(nodeId);
        node.style('overlay-opacity', null); // сброс к стилевому значению (0.15)
        if (pulsingNodes.size === 0 && pulsingInterval) {
            clearInterval(pulsingInterval);
            pulsingInterval = null;
        }
    }
}

// Очистка всех пульсаций (при перезагрузке карты)
function clearAllPulsing() {
    if (pulsingInterval) {
        clearInterval(pulsingInterval);
        pulsingInterval = null;
    }
    pulsingNodes.clear();
}

// Функция обновления счётчика DOWN в сайдбаре
function updateSidebarCounter(mapId, becameDown) {
    const mapLink = document.querySelector(`.map-item[href="/map/${mapId}"]`);
    if (!mapLink) return;

    let badge = mapLink.querySelector('.badge');
    let currentCount = badge ? parseInt(badge.textContent) : 0;

    if (becameDown) {
        currentCount++;
    } else {
        currentCount--;
    }

    if (currentCount <= 0) {
        if (badge) badge.remove();
    } else {
        if (badge) {
            badge.textContent = currentCount;
        } else {
            badge = document.createElement('span');
            badge.className = 'badge bg-danger ms-2';
            badge.textContent = currentCount;
            const nameSpan = mapLink.querySelector('.map-item-name');
            if (nameSpan) {
                nameSpan.insertAdjacentElement('afterend', badge);
            } else {
                mapLink.appendChild(badge);
            }
        }
    }
}

function getMapId() {
    return window.currentMapId;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

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
    console.log('📐 Изображение подогнано:', zoom.toFixed(2), 'pan:', panX.toFixed(0), panY.toFixed(0));
}

function checkReadyAndFit() {
    if (backgroundLoaded && elementsLoaded && !pendingFit) {
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

function initMap(mapId) {
    console.log('🗺️ Инициализация карты:', mapId);
    const MAX_RECONNECT_ATTEMPTS = 5;

    if (!socket) {
        socket = io({
            reconnection: true,
            reconnectionDelay: 5000,
            reconnectionDelayMax: 10000,
            reconnectionAttempts: MAX_RECONNECT_ATTEMPTS
        });

        socket.on('connect_error', (error) => {
            console.error('❌ Socket connection error:', error);
        });

        socket.on('disconnect', (reason) => {
            console.warn('⚠️ Socket disconnected:', reason);
            setTimeout(() => {
                console.log('🔄 Попытка переподключения...');
                socket.connect();
            }, 3000);
        });

        socket.on('reconnect', (attemptNumber) => {
            console.log('✅ Socket reconnected after', attemptNumber, 'attempts');
            socket.emit('join_room', `map_${mapId}`);
        });
    }

    socket.onAny((event, ...args) => {
        console.log(`📨 Событие сокета: ${event}`, args);
    });

    socket.on('connect', () => {
        console.log('✅ Socket connected');
        const roomName = `map_${mapId}`;
        console.log('🚪 Присоединяемся к комнате:', roomName);
        socket.emit('join_room', roomName);
    });

    socket.on('device_status', (data) => {
        console.log('📡 [RAW] device_status получен:', data);

        if (Number(data.map_id) !== Number(mapId)) {
            console.log('⏭️ Событие для другой карты, игнорируем');
            return;
        }

        if (!cy) {
            console.log('⏭️ Cytoscape ещё не инициализирован');
            return;
        }

        const node = cy.getElementById(String(data.id));
        if (!node.length) {
            console.log(`⚠️ Узел с id ${data.id} не найден на карте`);
            return;
        }

        try {
            const statusValue = data.status === 'true' ? 'true' : 'false';
            const oldStatus = node.data('status');

            console.log(`🔄 Узел: ${node.data('name')} (id=${data.id})`);
            console.log(`   Старый статус: ${oldStatus}, новый: ${statusValue}`);

            if (oldStatus === statusValue) {
                console.log('   Статус не изменился, пропускаем обновление');
                return;
            }

            node.data('status', statusValue);

            // Управление пульсацией
            if (statusValue === 'false') {
                addPulsingNode(node);
            } else {
                removePulsingNode(node);
            }

            cy.style().update();

            // Обновляем счётчик в сайдбаре
            const becameDown = (statusValue === 'false');
            updateSidebarCounter(data.map_id, becameDown);

            const computedBorderColor = node.style('border-color');
            console.log(`   Применённый border-color: ${computedBorderColor}`);

            console.log('✅ Статус успешно обновлён');
        } catch (e) {
            console.error('❌ Ошибка в обработчике device_status:', e);
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
                    // БЕЗ overlay
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
                    'overlay-opacity': 0.15,          // базовое значение, будет меняться пульсацией
                    'overlay-padding': '4px'           // компактное свечение
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
                    // без overlay
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

    cy.on('pan zoom', () => {
        updateBackgroundTransform();
        enforcePanBounds();
        saveViewportToServer();
    });

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
            }).catch(err => {
                console.error('Ошибка при сохранении позиции:', err);
            });
        }, 500);
    });

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
                    }).catch(err => {
                        console.error('Ошибка при сохранении позиции:', err);
                    });
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
        const validNodes = data.nodes.filter(n => n.data && n.data.id);
        const validEdges = data.edges.filter(e =>
            e.data && e.data.source && e.data.target &&
            e.data.source !== 'None' && e.data.target !== 'None'
        );
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

            // Запускаем пульсацию для всех красных узлов
            cy.nodes().forEach(node => {
                if (node.data('status') === 'false') {
                    addPulsingNode(node);
                }
            });
        });
        layout.run();
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
    .catch(err => console.error('❌ Ошибка типов:', err));
}

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
        }).catch(err => {
            console.error('Ошибка сохранения viewport:', err);
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

function pulseNode(node) {
    if (!node) return;
    node.style({
        'overlay-color': '#ffff00',
        'overlay-opacity': 0.6,
        'overlay-padding': '10px'
    });
    setTimeout(() => {
        node.style({
            'overlay-opacity': 0,
            'overlay-padding': '0px'
        });
    }, 200);
}

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
        .catch(err => console.error('Ошибка загрузки данных устройства:', err));
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
        })
        .then(res => res.ok ? (deviceModal?.hide(), location.reload()) : alert('❌ Ошибка'))
        .catch(err => {
            console.error('Ошибка при сохранении устройства:', err);
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
            console.error('Ошибка при создании устройства:', err);
            alert('❌ Ошибка сети при создании');
        });
    }
}

function deleteDevice(id) {
    if (confirm('⚠️ Удалить?')) {
        fetch(`/api/device/${id}`, { method: 'DELETE' })
        .then(res => res.ok ? (deviceModal?.hide(), location.reload()) : alert('❌ Ошибка'))
        .catch(err => {
            console.error('Ошибка при удалении устройства:', err);
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
    .catch(err => {
        console.error('Ошибка создания связи:', err);
        alert('❌ Ошибка: ' + err.message);
    });
}

function updateLink(linkId, srcIface, tgtIface) {
    const numericId = linkId.replace('link_', '');
    fetch(`/api/link/${numericId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_interface: srcIface, target_interface: tgtIface })
    })
    .then(res => res.ok ? location.reload() : alert('❌ Ошибка'))
    .catch(err => {
        console.error('Ошибка обновления связи:', err);
        alert('❌ Ошибка сети при обновлении');
    });
}

function deleteLink(linkId) {
    if (!confirm('⚠️ Удалить эту связь?')) return;
    const numericId = String(linkId).replace('link_', '');
    fetch(`/api/link/${numericId}`, { method: 'DELETE' })
    .then(res => res.ok ? location.reload() : alert('❌ Ошибка'))
    .catch(err => {
        console.error('Ошибка удаления связи:', err);
        alert('❌ Ошибка сети при удалении');
    });
}

function resetLinkMode() {
    linkMode = false;
    if (sourceNode && cy) {
        sourceNode.style({});
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