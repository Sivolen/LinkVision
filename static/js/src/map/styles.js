// styles.js – стили Cytoscape.
// Цвета подписей/групп зависят от темы и заданы ФУНКЦИЯМИ: они заново
// вычисляются при cy.style().update(), который core.js вызывает при смене
// data-theme. Статических значений вида `isDarkTheme() ? a : b` (они
// вычислялись один раз при создании карты и не менялись при переключении
// темы) здесь быть не должно.
// Подписи УСТРОЙСТВ рисует HTML-слой (deviceLabels.js + .lv-dev-label в
// style.css); правила label в этом файле — запасной вариант на случай, если
// слой не создан (класс lv-html-label гасит нативную подпись).
const isDarkTheme = () => document.documentElement.getAttribute('data-theme') === 'dark';

// Единая палитра: светлая и тёмная темы. Геометрия (размеры, отступы) от темы не зависит.
const PALETTE = {
    light: {
        text: '#172033',
        labelBg: '#ffffff',
        labelBorder: '#d9e1ec',
        edgeText: '#52627a',
        edgeBg: '#ffffff',
        edgeBorder: '#d5deea',
        edgeSelectedBg: '#e7f3ff',
        shapeBorder: '#94a3b8',
        groupMixTarget: null,        // цвет группы берём как есть
        groupMixRatio: 1,
        groupFillOpacity: 0.14,
        groupBorderOpacity: 0.5
    },
    dark: {
        text: '#f1f5f9',
        labelBg: '#252d3a',
        labelBorder: '#3a465a',
        edgeText: '#c4d0e0',
        edgeBg: '#1d2634',
        edgeBorder: '#3a4a61',
        edgeSelectedBg: '#243b52',
        shapeBorder: '#64748b',
        groupMixTarget: [148, 163, 184], // нейтральный серо-голубой
        groupMixRatio: 0.4,              // доля исходного цвета группы
        groupFillOpacity: 0.12,
        groupBorderOpacity: 0.6
    }
};
const themed = key => () => (isDarkTheme() ? PALETTE.dark : PALETTE.light)[key];
const palette = () => (isDarkTheme() ? PALETTE.dark : PALETTE.light);

function parseColor(value) {
    const text = String(value || '').trim();
    let m = /^#([0-9a-f]{3})$/i.exec(text);
    if (m) return m[1].split('').map(ch => parseInt(ch + ch, 16));
    m = /^#([0-9a-f]{6})$/i.exec(text);
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(text);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return null;
}

// Цвет группы с учётом темы. В тёмной теме пользовательский цвет подмешивается
// к нейтральному серо-голубому — без этого жёлтый/оранжевый цвет группы при
// малой прозрачности даёт грязно-коричневую заливку на графитовом фоне.
function groupColor(node) {
    const raw = node.data('color');
    const rgb = parseColor(raw);
    const p = palette();
    if (!rgb) return raw || '#3498db';
    if (!p.groupMixTarget) return `rgb(${rgb.join(',')})`;
    const mixed = rgb.map((c, i) => Math.round(c * p.groupMixRatio + p.groupMixTarget[i] * (1 - p.groupMixRatio)));
    return `rgb(${mixed.join(',')})`;
}

const deviceLabelMaxWidth = node => {
    const name = String(node.data('name') || '');
    return `${Math.max(92, Math.min(220, name.length * 6.7 + 16))}px`;
};

// Общая часть нативной подписи (запасной вариант) для узлов-устройств.
const nativeDeviceLabel = {
    'label': function(node) {
        return node.data('name') + '\n' + (node.data('ip') || '');
    },
    'text-wrap': 'wrap',
    'text-max-width': deviceLabelMaxWidth,
    'font-weight': 'bold',
    'color': themed('text'),
    'text-background-color': themed('labelBg'),
    'text-background-opacity': 0.97,
    'text-background-padding': '5px',
    'text-background-shape': 'roundrectangle',
    'text-border-color': themed('labelBorder'),
    'text-border-width': 1,
    'text-border-opacity': 1,
    'text-outline-width': 0
};

// Общая часть подписи рёбер: компактная контрастная «пилюля».
const edgeLabelStyle = {
    'color': themed('edgeText'),
    'text-background-color': themed('edgeBg'),
    'text-background-opacity': 0.96,
    'text-background-padding': '3px',
    'text-background-shape': 'roundrectangle',
    'text-border-color': themed('edgeBorder'),
    'text-border-width': 1,
    'text-border-opacity': 1,
    'text-outline-width': 0
};

