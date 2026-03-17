from models import User, db
from utils.logger import admin_logger, auth_logger

def get_user_by_id(user_id):
    """Получить пользователя по ID или None."""
    return User.query.get(user_id)

def get_user_by_username(username):
    """Получить пользователя по имени."""
    return User.query.filter_by(username=username).first()

def get_all_users():
    """Получить всех пользователей."""
    return User.query.all()

def create_user(username, password, role):
    """
    Создать пользователя.
    role: 'user', 'operator', 'admin'
    """
    is_admin = (role == 'admin')
    is_operator = (role == 'operator')
    user = User(username=username, is_admin=is_admin, is_operator=is_operator)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    admin_logger.info(f"User created: {username}, role={role}")
    return user

def update_user(user_id, username=None, password=None, role=None):
    """Обновить данные пользователя."""
    user = User.query.get_or_404(user_id)
    if username is not None:
        user.username = username
    if password:
        user.set_password(password)
    if role is not None:
        user.is_admin = (role == 'admin')
        user.is_operator = (role == 'operator')
    db.session.commit()
    admin_logger.info(f"User updated: ID={user_id}, role={role}")
    return user

def delete_user(user_id):
    """Удалить пользователя."""
    user = User.query.get_or_404(user_id)
    db.session.delete(user)
    db.session.commit()
    admin_logger.info(f"User deleted: ID={user_id}")
    return user_id

def authenticate_user(username, password):
    """Проверить логин и пароль, вернуть пользователя или None."""
    user = get_user_by_username(username)
    if user and user.check_password(password):
        auth_logger.info(f"User logged in: {username}")
        return user
    auth_logger.warning(f"Failed login attempt for username: {username}")
    return None