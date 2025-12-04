"""
Модуль для работы с API клуба COLIZEUM
"""
import logging
import json
import os
import asyncio
import time
from datetime import datetime
from typing import Optional, Dict, List, Any
from statistics import mean

try:
    import aiohttp
    HAS_AIOHTTP = True
except ImportError:
    try:
        import requests
        HAS_AIOHTTP = False
    except ImportError:
        HAS_AIOHTTP = False

logger = logging.getLogger(__name__)

# Кэш схемы клуба
_schema_cache: Optional[Dict[str, Any]] = None
_schema_cache_time: float = 0
last_message_id: Optional[int] = None


async def fetch_schema_async(domain: str, api_key: str, proxy_url: str, max_retries: int = 3, retry_delay: int = 2, cache_ttl: int = 3600) -> Dict[str, str]:
    """Асинхронно получает схему клуба (UUID -> имя/номер места) с кэшированием"""
    global _schema_cache, _schema_cache_time
    
    # Проверяем кэш
    current_time = time.time()
    if _schema_cache and (current_time - _schema_cache_time) < cache_ttl:
        logger.debug("Используем кэшированную схему")
        return _schema_cache
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Bot)",
        "X-Request-Token": api_key,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept": "application/json",
        "Origin": "https://mapclub.langame.ru",
        "Referer": "https://mapclub.langame.ru/map_club/",
    }
    
    data = {"type": "clubSchema", "club_id": 1, "domain": domain}
    
    for attempt in range(max_retries):
        try:
            if HAS_AIOHTTP:
                async with aiohttp.ClientSession() as session:
                    async with session.post(proxy_url, headers=headers, data=data, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                        resp.raise_for_status()
                        result = await resp.json()
                        payload = result.get("data", [])
            else:
                resp = requests.post(proxy_url, headers=headers, data=data, timeout=10)
                resp.raise_for_status()
                payload = resp.json().get("data", [])
            
            seats = {}
            for item in payload:
                if item.get("scheme_type") == "seat":
                    name = str(item.get("text", "")).strip()
                    if name:
                        seats[item["UUID"]] = name
            
            # Обновляем кэш
            _schema_cache = seats
            _schema_cache_time = current_time
            logger.info("Схема клуба загружена: %s мест", len(seats))
            return seats
            
        except Exception as e:
            logger.warning("Ошибка clubSchema (попытка %s/%s): %s", attempt + 1, max_retries, e)
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay * (attempt + 1))
            else:
                logger.error("Не удалось загрузить схему после %s попыток", max_retries)
                if _schema_cache:
                    logger.warning("Используем устаревшую схему из кэша")
                    return _schema_cache
                return {}


