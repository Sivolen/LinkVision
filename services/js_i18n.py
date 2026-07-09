"""
Загрузчик словарей переводов для фронтенда (Фаза 2 i18n).

Читает static/js/src/i18n/<locale>.json и отдаёт пейлоад для синхронной
инъекции в window.__I18N__ (см. base.html + app-init.js). Вынесен в отдельный
модуль, чтобы им пользовались и app.py (inject_globals), и тесты, не импортируя
тяжёлый app.py.
"""

import json
import os

from config import Config, BASE_DIR

_CACHE = {}


def load_js_dict(locale):
    """Словарь фронтенда для локали (с кэшем). {} если файла нет/битый."""
    if locale in _CACHE:
        return _CACHE[locale]
    path = os.path.join(
        BASE_DIR, "static", "js", "src", "i18n", f"{locale}.json"
    )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    _CACHE[locale] = data
    return data


def js_i18n_payload(locale):
    """Пейлоад для window.__I18N__: {locale, messages, fallback}.

    fallback = дефолтная локаль (ru) при locale != ru — чтобы недостающие в
    переводе ключи падали на русский, а не на сырой ключ.
    """
    fallback_locale = Config.BABEL_DEFAULT_LOCALE
    payload = {"locale": locale, "messages": load_js_dict(locale)}
    if locale != fallback_locale:
        payload["fallback"] = load_js_dict(fallback_locale)
    return payload
