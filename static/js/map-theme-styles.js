/* Theme-aware Cytoscape labels, kept separate from the main map bundle. */
(() => {
    const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
    const palette = () => isDark() ? {
        text: '#f8fafc',
        mutedText: '#cbd5e1',
        label: '#1e293b',
        labelOpacity: 0.84,
        edgeLabel: '#253244',
        edgeLabelOpacity: 0.88,
        selectedEdgeLabel: '#173b61',
        shapeBorder: '#64748b'
    } : {
        text: '#1f2937',
        mutedText: '#475569',
        label: '#ffffff',
        labelOpacity: 0.88,
        edgeLabel: '#f8fafc',
        edgeLabelOpacity: 0.90,
        selectedEdgeLabel: '#e7f3ff',
        shapeBorder: '#94a3b8'
    };

    let styledCy = null;
    let styleSignature = '';

    function apply(cy) {
        if (!cy || typeof cy.style !== 'function') return;

        const colors = palette();
        const signature = `${isDark()}:${colors.label}:${colors.text}`;
        if (styledCy === cy && styleSignature === signature) return;

        styledCy = cy;
        styleSignature = signature;
        const dynamic = key => () => palette()[key];
        const stylesheet = cy.style();
        const deviceLabel = {
            color: dynamic('text'),
            'text-background-color': dynamic('label'),
            'text-background-opacity': dynamic('labelOpacity'),
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            'text-outline-width': 0,
            'text-wrap': 'wrap',
            'text-max-width': node => {
                const name = String(node.data('name') || node.data('label') || '');
                return `${Math.max(92, Math.min(220, name.length * 6.7 + 16))}px`;
            }
        };

        [
            'node[iconUrl][iconUrl != ""]',
            'node[!iconUrl][status="up"], node[iconUrl=""][status="up"]',
            'node[!iconUrl][status="down"], node[iconUrl=""][status="down"]',
            'node[!iconUrl][status="partial"], node[iconUrl=""][status="partial"]'
        ].forEach(selector => stylesheet.selector(selector).style(deviceLabel));

        stylesheet.selector('node[isGroup]').style({
            color: dynamic('text'),
            'text-background-color': dynamic('label'),
            'text-background-opacity': dynamic('labelOpacity'),
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            'text-outline-width': 0,
            'text-margin-y': 4
        });
        stylesheet.selector('node[isGroup][?collapsed]').style({
            color: dynamic('text'),
            'text-background-color': dynamic('label'),
            'text-background-opacity': dynamic('labelOpacity'),
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle'
        });
        stylesheet.selector('node[isShape]').style({
            color: dynamic('text'),
            'text-background-color': dynamic('label'),
            'text-background-opacity': dynamic('labelOpacity'),
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            'text-outline-width': 0,
            'border-color': dynamic('shapeBorder')
        });

        const edgeLabel = {
            color: dynamic('mutedText'),
            'text-background-color': dynamic('edgeLabel'),
            'text-background-opacity': dynamic('edgeLabelOpacity'),
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            'text-outline-width': 0
        };
        stylesheet.selector('edge').style(edgeLabel);
        stylesheet.selector('edge[?isCollapseProxy]').style(edgeLabel);
        stylesheet.selector('edge:selected').style({
            color: dynamic('text'),
            'text-background-color': dynamic('selectedEdgeLabel'),
            'text-background-opacity': 0.96
        });
        stylesheet.update();
    }

    window.applyMapThemeStyles = () => apply(window.cy);
    window.addEventListener('linkvision:cy-ready', event => {
        apply(event.detail?.cy || window.cy);
    });

    const observer = new MutationObserver(records => {
        if (records.some(record => record.attributeName === 'data-theme')) {
            apply(window.cy);
        }
    });
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
    });

    document.addEventListener('DOMContentLoaded', () => apply(window.cy), { once: true });
    if (window.cy) apply(window.cy);
})();
