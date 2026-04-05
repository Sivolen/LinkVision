// styles.js – вынесенные стили Cytoscape
export const CY_STYLE = [
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
           'font-size': function(node) { return (node.data('fontSize') || 10) + 'px'; },
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
            'font-size': function(node) { return (node.data('fontSize') || 10) + 'px'; },
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
            'font-size': function(node) { return node.data('fontSize') + 'px'; },
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
            'font-size': function(edge) {
                let size = edge.data('font_size');
                if (size === undefined || size === null) size = 8;
                return size + 'px';
            },
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
            'border-color': '#333',
            'border-opacity': 0.5,
            'label': 'data(label)',          // ← исправлено
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
            'color': '#000',
            'z-index': 5
        }
    },
    {
        selector: 'node[isShape]:selected',
        style: {
            'border-color': '#007bff',
            'border-width': 5,
            'background-color': 'rgba(0,123,255,0.1)',
            'transition-property': 'border-width, background-color',
            'transition-duration': '0.2s'
        }
    }
];