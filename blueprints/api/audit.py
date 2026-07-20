"""
API роуты для аудита (Audit).
"""

from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_login import login_required

from services import require_admin, get_audit_logs, get_user_activity_summary
from utils.logger import api_logger

audit_bp = Blueprint("audit", __name__)


@audit_bp.route("/audit/logs", methods=["GET"])
@login_required
@require_admin
def get_audit_logs_route():
    """
    Получить журнал аудита.

    Доступно: только администраторам.

    Query params:
    - user_id: фильтр по пользователю
    - target_type: фильтр по типу объекта (map, device, permission)
    - target_id: фильтр по ID объекта
    - action: фильтр по действию
    - date_from: начальная дата (ISO format)
    - date_to: конечная дата (ISO format)
    - page: номер страницы (default: 1)
    - per_page: записей на страницу (default: 50, max: 200)
    """
    # Параметры фильтрации
    user_id = request.args.get("user_id", type=int)
    target_type = request.args.get("target_type")
    target_id = request.args.get("target_id", type=int)
    action = request.args.get("action")

    # Даты
    date_from = None
    date_to = None

    if request.args.get("date_from"):
        try:
            date_from = datetime.fromisoformat(request.args.get("date_from"))
        except ValueError:
            return jsonify({"error": "Invalid date_from format"}), 400

    if request.args.get("date_to"):
        try:
            date_to = datetime.fromisoformat(request.args.get("date_to"))
        except ValueError:
            return jsonify({"error": "Invalid date_to format"}), 400

    # Пагинация
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 50, type=int)
    per_page = min(per_page, 200)  # Максимум 200 записей на страницу

    try:
        result = get_audit_logs(
            user_id=user_id,
            target_type=target_type,
            target_id=target_id,
            action=action,
            date_from=date_from,
            date_to=date_to,
            page=page,
            per_page=per_page,
        )
        return jsonify(result)
    except Exception as e:
        api_logger.error(f"Error fetching audit logs: {e}")
        return jsonify({"error": "Internal server error"}), 500


@audit_bp.route("/audit/user/<int:user_id>/activity", methods=["GET"])
@login_required
@require_admin
def get_user_activity(user_id):
    """
    Получить сводку активности пользователя.

    Доступно: только администраторам.

    Query params:
    - days: количество дней (default: 7)
    """
    days = request.args.get("days", 7, type=int)
    days = min(days, 90)  # Максимум 90 дней

    try:
        result = get_user_activity_summary(user_id, days)
        return jsonify(result)
    except Exception as e:
        api_logger.error(f"Error fetching user activity: {e}")
        return jsonify({"error": "Internal server error"}), 500
