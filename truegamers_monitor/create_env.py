"""
Скрипт для создания файла .env с правильной кодировкой UTF-8
"""
import os

env_content = """TELEGRAM_BOT_TOKEN=
ADB_PATH=adb
DEVICE_ID=
"""

try:
    with open('.env', 'w', encoding='utf-8') as f:
        f.write(env_content)
    print("✅ Файл .env создан успешно!")
    print("\nТеперь откройте файл .env и укажите ваш TELEGRAM_BOT_TOKEN")
    print("Получить токен можно у @BotFather в Telegram")
except Exception as e:
    print(f"❌ Ошибка при создании файла .env: {e}")


