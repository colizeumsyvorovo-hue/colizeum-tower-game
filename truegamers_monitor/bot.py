"""
Telegram бот для мониторинга TrueGamers
"""
import asyncio
import logging
from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters
)
from android_automation import AndroidAutomation
from config import TELEGRAM_BOT_TOKEN, MONITOR_INTERVAL
import os
import glob
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from pytz import timezone

# Настройка логирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Состояния для ConversationHandler
PHONE, PASSWORD, CLUB = range(3)

# Глобальная переменная для автоматизации
android = AndroidAutomation()
monitoring_active = False
monitoring_task = None
scheduler = None
app_instance = None


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик команды /start"""
    welcome_text = """
🤖 Бот для мониторинга TrueGamers

Доступные команды:
/check_device - Проверить подключение эмулятора/устройства
/screenshot - Сделать скриншот (для настройки координат)
/test_pin - Протестировать ввод PIN
/test_tap - Протестировать нажатие на кнопку "Места"
/debug_clickable - Показать все кликабельные элементы (для отладки)
/analyze_places - Проанализировать текущий экран с местами
/open_places - Открыть приложение, ввести PIN и открыть места
/monitor - Начать автоматический мониторинг мест
/stop_monitor - Остановить мониторинг
/status - Статус системы
/help - Показать справку

💡 Совет: Начните с /check_device для проверки подключения эмулятора
    """
    await update.message.reply_text(welcome_text)


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик команды /help"""
    help_text = """
📖 Справка по использованию бота:

🔧 Настройка:
1. Запустите Android эмулятор (Android Studio AVD, BlueStacks, Nox)
2. Установите приложение TrueGamers в эмулятор
3. Используйте /check_device для проверки подключения
4. Используйте /screenshot для определения координат экрана

📱 Использование:
1. Используйте /login для входа в приложение TrueGamers
2. Используйте /select_club для выбора клуба
3. Используйте /open_places для открытия экрана с местами
4. Используйте /monitor для начала автоматического мониторинга

⚠️ Важно:
- Координаты экрана нужно настроить под ваш эмулятор в config.py
- Используйте /screenshot для получения скриншота и определения координат
- Разрешение эмулятора влияет на координаты (см. README.md)

📚 Документация:
См. файлы README.md и EMULATOR_SETUP.md для подробных инструкций
    """
    await update.message.reply_text(help_text)


