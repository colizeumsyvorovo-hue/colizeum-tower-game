"""
Объединенный бот для мониторинга посадки COLIZEUM и TrueGamers
"""
import os
import re
import csv
import json
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional
from pytz import timezone
from logging.handlers import RotatingFileHandler

from telegram import Update, ReplyKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)
from apscheduler.schedulers.background import BackgroundScheduler

# Импортируем модули
from modules.colizeum_api import compute_posadka_async, format_colizeum_message, save_stat as save_colizeum_stat, shift_summary as colizeum_shift_summary
from modules.truegamers_automation import AndroidAutomation
from config import (
    TELEGRAM_TOKEN, TARGET_CHAT_ID, STATS_FILE, MAX_DAYS, LOCAL_TZ,
    COLIZEUM_DOMAIN, COLIZEUM_API_KEY, COLIZEUM_PROXY_URL, MAX_RETRIES, RETRY_DELAY, SCHEMA_CACHE_TTL
)

# Настройка логирования
log_file = "bot.log"
handler = RotatingFileHandler(log_file, maxBytes=5_000_000, backupCount=3, encoding="utf-8")
formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
handler.setFormatter(formatter)
root_logger = logging.getLogger()
root_logger.addHandler(handler)
root_logger.setLevel(logging.INFO)
logger = logging.getLogger(__name__)

# Глобальные переменные
android = AndroidAutomation()
scheduler = None
app_instance = None

