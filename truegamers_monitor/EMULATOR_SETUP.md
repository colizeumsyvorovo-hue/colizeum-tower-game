# Настройка эмулятора для мониторинга TrueGamers

## Рекомендуемые эмуляторы

### 1. Android Studio AVD (Лучший вариант)

**Преимущества:**
- Официальный эмулятор от Google
- Полная поддержка ADB
- Стабильная работа
- Можно настроить любое разрешение

**Установка:**
1. Скачайте [Android Studio](https://developer.android.com/studio)
2. Установите Android SDK через SDK Manager
3. Создайте AVD:
   - Tools → Device Manager → Create Device
   - Выберите устройство (например, Pixel 5)
   - Выберите образ системы (Android 8.0+)
   - Настройте разрешение: 1080x1920 (рекомендуется)
4. Запустите эмулятор

**Проверка:**
```bash
adb devices
# Должно показать: emulator-5554    device
```

### 2. BlueStacks 5

**Преимущества:**
- Удобный интерфейс
- Хорошая производительность
- Поддержка ADB

**Настройка:**
1. Установите BlueStacks 5
2. Откройте Настройки → Расширенные
3. Включите "ADB отладка"
4. Запомните порт (обычно 5555)
5. Подключитесь:
```bash
adb connect 127.0.0.1:5555
adb devices
```

### 3. Nox Player

**Настройка:**
1. Установите Nox Player
2. Настройки → О программе → Нажмите 7 раз на "Номер сборки"
3. Настройки → Для разработчиков → Включите "USB отладка"
4. Подключитесь:
```bash
adb connect 127.0.0.1:62001
adb devices
```

## Установка приложения TrueGamers

### Способ 1: Через Google Play (если доступен в эмуляторе)
1. Откройте Google Play в эмуляторе
2. Найдите "TrueGamers"
3. Установите приложение

### Способ 2: Через APK файл
1. Скачайте APK файл TrueGamers на компьютер
2. Установите через ADB:
```bash
adb install path/to/truegamers.apk
```

### Способ 3: Перетаскивание (BlueStacks/Nox)
1. Просто перетащите APK файл в окно эмулятора
2. Установка произойдет автоматически

## Определение имени пакета приложения

После установки приложения нужно узнать его имя пакета:

```bash
# Список всех установленных приложений
adb shell pm list packages | grep -i true

# Или поиск по ключевому слову
adb shell pm list packages | grep -i game
```

Обычно имя пакета будет что-то вроде:
- `com.truegamers.app`
- `ru.truegamers.app`
- `com.truegamers.client`

Обновите `TRUEGAMERS_PACKAGE` в `config.py` с правильным именем пакета.

## Определение главной активности

```bash
# Запустите приложение вручную в эмуляторе
# Затем выполните:
adb shell dumpsys window windows | grep -E 'mCurrentFocus'

# Или:
adb shell dumpsys activity activities | grep mResumedActivity
```

Обновите `TRUEGAMERS_ACTIVITY` в `config.py`.

## Настройка разрешения экрана

Рекомендуемые разрешения:
- **1080x1920** (Full HD) - оптимально
- **720x1280** (HD) - для слабых ПК
- **1440x2560** (2K) - для детального мониторинга

Для Android Studio AVD:
- При создании AVD выберите нужное разрешение
- Или измените в настройках AVD после создания

## Проверка работы

1. Запустите эмулятор
2. Установите TrueGamers
3. Проверьте подключение:
```bash
cd truegamers_monitor
python bot.py
```
4. В Telegram отправьте `/check_device`
5. Должно показать информацию об эмуляторе

## Полезные команды ADB для эмулятора

```bash
# Список устройств
adb devices

# Размер экрана
adb shell wm size

# Скриншот
adb shell screencap -p /sdcard/screenshot.png
adb pull /sdcard/screenshot.png

# Запуск приложения
adb shell am start -n com.truegamers.app/.MainActivity

# Остановка приложения
adb shell am force-stop com.truegamers.app

# Логи приложения
adb logcat | grep truegamers
```

## Решение проблем

### Эмулятор не виден в adb devices
- Убедитесь, что эмулятор полностью загрузился
- Перезапустите ADB: `adb kill-server && adb start-server`
- Для BlueStacks/Nox: проверьте, что ADB отладка включена

### Приложение не устанавливается
- Проверьте, что APK файл не поврежден
- Убедитесь, что в эмуляторе включена установка из неизвестных источников
- Попробуйте установить через Google Play

### Координаты не работают
- Проверьте разрешение экрана: `adb shell wm size`
- Убедитесь, что координаты соответствуют разрешению
- Используйте скриншоты для точного определения координат