async def fetch_status_async(domain: str, api_key: str, proxy_url: str, max_retries: int = 3, retry_delay: int = 2) -> List[Dict[str, Any]]:
    """Асинхронно получает статусы ПК"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Bot)",
        "X-Request-Token": api_key,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept": "application/json",
        "Origin": "https://mapclub.langame.ru",
        "Referer": "https://mapclub.langame.ru/map_club/",
    }
    
    data = {"type": "pcStatus", "club_id": 1, "domain": domain}
    
    for attempt in range(max_retries):
        try:
            if HAS_AIOHTTP:
                async with aiohttp.ClientSession() as session:
                    async with session.post(proxy_url, headers=headers, data=data, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                        resp.raise_for_status()
                        result = await resp.json()
                        return result.get("data", [])
            else:
                resp = requests.post(proxy_url, headers=headers, data=data, timeout=10)
                resp.raise_for_status()
                return resp.json().get("data", [])
        except Exception as e:
            logger.warning("Ошибка pcStatus (попытка %s/%s): %s", attempt + 1, max_retries, e)
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay * (attempt + 1))
            else:
                logger.error("Не удалось загрузить статусы после %s попыток", max_retries)
                return []


async def compute_posadka_async(domain: str, api_key: str, proxy_url: str, max_retries: int = 3, retry_delay: int = 2, cache_ttl: int = 3600) -> Optional[Dict[str, Any]]:
    """Асинхронно комбинирует данные схемы и статусы"""
    schema = await fetch_schema_async(domain, api_key, proxy_url, max_retries, retry_delay, cache_ttl)
    statuses = await fetch_status_async(domain, api_key, proxy_url, max_retries, retry_delay)
    
    if not schema or not statuses:
        logger.warning("Недостаточно данных: schema=%s, statuses=%s", len(schema) if schema else 0, len(statuses) if statuses else 0)
        return None

    busy_pc, busy_tv = [], []
    for s in statuses:
        uuid = s.get("UUID")
        state = s.get("status")  # False = занято
        if uuid in schema and state is False:
            name = schema[uuid]
            if name.upper().startswith("TV"):
                busy_tv.append(name)
            else:
                busy_pc.append(name)

    all_pc = [v for v in schema.values() if not v.upper().startswith("TV")]
    all_tv = [v for v in schema.values() if v.upper().startswith("TV")]

    try:
        busy_pc = sorted(set(busy_pc), key=lambda x: int(x))
    except Exception:
        busy_pc = sorted(set(busy_pc))
    busy_tv = sorted(set(busy_tv))

    total_pc, total_tv = len(all_pc), len(all_tv)
    free_pc, free_tv = total_pc - len(busy_pc), total_tv - len(busy_tv)

    return {
        "busy_pc": busy_pc,
        "total_pc": total_pc,
        "free_pc": free_pc,
        "busy_tv": busy_tv,
        "total_tv": total_tv,
        "free_tv": free_tv,
    }


def format_colizeum_message(result: Dict[str, Any]) -> str:
    """Форматирует сообщение о посадке COLIZEUM"""
    now = datetime.now().strftime("%H:%M")
    busy_pc_str = ", ".join(result["busy_pc"]) if result["busy_pc"] else "—"
    busy_tv_str = ", ".join(result["busy_tv"]) if result["busy_tv"] else "—"

    return (
        f"💻 *Посадка COLIZEUM:*\n"
        f"Занято: `{len(result['busy_pc'])}`\n"
        f"Свободно: `{result['free_pc']}`\n"
        f"Всего ПК: `{result['total_pc']}`\n"
        f"💡 Номера занятых: `{busy_pc_str}`\n\n"
        f"📺 *TV-зона:*\n"
        f"Занято: `{len(result['busy_tv'])}`\n"
        f"Свободно: `{result['free_tv']}`\n"
        f"Всего ТВ: `{result['total_tv']}`\n"
        f"💡 Занятые ТВ: `{busy_tv_str}`\n\n"
        f"_Обновлено: {now}_"
    )


def save_stat(busy: int, total: int, stats_file: str) -> None:
    """Сохраняет статистику в JSON файл"""
    day = datetime.now().strftime("%Y-%m-%d")
    stats = {}
    if os.path.exists(stats_file):
        try:
            with open(stats_file, "r", encoding="utf-8") as f:
                stats = json.load(f)
        except Exception as e:
            logger.warning("Ошибка чтения статистики: %s", e)
            stats = {}
    
    if not isinstance(stats, dict):
        stats = {}
    
    stats.setdefault(day, []).append(
        {"time": datetime.now().strftime("%H:%M"), "busy": busy, "total": total}
    )
    
    try:
        with open(stats_file, "w", encoding="utf-8") as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error("Ошибка записи статистики: %s", e)


def shift_summary(stats_file: str) -> str:
    """Формирует итог смены"""
    if not os.path.exists(stats_file):
        return "📊 Нет данных за сегодня."
    with open(stats_file, "r", encoding="utf-8") as f:
        stats = json.load(f)
    day = datetime.now().strftime("%Y-%m-%d")
    if day not in stats or not stats[day]:
        return "📊 Сегодня без данных."
    arr = [x["busy"] for x in stats[day]]
    total = stats[day][0]["total"]
    return (
        f"🕘 *Итог смены COLIZEUM за {day}:*\n\n"
        f"💻 Средняя посадка: `{round(mean(arr),1)}/{total}`\n"
        f"🔝 Пик занятости: `{max(arr)}`\n"
        f"🔻 Минимум занято: `{min(arr)}`\n"
        f"📅 Замеров за день: `{len(arr)}`\n\n"
        f"_Отправлено автоматически в 21:00 (Екб)_"
    )

