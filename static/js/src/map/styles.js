// styles.js – вынесенные стили Cytoscape
// Цвета меток зависят от текущей темы. Функции повторно вычисляются при
// cy.style().update(), который вызывается наблюдателем темы карты.
const isDarkTheme = () => document.documentElement.getAttribute('data-theme') === 'dark';
const labelTextColor = () => isDarkTheme() ? '#f3f6fb' : '#172033';
const labelBackgroundColor = () => isDarkTheme() ? '#28313d' : '#f8fafc';
const edgeLabelTextColor = () => isDarkTheme() ? '#e6edf5' : '#475569';
const edgeLabelBackgroundColor = () => isDarkTheme() ? '#252e39' : '#f8fafc';
const deviceLabelMaxWidth = node => {
    const name = String(node.data('name') || '');
    return `${Math.max(92, Math.min(220, name.length * 6.7 + 16))}px`;
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
            'label': function(node) {
                return node.data('name') + '\n' + (node.data('ip') || '');
            },
            'text-valign': 'bottom',
            'text-margin-y': 8,
            'font-size': function(node) { return (node.data('fontSize') || 11) + 'px'; },
            'font-weight': 'bold',
            'text-wrap': 'wrap',
            'text-max-width': deviceLabelMaxWidth,
            'color': labelTextColor,
            'text-background-color': labelBackgroundColor,
            'text-background-opacity': 0.97,
            'text-background-padding': '4px',
            'text-background-shape': 'roundrectangle',
            'text-outline-color': labelBackgroundColor,
            'text-outline-width': 0.5
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
            'label': function(node) {
                return node.data('name') + '\n' + (node.data('ip') || '');
            },
            'text-wrap': 'wrap',
            'text-max-width': deviceLabelMaxWidth,
            'font-size': function(node) { return (node.data('fontSize') || 10) + 'px'; },
            'font-weight': 'bold',
            'color': labelTextColor,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-background-color': labelBackgroundColor,
            'text-background-opacity': 0.97,
            'text-background-padding': '4px',
            'text-background-shape': 'roundrectangle',
            'text-outline-color': labelBackgroundColor,
            'text-outline-width': 0.5
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
            'label': function(node) {
                return node.data('name') + '\n' + (node.data('ip') || '');
            },
            'text-wrap': 'wrap',
            'text-max-width': deviceLabelMaxWidth,
            'font-size': function(node) { return (node.data('fontSize') || 10) + 'px'; },
            'font-weight': 'bold',
            'color': labelTextColor,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-background-color': labelBackgroundColor,
            'text-background-opacity': 0.97,
            'text-background-padding': '4px',
            'text-background-shape': 'roundrectangle',
            'text-outline-color': labelBackgroundColor,
            'text-outline-width': 0.5,
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
            'label': function(node) {
                return node.data('name') + '\n' + (node.data('ip') || '');
            },
            'text-wrap': 'wrap',
            'text-max-width': deviceLabelMaxWidth,
            'font-size': function(node) { return (node.data('fontSize') || 10) + 'px'; },
            'font-weight': 'bold',
            'color': labelTextColor,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-background-color': labelBackgroundColor,
            'text-background-opacity': 0.97,
            'text-background-padding': '4px',
            'text-background-shape': 'roundrectangle',
            'text-outline-color': labelBackgroundColor,
            'text-outline-width': 0.5,
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
            'font-size': node => node.data('fontSize') + 'px',
            'font-weight': 'bold',
            'text-valign': 'top',
            'text-halign': 'center',
            'padding': '10px',
            'compound-sizing-wrt-labels': 'include',
            'min-width': '80px',
            'min-height': '60px',
            'bounds-expansion': '20',
            'color': labelTextColor,
            'text-background-color': labelBackgroundColor,
            'text-background-opacity': 0.92,
            'text-background-padding': '4px',
            'text-background-shape': 'roundrectangle',
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
            'border-style': 'solid',
            'label': 'data(name)',
            'font-size': '12px',
            'font-weight': 'bold',
            'text-valign': 'center',
            'text-halign': 'center',
            'background-color': 'data(color)',
            'background-opacity': 0.2,
            'color': labelTextColor,
            'text-background-color': labelBackgroundColor,
            'text-background-opacity': 0.96,
            'text-background-padding': '4px',
            'text-background-shape': 'roundrectangle'
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
            'font-size': '8px',
            'color': edgeLabelTextColor,
            'text-background-color': edgeLabelBackgroundColor,
            'text-background-opacity': 0.96,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle'
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
                if (size === undefined || size === null) size = 8;
                return size + 'px';
            },
            'text-rotation': 'autorotate',
            'text-margin-y': -8,
            'color': edgeLabelTextColor,
            'text-background-color': edgeLabelBackgroundColor,
            'text-background-opacity': 0.96,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle'
        }
    },
    {
        selector: 'edge:selected',
        style: {
            'width': 4,
            'line-color': '#007bff',
            'text-background-color': () => isDarkTheme() ? '#243b52' : '#e7f3ff'
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
            'border-color': '#64748b',
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
            'color': labelTextColor,
            'text-background-color': labelBackgroundColor,
            'text-background-opacity': 0.94,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle',
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
    }
];
