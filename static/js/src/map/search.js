import { t } from '../i18n/i18n.js';
import { refreshZoomEmphasis } from './zoomEmphasis.js';
import { setStatusFilter, applyMapVisibility, setSearchReveal } from './visibility.js';
import { setSearchGroupPath, syncCollapseView } from './groupCollapse.js';
import { withTemporaryPanning } from './modes.js';
import { markUserInteracted } from './background.js';
import { registerCleanup } from './moduleRegistry.js';

const MAX_RESULTS = 12;
let dispose = null;

export function initSearch(cy) {
    cleanup();
    const input = document.getElementById('searchInput');
    if (!input) return;

    const popup = document.createElement('div');
    popup.className = 'map-search-popup';
    popup.hidden = true;
    const list = document.createElement('div');
    list.id = 'mapSearchResults';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', t('search.results'));
    const summary = document.createElement('div');
    summary.className = 'map-search-summary';
    summary.setAttribute('aria-live', 'polite');
    popup.append(list, summary);
    document.body.append(popup);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'false');

    let timer = null;
    let results = [];
    let active = -1;
    let revealedId = null;
    let disposed = false;

    function reveal(node) {
        const id = node?.id() ?? null;
        if (id === revealedId) return;
        revealedId = id;
        setSearchReveal(id);
        if (setSearchGroupPath(cy, node)) syncCollapseView(cy);
        else applyMapVisibility();
    }

    function placePopup() {
        if (popup.hidden) return;
        const rect = input.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            closePopup();
            return;
        }
        const width = Math.min(Math.max(rect.width, 280), document.documentElement.clientWidth - 16);
        popup.style.width = width + 'px';
        popup.style.left = Math.max(8, Math.min(rect.left, document.documentElement.clientWidth - width - 8)) + 'px';
        popup.style.top = (rect.bottom + 4) + 'px';
    }

    function closePopup() {
        popup.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
    }

    function setActive(index) {
        if (active >= 0) list.children[active]?.setAttribute('aria-selected', 'false');
        active = index;
        const option = list.children[active];
        if (!option) {
            input.removeAttribute('aria-activedescendant');
            return;
        }
        option.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
    }

    function search(open = true) {
        const term = input.value.trim().toLowerCase();
        const matches = [];
        cy.batch(() => {
            cy.nodes('.cy-node-highlight').removeClass('cy-node-highlight');
            if (!term) return;
            cy.nodes('node[!isGroup][!isShape]').forEach(node => {
                const fields = ['name', 'ip', 'type'].map(key => String(node.data(key) ?? ''));
                if (!fields.some(value => value.toLowerCase().includes(term))) return;
                if (node.visible()) node.addClass('cy-node-highlight');
                matches.push(node);
            });
        });
        refreshZoomEmphasis();

        results = matches.slice(0, MAX_RESULTS);
        list.replaceChildren();
        active = -1;
        input.removeAttribute('aria-activedescendant');
        if (!term || !open) {
            closePopup();
            return;
        }
        summary.textContent = matches.length > MAX_RESULTS
            ? t('search.limited', { shown: MAX_RESULTS, count: matches.length })
            : matches.length ? t('search.foundCount', { count: matches.length }) : t('search.notFound', { term });
        results.forEach((node, index) => {
            const row = document.createElement('div');
            row.id = 'mapSearchResult-' + index;
            row.className = 'map-search-result';
            row.dataset.resultIndex = index;
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', 'false');
            const name = document.createElement('strong');
            name.textContent = node.data('name') || node.id();
            row.append(name);
            const extra = [node.data('ip'), node.data('type'), !node.visible() && t('search.hiddenOnMap')].filter(Boolean);
            if (extra.length) {
                const detail = document.createElement('small');
                detail.textContent = extra.join(' · ');
                row.append(detail);
            }
            list.append(row);
        });
        popup.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        placePopup();
    }

    function locate(index) {
        const id = results[index]?.id();
        if (id == null) return;
        const node = cy.getElementById(id);
        if (!node.length) return;
        markUserInteracted();
        reveal(node);
        cy.nodes('.cy-node-highlight').removeClass('cy-node-highlight');
        node.addClass('cy-node-highlight');
        refreshZoomEmphasis();
        const zoom = Math.min(cy.maxZoom(), Math.max(cy.zoom(), 0.8));
        const { x, y } = node.position();
        withTemporaryPanning(cy, () => cy.viewport({
            zoom,
            pan: { x: cy.width() / 2 - x * zoom, y: cy.height() / 2 - y * zoom },
        }));
        closePopup();
    }

    function onInput() {
        reveal(null);
        clearTimeout(timer);
        timer = null;
        closePopup();
        if (input.value.trim()) {
            timer = setTimeout(() => {
                timer = null;
                search();
            }, 220);
        } else search(false);
    }

    function onKey(event) {
        if (event.isComposing || !input.value.trim()) return;
        if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (popup.hidden || timer !== null) {
                clearTimeout(timer);
                timer = null;
                search();
            }
            if (event.key === 'Enter') locate(Math.max(0, active));
            else if (results.length) {
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setActive(active < 0 ? (step > 0 ? 0 : results.length - 1) : (active + step + results.length) % results.length);
            }
        }
    }

    function onPopupClick(event) {
        const row = event.target.closest('[data-result-index]');
        if (row) locate(Number(row.dataset.resultIndex));
    }
    function onOutside(event) {
        if (event.target === input || popup.contains(event.target)) return;
        clearTimeout(timer);
        timer = null;
        closePopup();
    }
    function onEscape(event) {
        if (event.key !== 'Escape' || (popup.hidden && revealedId === null && timer === null)) return;
        clearTimeout(timer);
        timer = null;
        const hadReveal = revealedId !== null;
        reveal(null);
        closePopup();
        if (hadReveal) search(false);
    }
    function onLoaded() {
        reveal(null);
        search(!popup.hidden);
    }
    function onRemove({ target }) {
        const id = target.id();
        if (id !== revealedId) return;
        queueMicrotask(() => {
            if (!disposed && revealedId === id && !cy.destroyed()) reveal(null);
        });
    }

    function updateFilter(status) {
        clearTimeout(timer);
        timer = null;
        reveal(null);
        setStatusFilter(status);
        const button = document.querySelector('.toolbar-filter-button');
        const options = document.querySelectorAll('[data-filter-value]');
        for (const option of options) {
            const selected = option.dataset.filterValue === status;
            option.setAttribute('aria-pressed', String(selected));
            if (selected && button) button.textContent = status === 'all' ? button.dataset.defaultLabel : option.textContent;
        }
        button?.classList.toggle('is-filtered', status !== 'all');
        search(false);
    }
    window.filterByStatus = updateFilter;
    window.clearSearch = () => {
        input.value = '';
        updateFilter('all');
    };

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    const openResults = () => { if (popup.hidden && timer === null && input.value.trim()) search(); };
    input.addEventListener('focus', openResults);
    input.addEventListener('click', openResults);
    popup.addEventListener('click', onPopupClick);
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onEscape);
    window.addEventListener('resize', placePopup);
    window.addEventListener('scroll', placePopup, true);
    window.addEventListener('elements:loaded', onLoaded);
    cy.on('remove', 'node', onRemove);

    dispose = () => {
        disposed = true;
        clearTimeout(timer);
        setSearchReveal(null);
        setSearchGroupPath(cy, null);
        cy.off('remove', 'node', onRemove);
        input.removeEventListener('input', onInput);
        input.removeEventListener('keydown', onKey);
        input.removeEventListener('focus', openResults);
        input.removeEventListener('click', openResults);
        for (const attribute of ['role', 'aria-autocomplete', 'aria-controls', 'aria-expanded', 'aria-activedescendant']) {
            input.removeAttribute(attribute);
        }
        popup.remove();
        document.removeEventListener('pointerdown', onOutside);
        document.removeEventListener('keydown', onEscape);
        window.removeEventListener('resize', placePopup);
        window.removeEventListener('scroll', placePopup, true);
        window.removeEventListener('elements:loaded', onLoaded);
        delete window.filterByStatus;
        delete window.clearSearch;
    };
}

export function cleanup() {
    dispose?.();
    dispose = null;
}

registerCleanup(cleanup);
