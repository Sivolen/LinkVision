const pickerBindings = new WeakMap();

/**
 * Bind the shared palette picker used by the group, shape, and link modals.
 */
export function initColorPicker({ buttonId, panelId, inputId, previewId, codeId }) {
    const button = document.getElementById(buttonId);
    const panel = document.getElementById(panelId);
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    const code = document.getElementById(codeId);
    const root = button?.closest('.color-picker-simple');

    if (!button || !panel || !input || !preview || !code || !root) return null;

    pickerBindings.get(button)?.abort();
    const controller = new AbortController();
    const { signal } = controller;
    pickerBindings.set(button, controller);

    const close = () => {
        panel.style.display = 'none';
        panel.setAttribute('aria-hidden', 'true');
        button.classList.remove('active');
        button.setAttribute('aria-expanded', 'false');
    };

    const setColor = value => {
        const color = /^#[\da-f]{6}$/i.test(value || '') ? value.toLowerCase() : '#3498db';
        input.value = color;
        preview.style.backgroundColor = color;
        code.textContent = color.toUpperCase();
        panel.querySelectorAll('.color-swatch').forEach(swatch => {
            const active = swatch.dataset.color?.toLowerCase() === color;
            swatch.classList.toggle('active', active);
            swatch.setAttribute('aria-pressed', String(active));
            if (swatch.dataset.color) swatch.setAttribute('aria-label', swatch.dataset.color);
        });
        return color;
    };

    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        const isOpen = panel.style.display !== 'none';
        if (isOpen) {
            close();
        } else {
            panel.style.display = 'block';
            panel.setAttribute('aria-hidden', 'false');
            button.classList.add('active');
            button.setAttribute('aria-expanded', 'true');
        }
    }, { signal });

    panel.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (swatch.disabled) return;
            setColor(swatch.dataset.color);
            close();
        }, { signal });
    });

    input.addEventListener('input', () => setColor(input.value), { signal });
    input.addEventListener('change', () => setColor(input.value), { signal });
    panel.addEventListener('click', event => event.stopPropagation(), { signal });
    document.addEventListener('click', event => {
        if (!root.contains(event.target)) close();
    }, { signal });
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            close();
            button.focus();
        }
    }, { signal });

    button.setAttribute('aria-controls', panelId);
    button.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
    panel.querySelectorAll('.color-swatch').forEach(swatch => {
        if (swatch.dataset.color) swatch.setAttribute('aria-label', swatch.dataset.color);
        swatch.setAttribute('aria-pressed', 'false');
    });
    return setColor;
}
