"""
Модуль для автоматизации Android приложения через ADB
"""
import subprocess
import time
import json
from typing import Optional, Dict, List
from config import ADB_PATH, DEVICE_ID, TRUEGAMERS_PACKAGE, TRUEGAMERS_ACTIVITY, PIN_CODE


class AndroidAutomation:
    """Класс для автоматизации Android через ADB"""
    
    def __init__(self):
        self.adb_path = ADB_PATH
        self.device_id = DEVICE_ID
        self.package = TRUEGAMERS_PACKAGE
        
    def _run_adb_command(self, command: List[str]) -> tuple:
        """Выполняет ADB команду"""
        full_command = [self.adb_path]
        if self.device_id:
            full_command.extend(['-s', self.device_id])
        full_command.extend(command)
        
        try:
            result = subprocess.run(
                full_command,
                capture_output=True,
                text=True,
                timeout=10
            )
            return result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            return "", "Timeout"
        except Exception as e:
            return "", str(e)
    
    def check_device_connected(self) -> bool:
        """Проверяет подключение устройства"""
        stdout, stderr = self._run_adb_command(['devices'])
        devices = [line for line in stdout.split('\n') if '\tdevice' in line]
        return len(devices) > 0
    
    def get_device_info(self) -> Dict:
        """Получает информацию об устройстве"""
        info = {}
        stdout, _ = self._run_adb_command(['shell', 'getprop', 'ro.product.model'])
        info['model'] = stdout.strip()
        stdout, _ = self._run_adb_command(['shell', 'getprop', 'ro.build.version.release'])
        info['android_version'] = stdout.strip()
        return info
    
    def tap(self, x: int, y: int) -> bool:
        """Нажимает на экран по координатам"""
        print(f"👆 Нажимаю на координаты ({x}, {y})...")
        stdout, stderr = self._run_adb_command(['shell', 'input', 'tap', str(x), str(y)])
        
        # Проверяем результат
        if stderr and stderr.strip():
            print(f"⚠️ Ошибка при нажатии на ({x}, {y}): {stderr}")
            return False
        
        # Дополнительная проверка - пробуем еще раз если не получилось
        if stdout and 'error' in stdout.lower():
            print(f"⚠️ Возможна ошибка, пробую еще раз...")
            time.sleep(0.5)
            stdout2, stderr2 = self._run_adb_command(['shell', 'input', 'tap', str(x), str(y)])
            if stderr2 and stderr2.strip():
                print(f"❌ Повторная попытка тоже не удалась: {stderr2}")
                return False
        
        print(f"✅ Нажатие выполнено на ({x}, {y})")
        return True
    
    def long_tap(self, x: int, y: int, duration: int = 500) -> bool:
        """Выполняет долгое нажатие (удержание) на экране"""
        print(f"👆 Долгое нажатие на координаты ({x}, {y}) в течение {duration}мс...")
        # Долгое нажатие через swipe с одинаковыми координатами
        stdout, stderr = self._run_adb_command([
            'shell', 'input', 'swipe', 
            str(x), str(y), str(x), str(y), str(duration)
        ])
        
        if stderr and stderr.strip():
            print(f"⚠️ Ошибка при долгом нажатии на ({x}, {y}): {stderr}")
            return False
        
        print(f"✅ Долгое нажатие выполнено на ({x}, {y})")
        return True
    
    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration: int = 300) -> bool:
        """Выполняет свайп"""
        stdout, stderr = self._run_adb_command([
            'shell', 'input', 'swipe', 
            str(x1), str(y1), str(x2), str(y2), str(duration)
        ])
        return stderr == ""
    
    def input_text(self, text: str) -> bool:
        """Вводит текст"""
        # Экранируем специальные символы
        text = text.replace(' ', '%s').replace('&', '\\&')
        stdout, stderr = self._run_adb_command(['shell', 'input', 'text', text])
        return stderr == ""
    
    def input_key(self, keycode: str) -> bool:
        """Нажимает клавишу (например, ENTER, BACK)"""
        stdout, stderr = self._run_adb_command(['shell', 'input', 'keyevent', keycode])
        return stderr == ""
    
    def get_ui_dump(self, save_to_file: bool = False) -> str:
        """Получает XML дамп UI через UI Automator
        
        Args:
            save_to_file: Если True, сохраняет дамп в файл для отладки
        """
        # Сохраняем дамп UI в файл на устройстве
        stdout, stderr = self._run_adb_command([
            'shell', 'uiautomator', 'dump', '/sdcard/ui_dump.xml'
        ])
        
        if stderr:
            print(f"⚠️ Ошибка при получении UI dump: {stderr}")
            return ""
        
        # Скачиваем файл на компьютер
        dump_file = 'ui_dump.xml'
        stdout, stderr = self._run_adb_command([
            'pull', '/sdcard/ui_dump.xml', dump_file
        ])
        
        # ADB pull выводит информацию в stderr, но это не ошибка
        # Проверяем реальные ошибки (не "file pulled" сообщения)
        if stderr and 'error' in stderr.lower() and 'file pulled' not in stderr.lower():
            print(f"⚠️ Ошибка при скачивании UI dump: {stderr}")
            return ""
        
        # Проверяем, что файл действительно скачался
        import os
        if not os.path.exists(dump_file):
            print(f"⚠️ Файл {dump_file} не найден после скачивания")
            return ""
        
        # Читаем файл
        try:
            with open(dump_file, 'r', encoding='utf-8') as f:
                content = f.read()
                if save_to_file:
                    print(f"📄 UI dump сохранен в {dump_file}")
                return content
        except Exception as e:
            print(f"⚠️ Ошибка при чтении UI dump: {e}")
            return ""
    
    def find_all_clickable_elements(self) -> List[Dict]:
        """Находит все кликабельные элементы на экране (для отладки)"""
        import xml.etree.ElementTree as ET
        import re
        
        ui_xml = self.get_ui_dump(save_to_file=True)
        if not ui_xml:
            return []
        
        elements = []
        try:
            root = ET.fromstring(ui_xml)
            
            for elem in root.iter():
                clickable = elem.get('clickable', 'false').lower() == 'true'
                if clickable:
                    text = elem.get('text', '')
                    content_desc = elem.get('content-desc', '')
                    resource_id = elem.get('resource-id', '')
                    bounds = elem.get('bounds', '')
                    
                    if bounds:
                        match = re.search(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
                        if match:
                            x1, y1 = int(match.group(1)), int(match.group(2))
                            x2, y2 = int(match.group(3)), int(match.group(4))
                            center_x = (x1 + x2) // 2
                            center_y = (y1 + y2) // 2
                            
                            elements.append({
                                'text': text,
                                'content_desc': content_desc,
                                'resource_id': resource_id,
                                'bounds': bounds,
                                'center': (center_x, center_y)
                            })
            
            return elements
        except Exception as e:
            print(f"⚠️ Ошибка при парсинге UI dump: {e}")
            return []
    
    def find_element_by_text(self, text: str, clickable_only: bool = False) -> tuple:
        """Находит элемент по тексту и возвращает его координаты (center)
        
        Args:
            text: Текст для поиска
            clickable_only: Искать только кликабельные элементы (по умолчанию False - ищем все)
        """
        import xml.etree.ElementTree as ET
        import re
        
        # Получаем UI dump
        ui_xml = self.get_ui_dump()
        if not ui_xml:
            return None
        
        try:
            # Парсим XML
            root = ET.fromstring(ui_xml)
            
            # Ищем элемент с нужным текстом
            # UI Automator использует namespace
            namespace = {'ui': 'http://schemas.android.com/resources/android'}
            
            # Ищем по тексту (case-insensitive)
            for elem in root.iter():
                # Проверяем атрибут text
                elem_text = elem.get('text', '')
                content_desc = elem.get('content-desc', '')
                resource_id = elem.get('resource-id', '')
                clickable = elem.get('clickable', 'false').lower() == 'true'
                
                # Пропускаем не кликабельные элементы, если требуется
                if clickable_only and not clickable:
                    continue
                
                # Ищем текст "Места" или похожий (в тексте, content-desc или resource-id)
                text_lower = text.lower()
                elem_text_lower = (elem_text or '').lower()
                content_desc_lower = (content_desc or '').lower()
                resource_id_lower = (resource_id or '').lower()
                
                found = (
                    text_lower in elem_text_lower or 
                    text_lower in content_desc_lower or
                    text_lower in resource_id_lower
                )
                
                # Также ищем частичные совпадения для русского текста "Места"
                if not found and text_lower in ['места', 'место']:
                    if 'мест' in elem_text_lower or 'мест' in content_desc_lower:
                        found = True
                
                if found:
                    # Получаем bounds элемента
                    bounds = elem.get('bounds', '')
                    if bounds:
                        # Формат: [x1,y1][x2,y2]
                        match = re.search(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
                        if match:
                            x1, y1 = int(match.group(1)), int(match.group(2))
                            x2, y2 = int(match.group(3)), int(match.group(4))
                            # Возвращаем центр элемента
                            center_x = (x1 + x2) // 2
                            center_y = (y1 + y2) // 2
                            print(f"✅ Найден элемент '{text}' с координатами центра: ({center_x}, {center_y})")
                            print(f"   text='{elem_text}', content-desc='{content_desc}', resource-id='{resource_id}', clickable={clickable}")
                            return (center_x, center_y)
            
            print(f"⚠️ Элемент с текстом '{text}' не найден")
            return None
            
        except Exception as e:
            print(f"⚠️ Ошибка при парсинге UI dump: {e}")
            return None
    
    def tap_by_ui_automator(self, text: str) -> bool:
        """Нажимает на элемент через UI Automator (использует координаты из UI dump)"""
        print(f"🔍 Пробую нажать на '{text}' через UI Automator...")
        
        # Находим элемент через UI dump и кликаем по координатам
        coords = self.find_element_by_text(text, clickable_only=True)
        if coords:
            x, y = coords
            print(f"👆 Нажимаю через UI Automator на координаты ({x}, {y})")
            if self.tap(x, y):
                time.sleep(1)
                return True
        
        return False
    
    def tap_by_text(self, text: str) -> bool:
        """Нажимает на элемент по тексту (использует несколько методов)"""
        # Метод 1: Поиск через UI dump и нажатие по координатам
        coords = self.find_element_by_text(text, clickable_only=True)
        if coords:
            x, y = coords
            print(f"👆 Нажимаю на элемент '{text}' по координатам ({x}, {y})")
            if self.tap(x, y):
                time.sleep(2)  # Даем время на реакцию
                return True
        
        # Метод 2: Если не нашли, пробуем через UI Automator
        if self.tap_by_ui_automator(text):
            return True
        
        # Метод 3: Fallback - используем координаты из config
        print(f"⚠️ Не удалось найти элемент с текстом '{text}', использую координаты из config")
        from config import PLACES_BUTTON
        x, y = PLACES_BUTTON
        
        # Пробуем нажать в нескольких точках вокруг кнопки
        offsets = [
            (0, 0),      # Центр
            (-20, -20),  # Влево-вверх
            (20, 20),    # Вправо-вниз
            (-20, 20),   # Влево-вниз
            (20, -20),   # Вправо-вверх
        ]
        
        for offset_x, offset_y in offsets:
            tap_x, tap_y = x + offset_x, y + offset_y
            print(f"Пробую нажать на ({tap_x}, {tap_y})...")
            if self.tap(tap_x, tap_y):
                time.sleep(2)
                return True
        
        return False
    
    def get_screenshot(self, save_path: str = 'screenshot.png') -> bool:
        """Делает скриншот экрана"""
        try:
            # Сначала пробуем стандартный метод
            stdout, stderr = self._run_adb_command(['shell', 'screencap', '-p', '/sdcard/screenshot.png'])
            if stderr and stderr.strip() and 'error' in stderr.lower():
                print(f"⚠️ Ошибка при создании скриншота: {stderr}")
                return False
            
            # Скачиваем файл
            stdout, stderr = self._run_adb_command(['pull', '/sdcard/screenshot.png', save_path])
            
            # ADB pull может выводить информацию в stderr, но это не ошибка
            if stderr and 'error' in stderr.lower() and 'file pulled' not in stderr.lower():
                print(f"⚠️ Ошибка при скачивании скриншота: {stderr}")
                return False
            
            # Проверяем, что файл действительно создан
            import os
            if os.path.exists(save_path) and os.path.getsize(save_path) > 0:
                return True
            else:
                print(f"⚠️ Файл скриншота не создан или пуст: {save_path}")
                return False
        except Exception as e:
            print(f"⚠️ Исключение при создании скриншота: {e}")
            return False
    
    def get_screen_size(self) -> tuple:
        """Получает размер экрана"""
        stdout, _ = self._run_adb_command(['shell', 'wm', 'size'])
        # Формат: Physical size: 1080x2340
        if 'Physical size:' in stdout:
            size_str = stdout.split('Physical size:')[1].strip()
            width, height = map(int, size_str.split('x'))
            return width, height
        return 1080, 2340  # Дефолтное значение
    
    def is_app_running(self) -> bool:
        """Проверяет, запущено ли приложение"""
        stdout, _ = self._run_adb_command([
            'shell', 'pidof', self.package
        ])
        return stdout.strip() != ""
    
    def close_app(self) -> bool:
        """Закрывает приложение TrueGamers"""
        from config import TRUEGAMERS_PACKAGE
        
        print("🔴 Закрываю приложение...")
        
        # Пробуем несколько методов закрытия
        # Метод 1: Force stop через am force-stop
        stdout, stderr = self._run_adb_command([
            'shell', 'am', 'force-stop', TRUEGAMERS_PACKAGE
        ])
        
        if stderr and stderr.strip():
            print(f"⚠️ Ошибка при закрытии приложения: {stderr}")
        else:
            print(f"✅ Приложение {TRUEGAMERS_PACKAGE} закрыто")
        
        # Даем время на закрытие
        time.sleep(2)
        
        # Проверяем, что приложение действительно закрыто
        if not self.is_app_running():
            print("✅ Приложение успешно закрыто")
            return True
        else:
            print("⚠️ Приложение все еще запущено, пробую еще раз...")
            # Пробуем еще раз
            stdout, stderr = self._run_adb_command([
                'shell', 'am', 'force-stop', TRUEGAMERS_PACKAGE
            ])
            time.sleep(2)
            return not self.is_app_running()
    
    def launch_app(self) -> bool:
        """Запускает приложение"""
        # Если активность указана, используем её
        if TRUEGAMERS_ACTIVITY:
            stdout, stderr = self._run_adb_command([
                'shell', 'am', 'start', '-n', 
                f'{self.package}/{TRUEGAMERS_ACTIVITY}'
            ])
        else:
            # Запускаем через intent (Android сам определит главную активность)
            stdout, stderr = self._run_adb_command([
                'shell', 'am', 'start', '-a', 'android.intent.action.MAIN', 
                '-c', 'android.intent.category.LAUNCHER', '-n', f'{self.package}/.MainActivity'
            ])
            # Если не получилось, пробуем через monkey
            if stderr and 'Error' in stderr:
                stdout, stderr = self._run_adb_command([
                    'shell', 'monkey', '-p', self.package, '-c', 'android.intent.category.LAUNCHER', '1'
                ])
        
        time.sleep(2)  # Ждем запуска
        
        # Проверяем, действительно ли приложение запустилось
        # Не полагаемся только на stderr, так как он может быть не пустым даже при успешном запуске
        is_running = self.is_app_running()
        
        if is_running:
            print(f"✅ Приложение {self.package} успешно запущено")
            return True
        else:
            # Если stderr пустой, но приложение не запущено, возможно нужно больше времени
            time.sleep(1)
            is_running = self.is_app_running()
            if is_running:
                print(f"✅ Приложение {self.package} запущено (после дополнительной задержки)")
                return True
            else:
                print(f"⚠️ Не удалось подтвердить запуск приложения. stderr: {stderr[:100] if stderr else 'пусто'}")
                # Если stderr пустой, считаем что запуск успешен (приложение может уже быть запущено)
                return stderr == "" or "Error" not in stderr
    
    def close_app(self) -> bool:
        """Закрывает приложение TrueGamers"""
        print("🔴 Закрываю приложение...")
        
        # Force stop через am force-stop
        stdout, stderr = self._run_adb_command([
            'shell', 'am', 'force-stop', self.package
        ])
        
        if stderr and stderr.strip():
            print(f"⚠️ Ошибка при закрытии приложения: {stderr}")
        else:
            print(f"✅ Приложение {self.package} закрыто")
        
        # Даем время на закрытие
        time.sleep(2)
        
        # Проверяем, что приложение действительно закрыто
        if not self.is_app_running():
            print("✅ Приложение успешно закрыто")
            return True
        else:
            print("⚠️ Приложение все еще запущено, пробую еще раз...")
            # Пробуем еще раз
            stdout, stderr = self._run_adb_command([
                'shell', 'am', 'force-stop', self.package
            ])
            time.sleep(2)
            return not self.is_app_running()
    
    def get_current_activity(self) -> str:
        """Получает текущую активность"""
        # Пробуем несколько способов определения активности
        # Способ 1: через dumpsys window
        stdout, _ = self._run_adb_command([
            'shell', 'dumpsys', 'window', 'windows'
        ])
        
        # Ищем mCurrentFocus в выводе
        for line in stdout.split('\n'):
            if 'mCurrentFocus' in line or 'mFocusedApp' in line:
                # Извлекаем имя активности
                if self.package in line:
                    # Формат обычно: mCurrentFocus=Window{...} com.truegamers.true_gamers/.MainActivity
                    parts = line.split(self.package + '/')
                    if len(parts) > 1:
                        activity = parts[1].split()[0].split('}')[0]
                        return f'{self.package}/{activity}'
        
        # Способ 2: через dumpsys activity
        stdout, _ = self._run_adb_command([
            'shell', 'dumpsys', 'activity', 'activities'
        ])
        
        for line in stdout.split('\n'):
            if 'mResumedActivity' in line and self.package in line:
                # Извлекаем активность
                parts = line.split(self.package + '/')
                if len(parts) > 1:
                    activity = parts[1].split()[0].split('}')[0]
                    return f'{self.package}/{activity}'
        
        return ""
    
    def find_main_activity(self) -> str:
        """Определяет главную активность приложения"""
        # Пробуем запустить приложение и определить активность
        if not self.launch_app():
            return ""
        
        time.sleep(2)  # Ждем запуска
        
        activity = self.get_current_activity()
        return activity
    
    def login(self, phone: str, password: str) -> bool:
        """Выполняет вход в приложение"""
        from config import LOGIN_COORDINATES
        
        # Запускаем приложение
        if not self.launch_app():
            return False
        
        time.sleep(3)  # Ждем загрузки
        
        # Вводим телефон
        self.tap(*LOGIN_COORDINATES['phone_input'])
        time.sleep(0.5)
        self.input_text(phone)
        time.sleep(1)
        
        # Вводим пароль
        self.tap(*LOGIN_COORDINATES['password_input'])
        time.sleep(0.5)
        self.input_text(password)
        time.sleep(1)
        
        # Нажимаем кнопку входа
        self.tap(*LOGIN_COORDINATES['login_button'])
        time.sleep(3)  # Ждем входа
        
        return True
    
    def select_club(self, club_name: Optional[str] = None) -> bool:
        """Выбирает клуб"""
        from config import CLUB_SELECTION
        
        time.sleep(2)
        
        # Нажимаем на список клубов
        self.tap(*CLUB_SELECTION['club_list'])
        time.sleep(2)
        
        # Если указано имя клуба, можно добавить поиск
        # Пока просто выбираем первый
        self.tap(*CLUB_SELECTION['select_club'])
        time.sleep(2)
        
        return True
    
    def input_pin(self, pin: str) -> bool:
        """Вводит PIN-код через цифровую клавиатуру"""
        from config import PIN_KEYPAD
        
        print(f"🔐 Начинаю ввод PIN: {pin}")
        time.sleep(2)  # Ждем появления клавиатуры и загрузки экрана
        
        # Вводим каждую цифру PIN-кода
        for i, digit in enumerate(pin, 1):
            if digit in PIN_KEYPAD:
                x, y = PIN_KEYPAD[digit]
                print(f"  Нажимаю цифру {digit} ({i}/{len(pin)}) на координатах ({x}, {y})")
                success = self.tap(x, y)
                if not success:
                    print(f"  ⚠️ Не удалось нажать на цифру {digit}")
                time.sleep(0.5)  # Увеличиваем задержку между нажатиями
            else:
                print(f"⚠️ Неизвестная цифра в PIN: {digit}")
                return False
        
        time.sleep(1.5)  # Ждем обработки PIN
        print("✅ PIN введен")
        return True
    
    def open_app_and_places(self) -> bool:
        """Открывает приложение, вводит PIN и нажимает кнопку 'Места'"""
        from config import PLACES_BUTTON, PIN_CODE
        
        # Сначала закрываем приложение для получения актуальных данных
        print("🔄 Перезапускаю приложение для получения актуальных данных...")
        self.close_app()
        time.sleep(1)  # Небольшая задержка после закрытия
        
        print("📱 Запускаю приложение...")
        # Запускаем приложение
        if not self.launch_app():
            print("⚠️ Не удалось подтвердить запуск, но продолжаю...")
            # Продолжаем, так как приложение может быть уже запущено
        
        print("⏳ Жду загрузки приложения...")
        time.sleep(5)  # Увеличиваем время ожидания загрузки
        
        # Делаем скриншот для отладки
        self.get_screenshot('before_pin.png')
        print("📸 Скриншот до ввода PIN сохранен: before_pin.png")
        
        # Вводим PIN-код
        print("🔐 Ввожу PIN-код...")
        if not self.input_pin(PIN_CODE):
            print("❌ Ошибка при вводе PIN")
            return False
        
        # Делаем скриншот после ввода PIN
        time.sleep(3)  # Увеличиваем задержку после ввода PIN
        self.get_screenshot('after_pin.png')
        print("📸 Скриншот после ввода PIN сохранен: after_pin.png")
        
        # Нажимаем кнопку "Места" через поиск по тексту
        print("🪑 Ищу кнопку 'Места' через UI Automator...")
        
        # Ждем, чтобы экран стабилизировался после ввода PIN
        print("⏳ Жду стабилизации экрана...")
        time.sleep(5)  # Даем время на загрузку
        
        # Делаем скриншот перед поиском
        self.get_screenshot('before_places_search.png')
        print("📸 Скриншот перед поиском кнопки сохранен")
        
        # Для отладки: находим все кликабельные элементы
        print("🔍 Ищу все кликабельные элементы на экране (для отладки)...")
        clickable_elements = self.find_all_clickable_elements()
        if clickable_elements:
            print(f"📋 Найдено {len(clickable_elements)} кликабельных элементов:")
            for i, elem in enumerate(clickable_elements[:10], 1):  # Показываем первые 10
                print(f"  {i}. text='{elem['text']}', content-desc='{elem['content_desc']}', "
                      f"resource-id='{elem['resource_id']}', center={elem['center']}")
        
        # Пробуем найти кнопку по разным вариантам текста
        places_texts = ['Места', 'места', 'МЕСТА', 'Places', 'places', 'Место', 'место']
        success = False
        
        # Сначала получаем UI dump один раз
        print("📄 Получаю UI dump...")
        ui_xml = self.get_ui_dump(save_to_file=True)
        
        if ui_xml:
            print(f"✅ UI dump получен ({len(ui_xml)} символов)")
            # Сохраняем для отладки
            with open('ui_dump_debug.xml', 'w', encoding='utf-8') as f:
                f.write(ui_xml)
            print("📄 UI dump сохранен в ui_dump_debug.xml для отладки")
        else:
            print("⚠️ Не удалось получить UI dump")
        
        for text in places_texts:
            print(f"🔍 Ищу элемент с текстом '{text}'...")
            # Используем улучшенный метод tap_by_text
            success = self.tap_by_text(text)
            if success:
                time.sleep(3)
                self.get_screenshot('after_places_tap_by_text.png')
                print("📸 Скриншот после нажатия сохранен")
                
                # Проверяем, изменился ли экран - получаем новый UI dump
                new_ui_xml = self.get_ui_dump()
                if new_ui_xml and new_ui_xml != ui_xml:
                    print("✅ Экран изменился после нажатия!")
                else:
                    print("⚠️ Экран не изменился, возможно нажатие не сработало")
                break
            time.sleep(1)
        
        # Если не нашли по тексту, пробуем старый метод с координатами
        if not success:
            print("⚠️ Не удалось найти кнопку по тексту, пробую по координатам...")
            import importlib
            import config
            importlib.reload(config)
            from config import PLACES_BUTTON
            
            x, y = PLACES_BUTTON
            print(f"🪑 Нажимаю кнопку 'Места' на координатах ({x}, {y})")
            
            # Делаем скриншот перед нажатием
            self.get_screenshot('before_places_tap_coords.png')
            
            # Метод 1: Обычное нажатие несколько раз
            for attempt in range(5):
                print(f"Попытка {attempt + 1}/5 на ({x}, {y})...")
                if self.tap(x, y):
                    time.sleep(2)
                    # Проверяем, изменился ли экран (делаем скриншот)
                    self.get_screenshot('after_places_tap_coords.png')
                    success = True
                    break
                time.sleep(0.5)
            
            # Метод 2: Нажатие в нескольких точках вокруг кнопки
            if not success:
                print("🔍 Метод 2: Пробую нажать в нескольких точках вокруг кнопки...")
                offsets = [
                    (0, 0),      # Центр
                    (-30, -30),  # Влево-вверх
                    (30, 30),    # Вправо-вниз
                    (-30, 30),   # Влево-вниз
                    (30, -30),   # Вправо-вверх
                    (-50, 0),    # Влево
                    (50, 0),     # Вправо
                    (0, -50),    # Вверх
                    (0, 50),     # Вниз
                ]
                
                for offset_x, offset_y in offsets:
                    tap_x, tap_y = x + offset_x, y + offset_y
                    print(f"Попытка нажатия на ({tap_x}, {tap_y})...")
                    if self.tap(tap_x, tap_y):
                        time.sleep(2)
                        self.get_screenshot(f'after_tap_offset_{offset_x}_{offset_y}.png')
                        print(f"📸 Скриншот после нажатия на ({tap_x}, {tap_y}) сохранен")
                        success = True
                        break
                    time.sleep(0.5)
            
            # Метод 3: Долгое нажатие
            if not success:
                print("🔍 Метод 3: Пробую долгое нажатие...")
                for attempt in range(3):
                    print(f"Попытка {attempt + 1}/3 долгого нажатия на ({x}, {y})...")
                    if self.long_tap(x, y, duration=800):
                        time.sleep(2)
                        self.get_screenshot(f'after_long_tap_attempt_{attempt + 1}.png')
                        success = True
                        break
                    time.sleep(1)
            
            # Метод 4: Комбинация - свайп к кнопке и нажатие
            if not success:
                print("🔍 Метод 4: Пробую свайп к кнопке и нажатие...")
                # Свайп от центра экрана к кнопке
                screen_size = self.get_screen_size()
                center_x, center_y = screen_size[0] // 2, screen_size[1] // 2
                self.swipe(center_x, center_y, x, y, duration=200)
                time.sleep(1)
                if self.tap(x, y):
                    time.sleep(2)
                    self.get_screenshot('after_swipe_and_tap.png')
                    success = True
        
        # Проверяем, действительно ли экран изменился
        if success:
            print(f"✅ Кнопка 'Места' нажата, проверяю изменение экрана...")
            time.sleep(3)
            
            # Получаем новый UI dump для проверки
            new_ui_xml = self.get_ui_dump()
            if new_ui_xml:
                # Ищем индикаторы того, что мы на экране с местами
                # Ключевые слова: место, seat, занято, свободно, бронирование
                indicators = ['место', 'seat', 'занято', 'свободно', 'бронирование', 'booking']
                found_indicator = False
                for indicator in indicators:
                    if indicator.lower() in new_ui_xml.lower():
                        found_indicator = True
                        print(f"✅ Найден индикатор '{indicator}' - экран с местами открыт!")
                        break
                
                if not found_indicator:
                    print("⚠️ Не найдено индикаторов экрана с местами, возможно нажатие не сработало")
            else:
                print("⚠️ Не удалось получить UI dump для проверки")
        else:
            print(f"❌ Не удалось нажать кнопку 'Места' после всех попыток")
            print(f"💡 Проверьте скриншоты и убедитесь, что координаты правильные")
            print(f"💡 Используйте /debug_clickable для просмотра всех кликабельных элементов")
        
        time.sleep(5)  # Время ожидания открытия экрана с местами
        
        # Делаем финальный скриншот
        self.get_screenshot('places_screen.png')
        print("📸 Скриншот экрана с местами сохранен: places_screen.png")
        
        return True
    
    def open_places(self) -> bool:
        """Открывает экран с местами (если приложение уже открыто)"""
        from config import PLACES_BUTTON
        
        time.sleep(1)
        self.tap(*PLACES_BUTTON)
        time.sleep(2)
        return True
    
    def analyze_place_color(self, screenshot_path: str, center_x: int, center_y: int, place_number: str = '') -> str:
        """Анализирует цвет места на скриншоте для определения статуса
        
        Args:
            screenshot_path: Путь к скриншоту
            center_x, center_y: Координаты центра места
            place_number: Номер места для логирования
            
        Returns:
            'occupied' если серое (занято), 'free' если белое (свободно), 'unknown' если не определено
        """
        try:
            from PIL import Image
            import numpy as np
            
            # Открываем скриншот
            img = Image.open(screenshot_path)
            img_array = np.array(img)
            
            # Получаем цвет пикселя в центре места
            width, height = img.size
            
            # Проверяем границы
            if center_x < 0 or center_x >= width or center_y < 0 or center_y >= height:
                return 'unknown'
            
            # Анализируем ФОН места, избегая текста и рамок
            # Берем несколько точек по краям места (где обычно фон, а не текст)
            # Избегаем центра, где может быть текст с номером
            sample_points = []
            # Анализируем края места (фон), а не центр (где текст)
            offsets = [
                (-12, -12),  # Левый верхний угол (фон)
                (12, -12),   # Правый верхний угол (фон)
                (-12, 12),   # Левый нижний угол (фон)
                (12, 12),    # Правый нижний угол (фон)
                (-15, 0),    # Левая сторона (фон)
                (15, 0),     # Правая сторона (фон)
                (0, -15),   # Верхняя сторона (фон)
                (0, 15),    # Нижняя сторона (фон)
            ]
            
            brightnesses = []
            color_diffs = []
            
            for offset_x, offset_y in offsets:
                x = center_x + offset_x
                y = center_y + offset_y
                
                if x < 0 or x >= width or y < 0 or y >= height:
                    continue
                
                # Берем область побольше для анализа фона (7x7 пикселей)
                x_start = max(0, x - 3)
                x_end = min(width, x + 4)
                y_start = max(0, y - 3)
                y_end = min(height, y + 4)
                
                region = img_array[y_start:y_end, x_start:x_end]
                
                if len(region) == 0 or len(region[0]) == 0:
                    continue
                
                # Вычисляем средний цвет для этой области
                avg_color = np.mean(region, axis=(0, 1))
                
                if len(avg_color) >= 3:
                    r, g, b = avg_color[0], avg_color[1], avg_color[2]
                    brightness = np.mean([r, g, b])
                    color_diff = max(r, g, b) - min(r, g, b)
                    
                    brightnesses.append(brightness)
                    color_diffs.append(color_diff)
            
            if not brightnesses:
                return 'unknown'
            
            # Используем медиану для более устойчивого определения
            median_brightness = np.median(brightnesses)
            median_color_diff = np.median(color_diffs)
            avg_brightness = np.mean(brightnesses)
            avg_color_diff = np.mean(color_diffs)
            
            # Используем комбинацию медианы и среднего для более точного определения
            final_brightness = (median_brightness * 0.6 + avg_brightness * 0.4)
            final_color_diff = (median_color_diff * 0.6 + avg_color_diff * 0.4)
            
            # ТОЧНЫЕ пороги на основе анализа ФОНА места
            # Занятые места: серый фон (темный, низкая насыщенность)
            # Свободные места: белый фон (светлый, низкая насыщенность)
            # Используем строгие пороги для минимизации ошибок
            is_occupied = False
            is_free = False
            
            # Критерии для занятого места (серый фон)
            # Серый фон обычно имеет яркость 100-160 и очень низкую насыщенность
            if final_brightness < 155:
                # Низкая яркость - проверяем насыщенность
                if final_color_diff < 32:  # Серый цвет (низкая разница между RGB)
                    is_occupied = True
                elif final_brightness < 110:
                    # Очень темное - точно занято
                    is_occupied = True
                elif final_brightness < 135 and final_color_diff < 20:
                    # Темное и очень однородное - занято
                    is_occupied = True
            
            # Критерии для свободного места (белый фон)
            # Белый фон обычно имеет яркость > 180 и низкую насыщенность
            if final_brightness > 180:
                # Высокая яркость - свободно
                is_free = True
            elif final_brightness > 165:
                # Средняя-высокая яркость - свободно
                is_free = True
            
            # Пограничная зона (155-180) - используем консервативный подход
            if not is_occupied and not is_free:
                # Консервативный подход - только явно темные и однородные считаем занятыми
                if final_brightness < 150:
                    # Ближе к темному - занято (но только если очень однородное)
                    if final_color_diff < 25:
                        is_occupied = True
                    else:
                        # Цветное темное - свободно
                        is_free = True
                else:
                    # Все что >= 150 - свободно
                    is_free = True
            
            result = 'occupied' if is_occupied else ('free' if is_free else 'unknown')
            
            # Детальное логирование для отладки (для всех мест)
            if place_number and place_number.isdigit():
                status_emoji = '🔴' if result == 'occupied' else '🟢' if result == 'free' else '⚪'
                print(f"  {status_emoji} Место {place_number:>2}: яркость={final_brightness:5.1f} (мед={median_brightness:5.1f}), "
                      f"разница={final_color_diff:4.1f} (мед={median_color_diff:4.1f}) -> {result}")
                # Дополнительная информация для отладки
                if result == 'occupied':
                    print(f"      ⚠️ Определено как занятое: яркость < 155 или (яркость < 150 и разница < 25)")
                elif result == 'free':
                    print(f"      ✅ Определено как свободное: яркость >= 150 или яркость > 165")
            
            return result
            
        except Exception as e:
            print(f"⚠️ Ошибка при анализе цвета места {place_number} на ({center_x}, {center_y}): {e}")
            import traceback
            traceback.print_exc()
            return 'unknown'
    
    def get_places_status(self) -> Dict:
        """Получает статус мест (занято/свободно) через UI Automator и анализ скриншота"""
        import xml.etree.ElementTree as ET
        import re
        
        # Делаем скриншот для анализа цветов
        screenshot_path = 'places_analysis.png'
        if not self.get_screenshot(screenshot_path):
            return {'error': 'Не удалось сделать скриншот'}
        
        # Получаем UI dump
        ui_xml = self.get_ui_dump()
        if not ui_xml:
            return {'error': 'Не удалось получить UI dump', 'screenshot': screenshot_path}
        
        try:
            # Парсим XML
            root = ET.fromstring(ui_xml)
            
            places_info = {
                'timestamp': time.time(),
                'places': [],
                'pc_places': [],
                'tv_places': [],
                'total_pc': 0,
                'total_tv': 0,
                'occupied_pc': 0,
                'free_pc': 0,
                'occupied_tv': 0,
                'free_tv': 0,
                'screenshot': screenshot_path
            }
            
            # Ищем все элементы, которые могут быть местами
            # Сначала ищем элементы с номерами (1-25 для ПК, TV1 для телевизора)
            all_elements = []
            for elem in root.iter():
                text = elem.get('text', '')
                content_desc = elem.get('content-desc', '')
                resource_id = elem.get('resource-id', '')
                bounds = elem.get('bounds', '')
                clickable = elem.get('clickable', 'false').lower() == 'true'
                
                if not bounds:
                    continue
                
                # Извлекаем координаты
                match = re.search(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
                if not match:
                    continue
                
                x1, y1 = int(match.group(1)), int(match.group(2))
                x2, y2 = int(match.group(3)), int(match.group(4))
                center_x = (x1 + x2) // 2
                center_y = (y1 + y2) // 2
                width = x2 - x1
                height = y2 - y1
                
                # Сохраняем все элементы с номерами или подходящим размером
                text_combined = (text + ' ' + content_desc).lower()
                
                # Ищем элементы с номерами от 1 до 25 (ПК места) или TV
                num_match = re.search(r'\d+', text + content_desc)
                is_place = False
                place_type = None
                
                if num_match:
                    num = int(num_match.group())
                    if 1 <= num <= 25:
                        # Проверяем, не TV ли это
                        if 'tv' in text_combined or 'тв' in text_combined:
                            place_type = 'tv'
                            is_place = True
                        else:
                            place_type = 'pc'
                            is_place = True
                    elif num == 1 and ('tv' in text_combined or 'тв' in text_combined):
                        place_type = 'tv'
                        is_place = True
                
                # Если не нашли по номеру, проверяем размер и расположение
                # Места обычно небольшие квадратные элементы в определенной области экрана
                if not is_place:
                    # Места обычно находятся в нижней части экрана (y > 800 для разрешения 1440x2560)
                    # и имеют размер примерно 50-200 пикселей
                    if 50 < width < 300 and 50 < height < 300 and center_y > 800:
                        # Проверяем, не является ли это кнопкой навигации или другим UI элементом
                        # Исключаем большие элементы и элементы в верхней части
                        if center_y < 2000:  # Не слишком низко
                            place_type = 'pc'
                            is_place = True
                
                if is_place and place_type:
                    all_elements.append({
                        'elem': elem,
                        'text': text,
                        'content_desc': content_desc,
                        'resource_id': resource_id,
                        'bounds': bounds,
                        'center': (center_x, center_y),
                        'size': (width, height),
                        'type': place_type,
                        'clickable': clickable
                    })
            
            print(f"🔍 Найдено {len(all_elements)} потенциальных мест для анализа")
            
            if len(all_elements) == 0:
                print("⚠️ Не найдено мест в UI dump. Пробую альтернативный поиск...")
                # Альтернативный поиск - ищем все элементы с номерами
                for elem in root.iter():
                    text = elem.get('text', '')
                    content_desc = elem.get('content-desc', '')
                    bounds = elem.get('bounds', '')
                    
                    if not bounds:
                        continue
                    
                    # Ищем элементы с номерами в content-desc (как в логах: '4', '8', '12', '16', '19', '20', '3')
                    if content_desc and content_desc.strip().isdigit():
                        num = int(content_desc.strip())
                        if 1 <= num <= 25:
                            match = re.search(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
                            if match:
                                x1, y1 = int(match.group(1)), int(match.group(2))
                                x2, y2 = int(match.group(3)), int(match.group(4))
                                center_x = (x1 + x2) // 2
                                center_y = (y1 + y2) // 2
                                width = x2 - x1
                                height = y2 - y1
                                
                                all_elements.append({
                                    'elem': elem,
                                    'text': text,
                                    'content_desc': content_desc,
                                    'resource_id': '',
                                    'bounds': bounds,
                                    'center': (center_x, center_y),
                                    'size': (width, height),
                                    'type': 'pc',
                                    'clickable': elem.get('clickable', 'false').lower() == 'true'
                                })
                                print(f"  ✅ Найдено место по номеру: {content_desc} на ({center_x}, {center_y})")
            
            print(f"📊 Всего найдено {len(all_elements)} мест для анализа")
            
            # Анализируем каждый элемент
            for elem_data in all_elements:
                center_x, center_y = elem_data['center']
                place_type = elem_data['type']
                
                # Получаем номер места для логирования
                place_number = elem_data.get('content_desc', '').strip() or elem_data.get('text', '').strip()
                
                # Анализируем цвет для определения статуса
                status = self.analyze_place_color(screenshot_path, center_x, center_y, place_number)
                
                place_data = {
                    'text': elem_data['text'],
                    'content_desc': elem_data['content_desc'],
                    'type': place_type,
                    'status': status,
                    'bounds': elem_data['bounds'],
                    'center': (center_x, center_y),
                    'size': elem_data['size'],
                    'place_number': place_number  # Сохраняем номер для фильтрации
                }
                
                places_info['places'].append(place_data)
                
                # Учитываем только места с валидными номерами (1-25 для ПК, TV1 для TV)
                # Это исключает места без номеров, которые могут определяться неправильно
                has_valid_number = False
                if place_type == 'pc':
                    if place_number and place_number.isdigit() and 1 <= int(place_number) <= 25:
                        has_valid_number = True
                elif place_type == 'tv':
                    if 'tv' in (elem_data.get('content_desc', '') + ' ' + elem_data.get('text', '')).lower() or place_number == '1':
                        has_valid_number = True
                
                if has_valid_number:
                    if place_type == 'pc':
                        places_info['pc_places'].append(place_data)
                        places_info['total_pc'] += 1
                        if status == 'occupied':
                            places_info['occupied_pc'] += 1
                        elif status == 'free':
                            places_info['free_pc'] += 1
                    elif place_type == 'tv':
                        places_info['tv_places'].append(place_data)
                        places_info['total_tv'] += 1
                        if status == 'occupied':
                            places_info['occupied_tv'] += 1
                        elif status == 'free':
                            places_info['free_tv'] += 1
                else:
                    # Место без номера - пропускаем в подсчете, но логируем
                    print(f"  ⚠️ Пропущено место без номера: type={place_type}, text='{elem_data.get('text', '')}', content_desc='{elem_data.get('content_desc', '')}', status={status}")
            
            print(f"📊 Найдено мест: ПК={places_info['total_pc']} (занято={places_info['occupied_pc']}, свободно={places_info['free_pc']}), "
                  f"TV={places_info['total_tv']} (занято={places_info['occupied_tv']}, свободно={places_info['free_tv']})")
            
            # Выводим список занятых мест для проверки (только с номерами)
            if places_info['occupied_pc'] > 0:
                occupied_places = [p.get('place_number', p.get('content_desc', p.get('text', '?'))) 
                                  for p in places_info['pc_places'] 
                                  if p['status'] == 'occupied' and p.get('place_number', '').isdigit()]
                occupied_places = [p for p in occupied_places if p and p != '?']
                print(f"🔴 Занятые ПК места: {', '.join(sorted(occupied_places, key=lambda x: int(x) if x.isdigit() else 999)) if occupied_places else 'не определены'}")
            
            if places_info['free_pc'] > 0:
                free_places = [p.get('place_number', p.get('content_desc', p.get('text', '?'))) 
                             for p in places_info['pc_places'] 
                             if p['status'] == 'free' and p.get('place_number', '').isdigit()]
                free_places = [p for p in free_places if p and p != '?']
                print(f"🟢 Свободные ПК места (первые 10): {', '.join(sorted(free_places[:10], key=lambda x: int(x) if x.isdigit() else 999)) if free_places else 'не определены'}")
            
            return places_info
            
        except Exception as e:
            print(f"⚠️ Ошибка при парсинге UI dump для мест: {e}")
            import traceback
            traceback.print_exc()
            return {
                'error': str(e),
                'screenshot': screenshot_path,
                'timestamp': time.time()
            }


