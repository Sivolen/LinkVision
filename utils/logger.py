import os
import logging
from logging.handlers import RotatingFileHandler
from config import Config


def setup_logger(name):
    """Настройка и получение логера для модуля"""
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, Config.LOG_LEVEL))

    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    if not os.path.exists(Config.LOG_FOLDER):
        os.makedirs(Config.LOG_FOLDER)

    log_file = os.path.join(Config.LOG_FOLDER, f"{name}.log")
    file_handler = RotatingFileHandler(
        log_file, maxBytes=Config.LOG_MAX_BYTES, backupCount=Config.LOG_BACKUP_COUNT
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    return logger


# Глобальные логеры
app_logger = setup_logger("app")
auth_logger = setup_logger("auth")
admin_logger = setup_logger("admin")
api_logger = setup_logger("api")
main_logger = setup_logger("main")
monitor_logger = setup_logger("monitor")
fix_logger = setup_logger("fix")