async def check_device(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Проверяет подключение Android устройства"""
    await update.message.reply_text("🔍 Проверяю подключение устройства...")
    
    if not android.check_device_connected():
        await update.message.reply_text(
            "❌ Устройство не подключено!\n\n"
            "Убедитесь, что:\n"
            "1. USB отладка включена\n"
            "2. Устройство подключено через USB\n"
            "3. ADB установлен и доступен"
        )
        return
    
    device_info = android.get_device_info()
    screen_size = android.get_screen_size()
    
    info_text = f"""
✅ Устройство подключено!

📱 Модель: {device_info.get('model', 'Неизвестно')}
🤖 Android: {device_info.get('android_version', 'Неизвестно')}
📐 Размер экрана: {screen_size[0]}x{screen_size[1]}
    """
    
    await update.message.reply_text(info_text)


async def login_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Начинает процесс входа"""
    if not android.check_device_connected():
        await update.message.reply_text("❌ Устройство не подключено!")
        return ConversationHandler.END
    
    await update.message.reply_text(
        "📱 Введите номер телефона для входа:"
    )
    return PHONE


async def login_phone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Сохраняет телефон и запрашивает пароль"""
    context.user_data['phone'] = update.message.text
    await update.message.reply_text("🔐 Введите пароль:")
    return PASSWORD


async def login_password(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Выполняет вход"""
    password = update.message.text
    phone = context.user_data.get('phone')
    
    await update.message.reply_text("⏳ Выполняю вход...")
    
    success = android.login(phone, password)
    
    if success:
        await update.message.reply_text("✅ Вход выполнен успешно!")
    else:
        await update.message.reply_text("❌ Ошибка при входе. Проверьте данные.")
    
    return ConversationHandler.END


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Отменяет текущую операцию"""
    await update.message.reply_text("❌ Операция отменена.")
    return ConversationHandler.END


async def select_club(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Выбирает клуб"""
    if not android.check_device_connected():
        await update.message.reply_text("❌ Устройство не подключено!")
        return
    
    await update.message.reply_text("🏢 Выбираю клуб...")
    
    success = android.select_club()
    
    if success:
        await update.message.reply_text("✅ Клуб выбран!")
    else:
        await update.message.reply_text("❌ Ошибка при выборе клуба.")


async def open_places(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Открывает приложение, вводит PIN и открывает экран с местами"""
    if not android.check_device_connected():
        await update.message.reply_text("❌ Эмулятор/устройство не подключено!")
        return
    
    await update.message.reply_text("📱 Открываю приложение...")
    
    success = android.open_app_and_places()
    
    if success:
        # Анализируем места
        await update.message.reply_text("📊 Анализирую места...")
        status = android.get_places_status()
        
        # Отправляем скриншоты
        screenshots = [
            ('before_pin.png', '📸 До ввода PIN'),
            ('after_pin.png', '📸 После ввода PIN'),
            ('places_screen.png', '📸 Экран с местами')
        ]
        
        for screenshot_path, caption in screenshots:
            if os.path.exists(screenshot_path):
                try:
                    await update.message.reply_photo(
                        photo=open(screenshot_path, 'rb'),
                        caption=caption
                    )
                except Exception as e:
                    logger.error(f"Ошибка при отправке скриншота {screenshot_path}: {e}")
        
        # Отправляем статистику мест
        if 'error' not in status:
            total_pc = status.get('total_pc', 0)
            occupied_pc = status.get('occupied_pc', 0)
            free_pc = status.get('free_pc', 0)
            total_tv = status.get('total_tv', 0)
            occupied_tv = status.get('occupied_tv', 0)
            free_tv = status.get('free_tv', 0)
            
            message = f"""📊 **Статистика мест:**

💻 **ПК места:**
• Всего: {total_pc}
• 🟢 Свободно: {free_pc}
• 🔴 Занято: {occupied_pc}

📺 **TV места:**
• Всего: {total_tv}
• 🟢 Свободно: {free_tv}
• 🔴 Занято: {occupied_tv}
"""
            await update.message.reply_text(message, parse_mode='Markdown')
        else:
            await update.message.reply_text(f"⚠️ Ошибка при анализе мест: {status.get('error', 'Неизвестная ошибка')}")
        
        await update.message.reply_text("✅ Процесс завершен!")
    else:
        await update.message.reply_text("❌ Ошибка при открытии экрана с местами. Проверьте логи.")


async def send_posadka_text_only(bot, chat_id: int = None) -> str:
    """Отправляет посадку TrueGamers только текстом (без фото)"""
    if not android.check_device_connected():
        return "❌ Эмулятор/устройство не подключено!"
    
    try:
        # Открываем приложение, вводим PIN и открываем экран с местами
        android.open_app_and_places()
        await asyncio.sleep(3)  # Даем время на загрузку
        
        # Получаем статус мест
        status = android.get_places_status()
        
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        if 'error' in status:
            message = f"❌ Ошибка при получении статуса: {status['error']}\n🕐 {timestamp}"
            if chat_id:
                await bot.send_message(chat_id=chat_id, text=message)
            return message
        
        # Формируем текстовое сообщение
        total_pc = status.get('total_pc', 0)
        occupied_pc = status.get('occupied_pc', 0)
        free_pc = status.get('free_pc', 0)
        total_tv = status.get('total_tv', 0)
        occupied_tv = status.get('occupied_tv', 0)
        free_tv = status.get('free_tv', 0)
        
        # Вычисляем проценты
        pc_occupied_percent = (occupied_pc / total_pc * 100) if total_pc > 0 else 0
        pc_free_percent = (free_pc / total_pc * 100) if total_pc > 0 else 0
        
        message = f"""📊 **TrueGamers Каменск-Уральский**
🕐 {timestamp}

💻 **ПК места:**
• Всего: {total_pc}
• 🟢 Свободно: {free_pc} ({pc_free_percent:.1f}%)
• 🔴 Занято: {occupied_pc} ({pc_occupied_percent:.1f}%)

📺 **TV места:**
• Всего: {total_tv}
• 🟢 Свободно: {free_tv}
• 🔴 Занято: {occupied_tv}"""
        
        if chat_id:
            await bot.send_message(chat_id=chat_id, text=message, parse_mode='Markdown')
        
        return message
        
    except Exception as e:
        error_msg = f"❌ Ошибка при получении посадки: {e}"
        logger.exception("Ошибка в send_posadka_text_only")
        if chat_id:
            try:
                await bot.send_message(chat_id=chat_id, text=error_msg)
            except:
                pass
        return error_msg


async def hourly_posadka_task():
    """Задача для отправки посадки каждый час"""
    global app_instance
    
    if not app_instance:
        logger.warning("⚠️ app_instance не инициализирован, пропускаю отправку посадки")
        return
    
    try:
        from config import TARGET_CHAT_ID
        
        # Определяем чат для отправки
        chat_id = TARGET_CHAT_ID
        
        if not chat_id:
            logger.warning("⚠️ TARGET_CHAT_ID не указан, посадка не будет отправлена автоматически")
            return
        
        logger.info(f"⏳ Отправляю посадку TrueGamers в чат {chat_id}...")
        message = await send_posadka_text_only(app_instance.bot, chat_id)
        logger.info(f"✅ Посадка отправлена: {message[:50]}...")
        
    except Exception as e:
        logger.exception(f"❌ Ошибка при отправке посадки каждый час: {e}")


async def monitor_places(context: ContextTypes.DEFAULT_TYPE):
    """Периодически проверяет статус мест"""
    global monitoring_active
    
    if not monitoring_active:
        return
    
    if not android.check_device_connected():
        await context.bot.send_message(
            chat_id=context.job.chat_id,
            text="❌ Эмулятор/устройство отключено! Мониторинг остановлен."
        )
        monitoring_active = False
        return
    
    # Открываем приложение, вводим PIN и открываем экран с местами
    android.open_app_and_places()
    await asyncio.sleep(3)  # Даем время на загрузку
    
    # Получаем статус мест через UI Automator и анализ скриншота
    status = android.get_places_status()
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Формируем сообщение со статусом
    if 'error' in status:
        message = f"❌ Ошибка при получении статуса: {status['error']}\n🕐 {timestamp}"
        if 'screenshot' in status:
            screenshot_path = status['screenshot']
            if os.path.exists(screenshot_path):
                await context.bot.send_photo(
                    chat_id=context.job.chat_id,
                    photo=open(screenshot_path, 'rb'),
                    caption=message
                )
            else:
                await context.bot.send_message(chat_id=context.job.chat_id, text=message)
        else:
            await context.bot.send_message(chat_id=context.job.chat_id, text=message)
    else:
        # Формируем детальное сообщение о местах
        total_pc = status.get('total_pc', 0)
        occupied_pc = status.get('occupied_pc', 0)
        free_pc = status.get('free_pc', 0)
        total_tv = status.get('total_tv', 0)
        occupied_tv = status.get('occupied_tv', 0)
        free_tv = status.get('free_tv', 0)
        
        # Вычисляем проценты
        pc_occupied_percent = (occupied_pc / total_pc * 100) if total_pc > 0 else 0
        pc_free_percent = (free_pc / total_pc * 100) if total_pc > 0 else 0
        
        message = f"""📊 Мониторинг мест TrueGamers
🕐 {timestamp}

💻 **ПК места:**
• Всего: {total_pc}
• 🟢 Свободно: {free_pc} ({pc_free_percent:.1f}%)
• 🔴 Занято: {occupied_pc} ({pc_occupied_percent:.1f}%)

📺 **TV места:**
• Всего: {total_tv}
• 🟢 Свободно: {free_tv}
• 🔴 Занято: {occupied_tv}
"""
        
        # Если есть скриншот, отправляем его
        if 'screenshot' in status:
            screenshot_path = status['screenshot']
            if os.path.exists(screenshot_path):
                await context.bot.send_photo(
                    chat_id=context.job.chat_id,
                    photo=open(screenshot_path, 'rb'),
                    caption=message,
                    parse_mode='Markdown'
                )
            else:
                await context.bot.send_message(
                    chat_id=context.job.chat_id, 
                    text=message,
                    parse_mode='Markdown'
                )
        else:
            await context.bot.send_message(
                chat_id=context.job.chat_id, 
                text=message,
                parse_mode='Markdown'
            )


async def start_monitor(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Начинает мониторинг"""
    global monitoring_active
    
    if not android.check_device_connected():
        await update.message.reply_text("❌ Устройство не подключено!")
        return
    
    if monitoring_active:
        await update.message.reply_text("⚠️ Мониторинг уже запущен!")
        return
    
    monitoring_active = True
    
    # Запускаем периодическую задачу
    context.job_queue.run_repeating(
        monitor_places,
        interval=MONITOR_INTERVAL,
        first=5,  # Первая проверка через 5 секунд
        chat_id=update.effective_chat.id,
        name=f"monitor_{update.effective_chat.id}"
    )
    
    await update.message.reply_text(
        f"✅ Мониторинг запущен!\n"
        f"Интервал проверки: {MONITOR_INTERVAL} секунд\n"
        f"Используйте /stop_monitor для остановки."
    )


async def stop_monitor(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Останавливает мониторинг"""
    global monitoring_active
    
    if not monitoring_active:
        await update.message.reply_text("⚠️ Мониторинг не запущен!")
        return
    
    monitoring_active = False
    
    # Останавливаем задачу
    job_name = f"monitor_{update.effective_chat.id}"
    current_jobs = context.job_queue.get_jobs_by_name(job_name)
    for job in current_jobs:
        job.schedule_removal()
    
    await update.message.reply_text("⏹ Мониторинг остановлен.")


async def screenshot(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Делает скриншот экрана (для настройки координат)"""
    if not android.check_device_connected():
        await update.message.reply_text("❌ Эмулятор/устройство не подключено!")
        return
    
    await update.message.reply_text("📸 Делаю скриншот...")
    
    screenshot_path = 'current_screenshot.png'
    if android.get_screenshot(screenshot_path) and os.path.exists(screenshot_path):
        screen_size = android.get_screen_size()
        await update.message.reply_photo(
            photo=open(screenshot_path, 'rb'),
            caption=f"📸 Текущий экран\n📐 Размер: {screen_size[0]}x{screen_size[1]}\n\n💡 Используйте этот скриншот для определения координат в config.py"
        )
    else:
        await update.message.reply_text("❌ Не удалось сделать скриншот.")


async def test_pin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Тестирует ввод PIN для настройки координат"""
    if not android.check_device_connected():
        await update.message.reply_text("❌ Эмулятор/устройство не подключено!")
        return
    
    await update.message.reply_text("🔐 Тестирую ввод PIN...")
    await update.message.reply_text("📱 Убедитесь, что приложение открыто и показан экран ввода пароля!")
    
    # Делаем скриншот до
    android.get_screenshot('test_before.png')
    
    # Вводим PIN
    from config import PIN_CODE
    success = android.input_pin(PIN_CODE)
    
    # Делаем скриншот после
    await asyncio.sleep(1)
    android.get_screenshot('test_after.png')
    
    # Отправляем скриншоты
    for screenshot_path, caption in [('test_before.png', '📸 До ввода PIN'), ('test_after.png', '📸 После ввода PIN')]:
        if os.path.exists(screenshot_path):
            try:
                await update.message.reply_photo(
                    photo=open(screenshot_path, 'rb'),
                    caption=caption
                )
            except Exception as e:
                logger.error(f"Ошибка при отправке скриншота: {e}")
    
    if success:
        await update.message.reply_text("✅ PIN введен! Проверьте скриншоты выше.")
        await update.message.reply_text("💡 Если цифры не нажались, обновите координаты PIN_KEYPAD в config.py")
    else:
        await update.message.reply_text("❌ Ошибка при вводе PIN. Проверьте координаты в config.py")


async def debug_clickable(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Показывает все кликабельные элементы на экране (для отладки)"""
    if not android.check_device_connected():
        await update.message.reply_text("❌ Эмулятор/устройство не подключено!")
        return
    
    await update.message.reply_text("🔍 Ищу все кликабельные элементы на экране...")
    
    # Делаем скриншот
    android.get_screenshot('debug_clickable.png')
    
    # Находим все кликабельные элементы
    elements = android.find_all_clickable_elements()
    
    if not elements:
        await update.message.reply_text("❌ Не найдено кликабельных элементов на экране.")
        await update.message.reply_text("💡 Проверьте, что приложение открыто и UI dump получен успешно")
        return
    
    # Ищем элементы, связанные с "Места"
    places_elements = []
    for elem in elements:
        text = (elem.get('text') or '').lower()
        content_desc = (elem.get('content_desc') or '').lower()
        resource_id = (elem.get('resource_id') or '').lower()
        
        if 'мест' in text or 'мест' in content_desc or 'place' in text or 'place' in content_desc:
            places_elements.append(elem)
    
    # Формируем сообщение со списком элементов
    message = f"📋 Найдено {len(elements)} кликабельных элементов:\n\n"
    
    # Сначала показываем элементы, связанные с "Места"
    if places_elements:
        message += "🎯 **Элементы, связанные с 'Места':**\n\n"
        for i, elem in enumerate(places_elements, 1):
            text = elem['text'] or '(нет текста)'
            content_desc = elem['content_desc'] or '(нет описания)'
            resource_id = elem['resource_id'] or '(нет ID)'
            center = elem['center']
            
            message += f"{i}. **{text}**\n"
            message += f"   Описание: {content_desc}\n"
            message += f"   Resource ID: `{resource_id}`\n"
            message += f"   Центр: `{center}`\n\n"
        message += "\n---\n\n"
    
    # Показываем первые 15 элементов
    shown_count = min(15, len(elements))
    message += f"**Первые {shown_count} кликабельных элементов:**\n\n"
    
    for i, elem in enumerate(elements[:shown_count], 1):
        text = elem['text'] or '(нет текста)'
        content_desc = elem['content_desc'] or '(нет описания)'
        resource_id = elem['resource_id'] or '(нет ID)'
        center = elem['center']
        
        message += f"{i}. **{text}**\n"
        message += f"   Описание: {content_desc}\n"
        message += f"   Resource ID: `{resource_id}`\n"
        message += f"   Центр: `{center}`\n\n"
    
    if len(elements) > shown_count:
        message += f"\n... и еще {len(elements) - shown_count} элементов"
    
    # Отправляем скриншот и список
    try:
        await update.message.reply_photo(
            photo=open('debug_clickable.png', 'rb'),
            caption="📸 Текущий экран"
        )
    except Exception as e:
        logger.error(f"Ошибка при отправке скриншота: {e}")
    
    # Разбиваем сообщение на части, если оно слишком длинное
    if len(message) > 4000:
        parts = message.split('\n\n')
        current_part = ""
        for part in parts:
            if len(current_part) + len(part) > 4000:
                await update.message.reply_text(current_part, parse_mode='Markdown')
                current_part = part + "\n\n"
            else:
                current_part += part + "\n\n"
        if current_part:
            await update.message.reply_text(current_part, parse_mode='Markdown')
    else:
        await update.message.reply_text(message, parse_mode='Markdown')
    
    await update.message.reply_text(
        "💡 Используйте эту информацию для настройки координат в config.py\n"
        "Или найдите элемент с текстом 'Места' и используйте его координаты.\n"
        "UI dump сохранен в ui_dump.xml для детального анализа."
    )


async def analyze_places(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Анализирует текущий экран с местами"""
    if not android.check_device_connected():
        await update.message.reply_text("❌ Эмулятор/устройство не подключено!")
        return
    
    await update.message.reply_text("📊 Анализирую места на текущем экране...")
    await update.message.reply_text("📱 Убедитесь, что экран с местами открыт!")
    
    # Анализируем места
    status = android.get_places_status()
    
    if 'error' in status:
        message = f"❌ Ошибка при анализе: {status['error']}"
        if 'screenshot' in status and os.path.exists(status['screenshot']):
            await update.message.reply_photo(
                photo=open(status['screenshot'], 'rb'),
                caption=message
            )
        else:
            await update.message.reply_text(message)
        return
    
    # Формируем детальное сообщение
    total_pc = status.get('total_pc', 0)
    occupied_pc = status.get('occupied_pc', 0)
    free_pc = status.get('free_pc', 0)
    total_tv = status.get('total_tv', 0)
    occupied_tv = status.get('occupied_tv', 0)
    free_tv = status.get('free_tv', 0)
    
    # Вычисляем проценты
    pc_occupied_percent = (occupied_pc / total_pc * 100) if total_pc > 0 else 0
    pc_free_percent = (free_pc / total_pc * 100) if total_pc > 0 else 0
    
    message = f"""📊 **Анализ мест TrueGamers**

💻 **ПК места:**
• Всего: {total_pc}
• 🟢 Свободно: {free_pc} ({pc_free_percent:.1f}%)
• 🔴 Занято: {occupied_pc} ({pc_occupied_percent:.1f}%)

📺 **TV места:**
• Всего: {total_tv}
• 🟢 Свободно: {free_tv}
• 🔴 Занято: {occupied_tv}
"""
    
    # Отправляем скриншот и статистику
    if 'screenshot' in status and os.path.exists(status['screenshot']):
        try:
            await update.message.reply_photo(
                photo=open(status['screenshot'], 'rb'),
                caption=message,
                parse_mode='Markdown'
            )
        except Exception as e:
            logger.error(f"Ошибка при отправке скриншота: {e}")
            await update.message.reply_text(message, parse_mode='Markdown')
    else:
        await update.message.reply_text(message, parse_mode='Markdown')
    
    # Показываем детали по каждому месту (первые 10)
    if status.get('pc_places'):
        details = "📋 **Детали ПК мест (первые 10):**\n\n"
        for i, place in enumerate(status['pc_places'][:10], 1):
            status_emoji = '🔴' if place['status'] == 'occupied' else '🟢' if place['status'] == 'free' else '⚪'
            text = place.get('text') or place.get('content_desc') or f"Место {i}"
            details += f"{i}. {status_emoji} {text} - {place['status']}\n"
        
        if len(status['pc_places']) > 10:
            details += f"\n... и еще {len(status['pc_places']) - 10} мест"
        
        await update.message.reply_text(details, parse_mode='Markdown')


async def test_tap(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Тестирует нажатие на указанные координаты с несколькими методами"""
    if not android.check_device_connected():
        await update.message.reply_text("❌ Эмулятор/устройство не подключено!")
        return
    
    # Получаем координаты из сообщения или используем координаты кнопки "Места"
    from config import PLACES_BUTTON
    x, y = PLACES_BUTTON
    
    await update.message.reply_text(f"👆 Тестирую нажатие на координаты ({x}, {y})...")
    await update.message.reply_text("📱 Убедитесь, что приложение открыто и показан главный экран!")
    
    # Делаем скриншот до
    android.get_screenshot('test_tap_before.png')
    
    # Пробуем несколько методов нажатия
    success = False
    
    # Метод 1: Нажатие в нескольких точках вокруг
    await update.message.reply_text("🔍 Пробую нажать в нескольких точках вокруг кнопки...")
    offsets = [(0, 0), (-30, -30), (30, 30), (-30, 30), (30, -30)]
    for offset_x, offset_y in offsets:
        tap_x, tap_y = x + offset_x, y + offset_y
        if android.tap(tap_x, tap_y):
            await asyncio.sleep(2)
            android.get_screenshot(f'test_tap_after_offset_{offset_x}_{offset_y}.png')
            success = True
            break
        await asyncio.sleep(0.5)
    
    # Метод 2: Долгое нажатие
    if not success:
        await update.message.reply_text("🔍 Пробую долгое нажатие...")
        success = android.long_tap(x, y, duration=500)
        if success:
            await asyncio.sleep(2)
            android.get_screenshot('test_tap_after_long.png')
    
    # Метод 3: Обычное нажатие несколько раз
    if not success:
        await update.message.reply_text("🔍 Пробую обычное нажатие несколько раз...")
        for i in range(3):
            if android.tap(x, y):
                success = True
                await asyncio.sleep(2)
                android.get_screenshot(f'test_tap_after_normal_{i}.png')
                break
            await asyncio.sleep(0.5)
    
    # Отправляем скриншоты
    screenshots = [('test_tap_before.png', f'📸 До нажатия на ({x}, {y})')]
    
    # Находим все скриншоты после нажатия
    for screenshot_path in glob.glob('test_tap_after*.png'):
        screenshots.append((screenshot_path, f'📸 После нажатия'))
    
    for screenshot_path, caption in screenshots:
        if os.path.exists(screenshot_path):
            try:
                await update.message.reply_photo(
                    photo=open(screenshot_path, 'rb'),
                    caption=caption
                )
            except Exception as e:
                logger.error(f"Ошибка при отправке скриншота: {e}")
    
    if success:
        await update.message.reply_text(f"✅ Нажатие выполнено! Проверьте скриншоты выше.")
        await update.message.reply_text("💡 Если кнопка не нажалась, проверьте координаты в скриншоте 'До нажатия'")
    else:
        await update.message.reply_text(f"❌ Не удалось нажать на ({x}, {y}) всеми методами.")
        await update.message.reply_text("💡 Проверьте скриншот 'До нажатия' и обновите координаты в config.py")


async def status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Показывает статус устройства и приложения"""
    device_connected = android.check_device_connected()
    app_running = android.is_app_running() if device_connected else False
    
    current_activity = ""
    if device_connected and app_running:
        current_activity = android.get_current_activity()
        if not current_activity:
            current_activity = "Не удалось определить"
    
    status_text = f"""
📊 Статус системы:

🔌 Устройство: {'✅ Подключено' if device_connected else '❌ Не подключено'}
📱 Приложение: {'✅ Запущено' if app_running else '❌ Не запущено'}
🔄 Мониторинг: {'✅ Активен' if monitoring_active else '❌ Остановлен'}
    """
    
    if current_activity:
        status_text += f"\n📋 Активность: `{current_activity}`"
    
    await update.message.reply_text(status_text, parse_mode='Markdown')


def main():
    """Запускает бота"""
    global app_instance, scheduler
    
    if not TELEGRAM_BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN не установлен! Создайте файл .env")
        return
    
    # Создаем приложение
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    app_instance = application  # Сохраняем для использования в планировщике
    
    # Обработчик входа (conversation)
    login_handler = ConversationHandler(
        entry_points=[CommandHandler('login', login_start)],
        states={
            PHONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, login_phone)],
            PASSWORD: [MessageHandler(filters.TEXT & ~filters.COMMAND, login_password)],
        },
        fallbacks=[CommandHandler('cancel', cancel)],
    )
    
    # Регистрируем обработчики
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("check_device", check_device))
    application.add_handler(CommandHandler("screenshot", screenshot))
    application.add_handler(CommandHandler("test_pin", test_pin))
    application.add_handler(CommandHandler("test_tap", test_tap))
    application.add_handler(CommandHandler("debug_clickable", debug_clickable))
    application.add_handler(CommandHandler("analyze_places", analyze_places))
    application.add_handler(login_handler)
    application.add_handler(CommandHandler("select_club", select_club))
    application.add_handler(CommandHandler("open_places", open_places))
    application.add_handler(CommandHandler("monitor", start_monitor))
    application.add_handler(CommandHandler("stop_monitor", stop_monitor))
    application.add_handler(CommandHandler("status", status))
    
    # Настраиваем планировщик для отправки посадки каждый час
    try:
        from config import LOCAL_TZ
        local_tz = timezone(LOCAL_TZ) if LOCAL_TZ else timezone("Asia/Yekaterinburg")
        
        scheduler = AsyncIOScheduler(timezone=local_tz)
        
        # Добавляем задачу отправки посадки каждый час (в 0 минут каждого часа)
        scheduler.add_job(
            hourly_posadka_task,
            trigger="cron",
            minute=0,
            id="hourly_posadka",
            replace_existing=True
        )
        
        scheduler.start()
        logger.info("🕒 Планировщик запущен - посадка будет отправляться каждый час")
    except Exception as e:
        logger.warning(f"⚠️ Не удалось запустить планировщик: {e}")
        scheduler = None
    
    # Запускаем бота
    logger.info("Бот запущен...")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == '__main__':
    main()

