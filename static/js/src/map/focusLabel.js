import { t } from '../i18n/i18n.js';
import { isLinkMode } from './modes.js';

export function initFocusLabel(cy) {
    const container = cy.container();
    if (!container) return () => {};

    const card = document.createElement('div');
    card.className = 'lv-map-focus-label';
    card.hidden = true;
    const title = document.createElement('strong');
    const detail = document.createElement('span');
    card.append(title, detail);
    container.appendChild(card);

    let target = null;
    let edgeTap = null;
    let frame = null;
    let contentDirty = true;
    let disposed = false;
    const inspector = container.parentElement?.querySelector('#mapDeviceInspector');
    let inspectorWidth = inspector?.offsetWidth ?? 0;
    const inspectorObserver = inspector && typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            inspectorWidth = inspector.offsetWidth;
            schedule();
        })
        : null;
    inspectorObserver?.observe(inspector);

    function clear() {
        target = null;
        edgeTap = null;
        card.hidden = true;
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
    }

    function render() {
        frame = null;
        if (!target || target.removed() || !target.visible()) {
            clear();
            return;
        }

        const width = cy.width();
        const height = cy.height();
        const isOnScreen = point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
            && point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;
        let anchor = target.isNode() ? target.renderedPosition() : target.renderedMidpoint();
        // Long links can be hit in the viewport even with their midpoint outside.
        if (!isOnScreen(anchor) && edgeTap) {
            const zoom = cy.zoom();
            const pan = cy.pan();
            anchor = { x: edgeTap.x * zoom + pan.x, y: edgeTap.y * zoom + pan.y };
        }
        // The inspector owns the visible device details on narrow maps.
        const availableWidth = width - inspectorWidth;
        if (!isOnScreen(anchor) || availableWidth < 160) {
            card.hidden = true;
            return;
        }

        if (contentDirty) {
            if (target.isNode()) {
                title.textContent = target.data('name') || target.id();
                detail.textContent = target.data('ip') || '';
            } else {
                const endpoint = (node, iface) => [node.data('name') || node.id(), iface || t('focusLabel.noInterface')].join(' · ');
                title.textContent = t('focusLabel.source') + ' ' + endpoint(target.source(), target.data('srcIface'));
                detail.textContent = t('focusLabel.target') + ' ' + endpoint(target.target(), target.data('tgtIface'));
            }
            detail.hidden = !detail.textContent;
            contentDirty = false;
        }

        const { x, y } = anchor;
        card.hidden = false;
        card.style.setProperty('--focus-area-width', availableWidth + 'px');
        card.style.setProperty('--focus-x', x + 'px');
        const nodeRadius = target.isNode() ? target.renderedOuterHeight() / 2 : 0;
        const below = y < nodeRadius + 75 && y < height / 2;
        const space = below ? height - y : y;
        const gap = 10 + Math.min(nodeRadius, Math.max(0, space - 60));
        card.style.setProperty('--focus-y', y + 'px');
        card.style.setProperty('--focus-gap', gap + 'px');
        card.classList.toggle('is-below', below);
    }

    function schedule() {
        if (!disposed && target && frame === null) frame = requestAnimationFrame(render);
    }

    function onTap({ target: element, position }) {
        if (isLinkMode() || element === cy || element.data('isGroup')
            || element.data('isShape') || element.data('isCollapseProxy')) {
            clear();
            return;
        }
        target = element;
        edgeTap = element.isEdge() && position ? { x: position.x, y: position.y } : null;
        contentDirty = true;
        schedule();
    }

    function isRelevant(element) {
        return target && (element === target || (target.isEdge()
            && (element === target.source() || element === target.target())));
    }

    function onData({ target: element }) {
        if (!isRelevant(element)) return;
        contentDirty = true;
        schedule();
    }

    function onPosition({ target: element }) {
        if (isRelevant(element)) schedule();
    }

    function onRemove({ target: element }) {
        if (isRelevant(element)) clear();
    }

    function onKey(event) {
        if (event.key === 'Escape') clear();
    }

    function cleanup() {
        if (disposed) return;
        disposed = true;
        clear();
        inspectorObserver?.disconnect();
        card.remove();
        cy.off('tap', onTap);
        cy.off('data', onData);
        cy.off('position', 'node', onPosition);
        cy.off('remove', onRemove);
        cy.off('viewport resize', schedule);
        cy.off('destroy', cleanup);
        window.removeEventListener('linkvision:map-filter-changed', schedule);
        window.removeEventListener('linkvision:mode-changed', clear);
        window.removeEventListener('linkvision:link-mode-changed', clear);
        document.removeEventListener('keydown', onKey);
    }

    cy.on('tap', onTap);
    cy.on('data', onData);
    cy.on('position', 'node', onPosition);
    cy.on('remove', onRemove);
    cy.on('viewport resize', schedule);
    cy.on('destroy', cleanup);
    window.addEventListener('linkvision:map-filter-changed', schedule);
    window.addEventListener('linkvision:mode-changed', clear);
    window.addEventListener('linkvision:link-mode-changed', clear);
    document.addEventListener('keydown', onKey);
    return cleanup;
}
