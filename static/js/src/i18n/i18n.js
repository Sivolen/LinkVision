/**
 * i18n для фронтенда (Фаза 2).
 *
 * Сам рантайм t() определён в static/js/src/app-init.js — это ПЛОСКИЙ скрипт,
 * он грузится раньше бандлов (map.min.js/modal.min.js) и раньше base.min.js,
 * поэтому window.t доступен и не-модульному base.js, и ES-модулям. Здесь только
 * тонкая обёртка-реэкспорт, чтобы модули писали `import { t } from '.../i18n.js'`.
 *
 * Словарь приходит синхронно от сервера в window.__I18N__ (инъекция в base.html,
 * см. inject_globals → js_i18n). Никакого fetch — нет гонки и мигания сырых ключей.
 */

export function t(key, params) {
    return typeof window.t === 'function' ? window.t(key, params) : key;
}

export function getLocale() {
    return typeof window.getLocale === 'function' ? window.getLocale() : 'ru';
}
