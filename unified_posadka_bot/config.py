"""
Объединенная конфигурация для бота посадки
"""
import os
from dotenv import load_dotenv
from typing import Optional

# Загружаем .env
try:
    if os.path.exists('.env'):
        try:
            load_dotenv(encoding='utf-8')
        except UnicodeDecodeError:
            load_dotenv(encoding='utf-8', errors='ignore')
    else:
        load_dotenv()
except Exception as e:
    print(f"⚠️ Предупреждение: Не удалось загрузить .env файл: {e}")

# ========== TELEGRAM ==========
TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN', '8357166908:AAHFZNh5T05r_6Hhbk-vwGr8H9ngJclICRQ')
TARGET_CHAT_ID_STR = os.getenv('TARGET_CHAT_ID', '-1002383295254')
TARGET_CHAT_ID = int(TARGET_CHAT_ID_STR) if TARGET_CHAT_ID_STR and TARGET_CHAT_ID_STR.strip() else -1002383295254

# ========== COLIZEUM API ==========
COLIZEUM_DOMAIN = os.getenv('COLIZEUM_DOMAIN', '234-1.cls.expert')
COLIZEUM_API_KEY = os.getenv('COLIZEUM_API_KEY', 'd9a77f5187d4e6e4260e06d6619d695b')
COLIZEUM_PROXY_URL = os.getenv('COLIZEUM_PROXY_URL', 'https://mapclub.langame.ru/proxy')

# ========== TRUEGAMERS ANDROID ==========
ADB_PATH = os.getenv('ADB_PATH', 'adb')
DEVICE_ID = os.getenv('DEVICE_ID', '')
TRUEGAMERS_PACKAGE = os.getenv('TRUEGAMERS_PACKAGE', 'com.truegamers.true_gamers')
TRUEGAMERS_ACTIVITY = os.getenv('TRUEGAMERS_ACTIVITY', '')
PIN_CODE = os.getenv('PIN_CODE', '1111')

# Координаты TrueGamers (для разрешения 1440x2560)
PLACES_BUTTON = (407, 882)
PIN_KEYPAD = {
    '1': (265, 1075), '2': (625, 1075), '3': (985, 1075),
    '4': (265, 1275), '5': (625, 1275), '6': (985, 1275),
    '7': (265, 1475), '8': (625, 1475), '9': (985, 1475),
    '0': (625, 1675),
}

# ========== НАСТРОЙКИ ==========
STATS_FILE = os.getenv('STATS_FILE', 'stats.json')
MAX_DAYS = int(os.getenv('MAX_DAYS', '30'))
LOCAL_TZ = os.getenv('LOCAL_TZ', 'Asia/Yekaterinburg')
MAX_RETRIES = int(os.getenv('MAX_RETRIES', '3'))
RETRY_DELAY = int(os.getenv('RETRY_DELAY', '2'))
SCHEMA_CACHE_TTL = int(os.getenv('SCHEMA_CACHE_TTL', '3600'))

