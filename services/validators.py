"""
Модуль валидации данных.

Содержит функции для проверки корректности входных данных:
- IP-адреса
- Списки IP
- Названия объектов
- Числовые значения
"""

import ipaddress
from typing import List, Optional, Tuple, Any
from utils.logger import api_logger


def validate_ip_address(ip: Any) -> Tuple[bool, Optional[str]]:
    """
    Проверить корректность IP-адреса (IPv4 или IPv6).

    Args:
        ip: Проверяемое значение (должно быть строкой или приводимым к строке)

    Returns:
        Tuple[bool, Optional[str]]: (успех, ошибка или None)
    """
    if not ip or not isinstance(ip, str):
        return False, "IP-адрес должен быть строкой"

    try:
        ipaddress.ip_address(ip.strip())
        return True, None
    except (ValueError, AttributeError) as e:
        return False, f"Неверный формат IP-адреса: {ip}"


def validate_ip_list(ips: Optional[List[Any]]) -> Tuple[List[str], Optional[str]]:
    """
    Валидировать и очистить список IP-адресов.

    Args:
        ips: Список IP-адресов для валидации

    Returns:
        Tuple[List[str], Optional[str]]: (очищенный список, ошибка или None)
    """
    if not ips:
        return [], None

    clean_ips: List[str] = []
    seen: set = set()

    for ip in ips:
        if not isinstance(ip, str):
            continue

        ip_clean = ip.strip()
        if not ip_clean or ip_clean in seen:
            continue

        is_valid, error = validate_ip_address(ip_clean)
        if not is_valid:
            return [], error

        clean_ips.append(ip_clean)
        seen.add(ip_clean)

    return clean_ips, None


def validate_name(
    name: Any, min_length: int = 2, max_length: int = 64
) -> Tuple[bool, Optional[str]]:
    """
    Проверить корректность названия (устройства, карты, группы).

    Args:
        name: Проверяемое название
        min_length: Минимальная длина
        max_length: Максимальная длина

    Returns:
        Tuple[bool, Optional[str]]: (успех, ошибка или None)
    """
    if not name or not isinstance(name, str):
        return False, "Название должно быть строкой"

    name = name.strip()

    if len(name) < min_length:
        return False, f"Название должно содержать минимум {min_length} символа"

    if len(name) > max_length:
        return False, f"Название не должно превышать {max_length} символов"

    return True, None


def validate_positive_int(
    value: Any, field_name: str = "Значение"
) -> Tuple[int, Optional[str]]:
    """
    Проверить, что значение является положительным целым числом.

    Args:
        value: Проверяемое значение
        field_name: Имя поля для сообщения об ошибке

    Returns:
        Tuple[int, Optional[str]]: (число, ошибка или None)
    """
    if value is None:
        return 0, None

    try:
        int_value = int(value)
        if int_value < 0:
            return 0, f"{field_name} должно быть неотрицательным"
        return int_value, None
    except (ValueError, TypeError):
        return 0, f"{field_name} должно быть целым числом"


def validate_float_range(
    value: Any, min_val: float = 0, max_val: float = 1, field_name: str = "Значение"
) -> Tuple[float, Optional[str]]:
    """
    Проверить, что значение находится в допустимом диапазоне.

    Args:
        value: Проверяемое значение
        min_val: Минимальное значение
        max_val: Максимальное значение
        field_name: Имя поля для сообщения об ошибке

    Returns:
        Tuple[float, Optional[str]]: (число, ошибка или None)
    """
    if value is None:
        return min_val, None

    try:
        float_value = float(value)
        if float_value < min_val or float_value > max_val:
            return (
                min_val,
                f"{field_name} должно быть в диапазоне [{min_val}, {max_val}]",
            )
        return float_value, None
    except (ValueError, TypeError):
        return min_val, f"{field_name} должно быть числом"


def validate_color_hex(color: Any) -> Tuple[str, Optional[str]]:
    """
    Проверить корректность HEX-цвета.

    Args:
        color: Проверяемое значение цвета

    Returns:
        Tuple[str, Optional[str]]: (цвет, ошибка или None)
    """
    if not color or not isinstance(color, str):
        return "#3498db", None

    color = color.strip()

    # Проверка формата #RRGGBB
    if len(color) == 7 and color.startswith("#"):
        try:
            int(color[1:], 16)
            return color, None
        except ValueError:
            pass

    # Значение по умолчанию
    return "#3498db", None


def validate_line_style(style: Any) -> Tuple[str, Optional[str]]:
    """
    Проверить корректность стиля линии.

    Args:
        style: Проверяемое значение стиля

    Returns:
        Tuple[str, Optional[str]]: (стиль, ошибка или None)
    """
    valid_styles = {"solid", "dashed", "dotted"}

    if not style or not isinstance(style, str):
        return "solid", None

    style = style.strip().lower()

    if style in valid_styles:
        return style, None

    return "solid", None


def validate_link_type(link_type: Any) -> Tuple[Optional[str], Optional[str]]:
    """
    Проверить корректность типа соединения.

    Args:
        link_type: Проверяемое значение типа

    Returns:
        Tuple[Optional[str], Optional[str]]: (тип, ошибка или None)
    """
    valid_types = {"100m", "1G", "10G", "25G", "100G", "400G", "vlan", "radio", None}

    if link_type is None:
        return None, None

    if not isinstance(link_type, str):
        return None, "Тип соединения должен быть строкой"

    link_type = link_type.strip()

    if link_type in valid_types:
        return link_type, None

    return None, f"Неверный тип соединения: {link_type}"
