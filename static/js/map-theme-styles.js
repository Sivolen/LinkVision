/*
 * Theme-aware Cytoscape labels.
 * Kept as a small runtime module so the theme palette works even when the
 * application serves the prebuilt map.min.js bundle.
 */
(() => {
    const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
    const palette = () => isDark() ? {
        text: '#f3f6fb',
        mutedText: '#d4dde8',
        label: '#28313d',
        edgeLabel: '#252e39',
        selectedEdgeLabel: '#243b52',
        shapeBorder: '#64748b'
    } : {
        text: '#172033',
        mutedText: '#475569',
        label: '#f8fafc',
        edgeLabel: '#f8fafc',
        selectedEdgeLabel: '#e7f3ff',
        shapeBorder: '#64748b'
    };

    let styledCy = null;

    function addThemeRules(cy) {
        if (!cy || cy.destroyed()) return;
        if (styledCy === cy) {
            cy.style().update();
            return;
        }
        styledCy = cy;
        const dynamic = key => () => palette()[key];
        const stylesheet = cy.style();
        const labelStyle = {
            color: dynamic('text'),
            'text-background-color': dynamic('label'),
            'text-background-opacity': 0.97,
            'text-background-padding': '4px',
            'text-background-shape': 'roundrectangle',
            'text-outline-color': dynamic('label'),
            'text-outline-width': 0.5
        };

        // Re-apply label styling to all device states without touching status
        // borders, quality overlays, selection, dimensions, or icon rendering.
        [
            'node[iconUrl][iconUrl != ""]',
            'node[!iconUrl][status="up"], node[iconUrl=""][status="up"]',
            'node[!iconUrl][status="down"], node[iconUrl=""][status="down"]',
            'node[!iconUrl][status="partial"], node[iconUrl=""][status="partial"]',
            'node[isShape]'
        ].forEach(selector => stylesheet.selector(selector).style(labelStyle));
        stylesheet.selector('node[isShape]').style({
            'border-color': dynamic('shapeBorder')
        });

        const groupLabelStyle = {
            color: dynamic('text'),
            'text-background-color': dynamic('label'),
            'text-background-opacity': 0.92,
            'text-background-padding': '4px',
            'text-background-shape': 'roundrectangle'
        };
        stylesheet.selector('node[isGroup]').style(groupLabelStyle);
        stylesheet.selector('node[isGroup][?collapsed]').style(groupLabelStyle);

        const edgeLabelStyle = {
            color: dynamic('mutedText'),
            'text-background-color': dynamic('edgeLabel'),
            'text-background-opacity': 0.96,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle'
        };
        stylesheet.selector('edge').style(edgeLabelStyle);
        stylesheet.selector('edge[?isCollapseProxy]').style(edgeLabelStyle);
        stylesheet.selector('edge:selected').style({
            'text-background-color': dynamic('selectedEdgeLabel')
        });
        stylesheet.update();
    }

    window.applyMapThemeStyles = () => addThemeRules(window.cy);

    const themeObserver = new MutationObserver(mutations => {
        if (!mutations.some(mutation => mutation.attributeName === 'data-theme')) return;
        window.applyMapThemeStyles();
    });
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
    });

    // Map initialization can happen after this script is loaded.
    document.addEventListener('DOMContentLoaded', () => {
        window.applyMapThemeStyles();
    }, { once: true });
})();