# ========== HELPERS ==========
def safe_load(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.exception("Ошибка чтения JSON %s: %s", path, e)
        return {}

def safe_save(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.exception("Ошибка записи JSON %s: %s", path, e)

def prune_old_days(path, max_days=MAX_DAYS):
    data = safe_load(path)
    if not isinstance(data, dict):
        return
    cutoff = datetime.now().date() - timedelta(days=max_days - 1)
    keep = {}
    for day_str, arr in data.items():
        try:
            day_date = datetime.strptime(day_str, "%Y-%m-%d").date()
            if day_date >= cutoff:
                keep[day_str] = arr
        except Exception:
            continue
    safe_save(path, keep)

def get_last_busy() -> Optional[int]:
    """Получает последнее значение busy из статистики"""
    s = safe_load(STATS_FILE)
    if not isinstance(s, dict) or not s:
        return None
    today = datetime.now().strftime("%Y-%m-%d")
    if today in s and s[today]:
        try:
            return int(s[today][-1].get("busy", 0))
        except (ValueError, KeyError, IndexError):
            pass
    days = sorted(s.keys(), reverse=True)
    for d in days:
        arr = s.get(d, [])
        if arr:
            try:
                return int(arr[-1].get("busy", 0))
            except (ValueError, KeyError, IndexError):
                continue
    return None

# ========== ASYNC UTILS ==========
def run_async(func, *args):
    """Безопасный запуск async функций из синхронного контекста"""
    import threading
    def wrapper():
        try:
            logger.info(f"🔄 Запуск async функции {func.__name__} в отдельном потоке...")
            # Создаем новый event loop для этого потока
            new_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(new_loop)
            try:
                new_loop.run_until_complete(func(*args))
            finally:
                new_loop.close()
            logger.info(f"✅ Функция {func.__name__} завершена")
        except Exception as e:
            logger.exception(f"❌ Ошибка при выполнении {func.__name__}: {e}")
    
    thread = threading.Thread(target=wrapper, daemon=True)
    thread.start()
    logger.info(f"📌 Поток для {func.__name__} запущен")

# ========== COLIZEUM POSADKA ==========
async def validated_send_colizeum_posadka(bot):
    """Отправка посадки COLIZEUM с проверкой"""
    try:
        logger.info("🔍 Проверка достоверности посадки COLIZEUM")
        result = await compute_posadka_async(
            COLIZEUM_DOMAIN, COLIZEUM_API_KEY, COLIZEUM_PROXY_URL,
            MAX_RETRIES, RETRY_DELAY, SCHEMA_CACHE_TTL
        )
        
        if not result:
            last_busy = get_last_busy()
            if last_busy and last_busy > 0:
                logger.info("Используем последний busy=%s", last_busy)
                return True
            return False

        busy = len(result["busy_pc"])

        if busy == 0:
            logger.warning("🚫 Анти-ноль: занято=0, повтор через 30 сек.")
            await asyncio.sleep(30)
            result2 = await compute_posadka_async(
                COLIZEUM_DOMAIN, COLIZEUM_API_KEY, COLIZEUM_PROXY_URL,
                MAX_RETRIES, RETRY_DELAY, SCHEMA_CACHE_TTL
            )
            if result2:
                busy2 = len(result2["busy_pc"])
                if busy2 and busy2 > 0:
                    logger.info("✅ Повтор успешен — занято %s", busy2)
                    busy = busy2
                    result = result2
                else:
                    await bot.send_message(chat_id=TARGET_CHAT_ID, text="⚠️ Посадка не подтверждена (занято=0).")
                    return False
            else:
                await bot.send_message(chat_id=TARGET_CHAT_ID, text="⚠️ Посадка не получена (ошибка).")
                return False

        busy_count = len(result["busy_pc"])
        save_colizeum_stat(busy_count, result["total_pc"], STATS_FILE)
        text = format_colizeum_message(result)
        
        await bot.send_message(chat_id=TARGET_CHAT_ID, text=text, parse_mode="Markdown")
        logger.info("✅ Посадка COLIZEUM отправлена — занято %s", busy_count)
        return True

    except Exception as e:
        logger.exception("Ошибка в validated_send_colizeum_posadka: %s", e)
        await bot.send_message(chat_id=TARGET_CHAT_ID, text=f"⚠️ Ошибка при проверке посадки: {e}")
        return False

# ========== TRUEGAMERS POSADKA ==========
async def send_truegamers_posadka_text_only(bot, chat_id: int = None) -> str:
    """Отправляет посадку TrueGamers только текстом (без фото)"""
    # Если chat_id не передан, используем TARGET_CHAT_ID из конфига
    if not chat_id:
        chat_id = TARGET_CHAT_ID
    
    if not chat_id:
        logger.error("⚠️ chat_id не указан, невозможно отправить посадку TrueGamers")
        return "❌ Chat ID не указан!"
    
    # Проверяем подключение устройства
    if not android.check_device_connected():
        error_msg = "❌ Эмулятор/устройство не подключено!"
        logger.warning(error_msg)
        try:
            await bot.send_message(chat_id=chat_id, text=error_msg)
        except Exception as e:
            logger.error(f"Ошибка отправки сообщения об отсутствии устройства: {e}")
        return error_msg
    
    try:
        logger.info("📱 Открываю приложение TrueGamers...")
        android.open_app_and_places()
        await asyncio.sleep(3)
        
        logger.info("📊 Получаю статус мест...")
        status = android.get_places_status()
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        if 'error' in status:
            message = f"❌ Ошибка при получении статуса: {status['error']}\n🕐 {timestamp}"
            logger.error(f"Ошибка получения статуса: {status['error']}")
            try:
                await bot.send_message(chat_id=chat_id, text=message)
            except Exception as e:
                logger.error(f"Ошибка отправки сообщения об ошибке: {e}")
            return message
        
        total_pc = status.get('total_pc', 0)
        occupied_pc = status.get('occupied_pc', 0)
        free_pc = status.get('free_pc', 0)
        total_tv = status.get('total_tv', 0)
        occupied_tv = status.get('occupied_tv', 0)
        free_tv = status.get('free_tv', 0)
        
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
        
        logger.info(f"📤 Отправляю посадку TrueGamers в чат {chat_id}...")
        try:
            await bot.send_message(chat_id=chat_id, text=message, parse_mode='Markdown')
            logger.info("✅ Посадка TrueGamers успешно отправлена")
        except Exception as e:
            logger.error(f"❌ Ошибка отправки сообщения в чат {chat_id}: {e}")
            raise
        
        return message
        
    except Exception as e:
        error_msg = f"❌ Ошибка при получении посадки TrueGamers: {e}"
        logger.exception("Ошибка в send_truegamers_posadka_text_only")
        try:
            await bot.send_message(chat_id=chat_id, text=error_msg)
        except Exception as send_error:
            logger.error(f"❌ Не удалось отправить сообщение об ошибке: {send_error}")
        return error_msg

# ========== HOURLY TASKS ==========
async def hourly_posadka_task(app):
    """Задача для отправки посадки каждый час"""
    logger.info("🔔 Вызвана функция hourly_posadka_task")
    
    if not app:
        logger.error("⚠️ app не передан - посадка не будет отправлена!")
        return
    
    if not TARGET_CHAT_ID:
        logger.error("⚠️ TARGET_CHAT_ID не установлен - посадка не будет отправлена!")
        return
    
    try:
        logger.info(f"⏳ Начало отправки посадки в чат {TARGET_CHAT_ID}...")
        logger.info(f"⏰ Время: {datetime.now(timezone(LOCAL_TZ)).strftime('%Y-%m-%d %H:%M:%S')}")
        
        # Отправляем COLIZEUM
        try:
            logger.info("📤 Отправляю посадку COLIZEUM...")
            await validated_send_colizeum_posadka(app.bot)
            logger.info("✅ Посадка COLIZEUM отправлена")
        except Exception as e:
            logger.exception(f"❌ Ошибка при отправке посадки COLIZEUM: {e}")
            try:
                await app.bot.send_message(
                    chat_id=TARGET_CHAT_ID,
                    text=f"⚠️ Ошибка при отправке посадки COLIZEUM: {e}"
                )
            except:
                pass
        
        # Небольшая задержка между отправками
        await asyncio.sleep(2)
        
        # Отправляем TrueGamers
        try:
            logger.info("📤 Отправляю посадку TrueGamers...")
            await send_truegamers_posadka_text_only(app.bot, TARGET_CHAT_ID)
            logger.info("✅ Посадка TrueGamers отправлена")
        except Exception as e:
            logger.exception(f"❌ Ошибка при отправке посадки TrueGamers: {e}")
            # Сообщение об ошибке уже отправлено внутри функции
        
        logger.info("✅ Процесс отправки посадки завершен")
        
    except Exception as e:
        logger.exception(f"❌ Критическая ошибка при отправке посадки каждый час: {e}")
        try:
            await app.bot.send_message(
                chat_id=TARGET_CHAT_ID,
                text=f"❌ Критическая ошибка при отправке посадки: {e}"
            )
        except:
            pass

# ========== TELEGRAM HANDLERS ==========
async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик команды /start"""
    try:
        keyboard = [
            ["📊 Посадка COLIZEUM", "📊 Посадка TrueGamers"],
            ["📈 Итог смены", "📥 Экспорт CSV"]
        ]
        markup = ReplyKeyboardMarkup(keyboard, resize_keyboard=True)
        await update.message.reply_text(
            "👋 Привет! Я объединенный бот для мониторинга посадки.\n\n"
            "Доступные команды:\n"
            "• /start - Показать меню\n"
            "• Посадка отправляется автоматически каждый час\n\n"
            "Выбери действие:",
            reply_markup=markup
        )
    except Exception as e:
        logger.exception("Ошибка в start_cmd: %s", e)

async def text_router(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик текстовых сообщений"""
    try:
        if not update.message or not update.message.text:
            return
        
        text = update.message.text.lower()
        
        if "посадка colizeum" in text or "посадка колизеум" in text:
            await update.message.reply_text("⏳ Проверяю посадку COLIZEUM...")
            ok = await validated_send_colizeum_posadka(context.bot)
            if ok:
                await update.message.reply_text("✅ Посадка COLIZEUM отправлена/подтверждена.")
            else:
                await update.message.reply_text("⚠️ Посадка не подтверждена.")
        
        elif "посадка truegamers" in text or "посадка тругеймерс" in text:
            await update.message.reply_text("⏳ Проверяю посадку TrueGamers...")
            try:
                # Отправляем в TARGET_CHAT_ID, как и COLIZEUM
                if not TARGET_CHAT_ID:
                    await update.message.reply_text("❌ TARGET_CHAT_ID не настроен!")
                    return
                    
                message = await send_truegamers_posadka_text_only(context.bot, TARGET_CHAT_ID)
                if "❌" not in message:
                    await update.message.reply_text("✅ Посадка TrueGamers отправлена в чат.")
                else:
                    await update.message.reply_text(f"⚠️ {message}")
            except Exception as e:
                logger.exception("Ошибка при запросе посадки TrueGamers: %s", e)
                await update.message.reply_text(f"❌ Ошибка: {e}")
        
        elif "итог" in text or "смен" in text:
            await update.message.reply_text("⏳ Формирую итог смены...")
            summary = colizeum_shift_summary(STATS_FILE)
            await update.message.reply_text(summary, parse_mode="Markdown")
        
        elif "экспорт" in text or "csv" in text:
            await csv_export_cmd(update, context)
            
    except Exception as e:
        logger.exception("Ошибка в text_router: %s", e)
        try:
            await update.message.reply_text("⚠️ Произошла ошибка при обработке команды.")
        except:
            pass

async def csv_export_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Экспорт статистики в CSV"""
    try:
        await update.message.reply_text("⏳ Создаю CSV файл...")
        filename = export_stats_to_csv(days=MAX_DAYS)
        if filename and os.path.exists(filename):
            with open(filename, "rb") as f:
                await update.message.reply_document(
                    document=f,
                    filename=filename,
                    caption=f"📊 Статистика за последние {MAX_DAYS} дней"
                )
            try:
                os.remove(filename)
            except:
                pass
        else:
            await update.message.reply_text("❌ Не удалось создать CSV файл или нет данных.")
    except Exception as e:
        logger.exception("Ошибка в csv_export_cmd: %s", e)
        await update.message.reply_text("⚠️ Произошла ошибка при экспорте.")

def export_stats_to_csv(days: int = 7) -> Optional[str]:
    """Экспортирует статистику в CSV файл"""
    try:
        stats = safe_load(STATS_FILE)
        if not stats:
            return None
        
        cutoff = datetime.now().date() - timedelta(days=days - 1)
        filename = f"stats_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        
        with open(filename, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["Дата", "Время", "Занято", "Всего", "Свободно", "Процент"])
            
            for day_str in sorted(stats.keys()):
                try:
                    day_date = datetime.strptime(day_str, "%Y-%m-%d").date()
                    if day_date < cutoff:
                        continue
                    
                    for entry in stats[day_str]:
                        busy = entry.get("busy", 0)
                        total = entry.get("total", 0)
                        free = total - busy
                        percent = round((busy / total * 100) if total > 0 else 0, 1)
                        writer.writerow([
                            day_str,
                            entry.get("time", ""),
                            busy,
                            total,
                            free,
                            f"{percent}%"
                        ])
                except Exception as e:
                    logger.warning("Ошибка обработки дня %s: %s", day_str, e)
                    continue
        
        logger.info("CSV экспорт создан: %s", filename)
        return filename
    except Exception as e:
        logger.exception("Ошибка экспорта CSV: %s", e)
        return None

# ========== SCHEDULER ==========
def start_scheduler(app):
    """Запускает планировщик задач"""
    global scheduler
    
    try:
        local_tz = timezone(LOCAL_TZ)
        scheduler = BackgroundScheduler(timezone=local_tz)
        
        # Посадка каждый час (0 минут)
        scheduler.add_job(
            lambda: run_async(hourly_posadka_task, app),
            trigger="cron",
            minute=0,
            id="hourly_posadka",
            replace_existing=True
        )
        
        # Итог смены в 21:00
        async def send_shift_report():
            if TARGET_CHAT_ID:
                summary = colizeum_shift_summary(STATS_FILE)
                await app.bot.send_message(
                    chat_id=TARGET_CHAT_ID,
                    text=summary,
                    parse_mode="Markdown"
                )
        
        scheduler.add_job(
            lambda: run_async(send_shift_report),
            trigger="cron",
            hour=21,
            minute=0,
            id="shift_report",
            replace_existing=True
        )
        
        # Очистка старых данных в 8:00
        scheduler.add_job(
            lambda: prune_old_days(STATS_FILE),
            trigger="cron",
            hour=8,
            minute=0,
            id="prune_stats",
            replace_existing=True
        )
        
        scheduler.start()
        logger.info("🕒 Планировщик запущен (ежечасные отчёты, итог в 21:00, очистка в 8:00).")
        logger.info(f"📅 Следующая отправка посадки в 0 минут следующего часа (часовой пояс: {LOCAL_TZ})")
        logger.info(f"✅ TARGET_CHAT_ID: {TARGET_CHAT_ID}")
        logger.info(f"✅ app_instance установлен: {app_instance is not None}")
        
        # Показываем список задач
        jobs = scheduler.get_jobs()
        logger.info(f"📋 Запланировано задач: {len(jobs)}")
        for job in jobs:
            logger.info(f"   - {job.id}: следующий запуск {job.next_run_time}")
    except Exception as e:
        logger.exception(f"⚠️ Не удалось запустить планировщик: {e}")

# ========== MAIN ==========
def main():
    """Запускает бота"""
    global app_instance
    
    if not TELEGRAM_TOKEN:
        logger.error("TELEGRAM_TOKEN не установлен! Создайте файл .env")
        return
    
    try:
        app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
        app_instance = app
        
        app.add_handler(CommandHandler("start", start_cmd))
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_router))
        
        start_scheduler(app)
        
        logger.info("✅ Объединенный бот запущен.")
        app.run_polling()
        
    except KeyboardInterrupt:
        logger.info("Бот остановлен пользователем")
    except Exception as e:
        logger.exception("Критическая ошибка при запуске бота: %s", e)
        raise

if __name__ == "__main__":
    main()

