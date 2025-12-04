@echo off
chcp 65001 >nul
echo Создание файла .env...
(
echo TELEGRAM_BOT_TOKEN=
echo ADB_PATH=adb
echo DEVICE_ID=
) > .env
echo Файл .env создан успешно!
echo.
echo Теперь откройте файл .env и укажите ваш TELEGRAM_BOT_TOKEN
pause