export const CY_STYLE = [
    {
        selector: 'node',
        style: {
            'transition-property': 'border-color, border-width',
            'transition-duration': '0.15s'
        }
    },
    {
        selector: 'edge',
        style: {
            'transition-property': 'line-color, width',
            'transition-duration': '0.2s'
        }
    },
    // Узлы с иконкой
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
            ...nativeDeviceLabel,
            'text-valign': 'bottom',
            'text-margin-y': 8,
            'font-size': function(node) { return (node.data('fontSize') || 11) + 'px'; }
        }
    },
    // Узлы с иконкой: статус UP
    {
        selector: 'node[iconUrl][iconUrl != ""][status="up"]',
        style: {
            'border-color': '#28a745',
            'border-style': 'solid',
            'border-width': 3,
            'opacity': 1
        }
    },
    // Узлы с иконкой: статус DOWN
    {
        selector: 'node[iconUrl][iconUrl != ""][status="down"]',
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
    // Узлы с иконкой: статус PARTIAL
    {
        selector: 'node[iconUrl][iconUrl != ""][status="partial"]',
        style: {
            'border-color': '#ffc107',
            'border-style': 'solid',
            'border-width': 3,
            'opacity': 1,
            'overlay-color': '#ffc107',
            'overlay-opacity': 0.2,
            'overlay-padding': '4px'
        }
    },
    // Узлы БЕЗ иконки: статус UP
    {
        selector: 'node[!iconUrl][status="up"], node[iconUrl=""][status="up"]',
        style: {
            'shape': 'round-rectangle',
            'width': 60,
            'height': 60,
            'background-color': '#d4edda',
            'border-width': 3,
            'border-color': '#28a745',
            'border-style': 'solid',
            ...nativeDeviceLabel,
            'font-size': function(node) { return (node.data('fontSize') || 10) + 'px'; },
            'text-valign': 'center',
            'text-halign': 'center'
        }
    },
    // Узлы БЕЗ иконки: статус DOWN
    {
        selector: 'node[!iconUrl][status="down"], node[iconUrl=""][status="down"]',
        style: {
            'shape': 'round-rectangle',
            'width': 60,
            'height': 60,
            'background-color': '#f8d7da',
            'border-width': 3,
            'border-color': '#dc3545',
            'border-style': 'dashed',
            ...nativeDeviceLabel,
            'font-size': function(node) { return (node.data('fontSize') || 10) + 'px'; },
            'text-valign': 'center',
            'text-halign': 'center',
            'opacity': 0.9,
            'overlay-color': '#dc3545',
            'overlay-opacity': 0.15,
            'overlay-padding': '4px'
        }
    },
    // Узлы БЕЗ иконки: статус PARTIAL
    {
        selector: 'node[!iconUrl][status="partial"], node[iconUrl=""][status="partial"]',
        style: {
            'shape': 'round-rectangle',
            'width': 60,
            'height': 60,
            'background-color': '#fff3cd',
            'border-width': 3,
            'border-color': '#ffc107',
            'border-style': 'solid',
            ...nativeDeviceLabel,
            'font-size': function(node) { return (node.data('fontSize') || 10) + 'px'; },
            'text-valign': 'center',
            'text-halign': 'center',
            'opacity': 0.9,
            'overlay-color': '#ffc107',
            'overlay-opacity': 0.2,
            'overlay-padding': '4px'
        }
    },
    // Плохое качество ICMP: down/partial имеют приоритет.
    { selector: 'node[quality_status="bad"][status="up"]', style: {
        'border-color': '#6f42c1', 'border-style': 'solid', 'border-width': 4,
        'overlay-color': '#6f42c1', 'overlay-opacity': 0.18, 'overlay-padding': '4px'
    } },
    { selector: 'node[quality_status="degraded"][status="up"]', style: {
        'border-color': '#fd7e14', 'border-style': 'solid', 'border-width': 3,
        'overlay-color': '#fd7e14', 'overlay-opacity': 0.12, 'overlay-padding': '3px'
    } },
    // Temporary underlay leaves status borders, monitoring overlays, and selection intact.
    {
        selector: 'node.cy-node-created',
        style: {
            'underlay-color': '#f59e0b',
            'underlay-opacity': 0.72,
            'underlay-padding': '10px'
        }
    },
    // Выделенный узел — overlay вместо border-width, чтобы не менять bounding box
    {
        selector: 'node:selected, node[selected]',
        style: {
            'overlay-color': '#007bff',
            'overlay-opacity': 0.25,
            'overlay-padding': '4px',
            'border-color': '#007bff',
            'background-color': 'rgba(0,123,255,0.1)',
            'z-index': 20
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
        selector: '.cy-link-source',
        style: {
            'overlay-color': '#007bff',
            'overlay-opacity': 0.25,
            'overlay-padding': '4px',
            'border-color': '#007bff',
            'z-index': 15
        }
    },
    // Область группы: полупрозрачная заливка, тонкая пунктирная граница, заголовок-«пилюля».
    {
        selector: 'node[isGroup]',
        style: {
            'shape': 'rectangle',
            'background-color': groupColor,
            'background-opacity': themed('groupFillOpacity'),
            'border-color': groupColor,
            'border-width': 1,
            'border-opacity': themed('groupBorderOpacity'),
            'border-style': 'dashed',
            'label': 'data(name)',
            'font-size': node => node.data('fontSize') + 'px',
            'font-weight': 'bold',
            'text-valign': 'top',
            'text-halign': 'center',
            'padding': '10px',
            'compound-sizing-wrt-labels': 'include',
            'min-width': '80px',
            'min-height': '60px',
            'bounds-expansion': '20',
            'color': themed('text'),
            'text-background-color': themed('labelBg'),
            'text-background-opacity': 0.97,
            'text-background-padding': '5px',
            'text-background-shape': 'roundrectangle',
            'text-border-color': themed('labelBorder'),
            'text-border-width': 1,
            'text-border-opacity': 1,
            'text-outline-width': 0,
            'text-margin-y': 4,
            'z-index': 0
        }
    },
    {
        selector: 'node[isGroup][?collapsed]',
        style: {
            'shape': 'round-rectangle',
            'width': 150,
            'height': 60,
            'border-width': 3,
            'border-color': '#28a745',
            'border-opacity': 1,
            'border-style': 'solid',
            'label': 'data(name)',
            'font-size': '12px',
            'font-weight': 'bold',
            'text-valign': 'center',
            'text-halign': 'center',
            'background-color': groupColor,
            'background-opacity': 0.22
        }
    },
    {
        selector: 'node[isGroup][?collapsed][bubbleStatus="down"]',
        style: {
            'border-color': '#dc3545'
        }
    },
    {
        selector: 'node[isGroup][?collapsed][bubbleStatus="partial"]',
        style: {
            'border-color': '#ffc107'
        }
    },
    {
        selector: 'node[isGroup][?collapsed][bubbleStatus="up"]',
        style: {
            'border-color': '#28a745'
        }
    },
    {
        selector: 'edge[?isCollapseProxy]',
        style: {
            'line-style': 'dashed',
            'width': 2,
            'label': 'data(label)',
            'font-size': '9px',
            ...edgeLabelStyle
        }
    },
    {
        selector: 'node[isGroup]:selected',
        style: {
            'overlay-color': '#007bff',
            'overlay-opacity': 0.25,
            'overlay-padding': '4px'
        }
    },
    {
        selector: 'edge',
        style: {
            'width': function(edge) { return edge.data('width') || 2; },
            'line-color': function(edge) { return edge.data('color') || '#6c757d'; },
            'line-style': function(edge) { return edge.data('style') || 'solid'; },
            'curve-style': 'bezier',
            'control-point-step-size': 40,
            'label': 'data(label)',
            'font-size': function(edge) {
                let size = edge.data('font_size');
                if (size === undefined || size === null) size = 9;
                return size + 'px';
            },
            'text-rotation': 'autorotate',
            'text-margin-y': -8,
            ...edgeLabelStyle
        }
    },
    {
        selector: 'edge:selected',
        style: {
            'width': 4,
            'line-color': '#007bff',
            'text-background-color': themed('edgeSelectedBg'),
            'color': themed('text')
        }
    },
    {
        selector: 'node[monitoring_enabled="false"]',
        style: {
            'border-color': '#6c757d',
            'border-style': 'dotted',
            'border-width': '3px',
            'opacity': '0.7',
            'overlay-opacity': '0'
        }
    },
    {
        selector: 'node[isShape]',
        style: {
            'shape': function(node) {
                const shapeType = node.data('shape_type');
                return shapeType === 'circle' ? 'ellipse' : shapeType;
            },
            'width': 'data(width)',
            'height': 'data(height)',
            'background-color': 'data(color)',
            'background-opacity': 'data(opacity)',
            'border-width': 2,
            'border-color': themed('shapeBorder'),
            'border-opacity': 0.5,
            'label': 'data(label)',
            'text-wrap': 'wrap',
            'text-max-width': function(node) {
                let w = node.data('width');
                if (typeof w === 'string') w = parseFloat(w);
                if (isNaN(w)) w = 100;
                return (w - 10) + 'px';
            },
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': function(node) { return node.data('fontSize') + 'px'; },
            'color': themed('text'),
            'text-background-color': themed('labelBg'),
            'text-background-opacity': 0.94,
            'text-background-padding': '5px',
            'text-background-shape': 'roundrectangle',
            'text-border-color': themed('labelBorder'),
            'text-border-width': 1,
            'text-border-opacity': 1,
            'text-outline-width': 0,
            'z-index': 5
        }
    },
    {
        selector: 'node[isShape]:selected',
        style: {
            'overlay-color': '#007bff',
            'overlay-opacity': 0.25,
            'overlay-padding': '4px',
            'background-color': 'rgba(0,123,255,0.1)'
        }
    },
    {
        selector: 'edge.hl-edge',
        style: { 'line-color': '#f59e0b', 'width': 3 }
    },
    {
        selector: 'node.hl-node',
        style: { 'border-color': '#f59e0b', 'border-width': 3 }
    },
    // ДОЛЖНО идти последним: подпись устройства рисует HTML-слой (deviceLabels.js),
    // нативная гасится. Класс ставится только когда слой реально создан.
    {
        selector: 'node.lv-html-label',
        style: { 'label': '' }
    }
];
