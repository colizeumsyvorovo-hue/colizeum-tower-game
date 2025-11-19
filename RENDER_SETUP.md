# ✅ Проверка настроек Render.com

## 📸 Первое фото (Build & Start Commands)

**✅ ВСЁ ПРАВИЛЬНО!**

- **Build Command:** `npm install --include=dev && cd server && npm install && cd .. && NODE_OPTIONS=--openssl-legacy-provider npm run build` ✅
- **Start Command:** `cd server && node server.js` ✅

Эти команды:
1. Устанавливают зависимости для корня проекта
2. Устанавливают зависимости для сервера
3. Собирают frontend (webpack)
4. Запускают сервер из папки `server`

## 📸 Второе фото (Environment Variables)

**Вот какие переменные нужно добавить:**

Нажмите **"+ Add Environment Variable"** и добавьте каждую переменную отдельно:

### 1. NODE_ENV
- **NAME:** `NODE_ENV`
- **Value:** `production`

### 2. PORT
- **NAME:** `PORT`
- **Value:** `3000`

### 3. DATABASE_PATH
- **NAME:** `DATABASE_PATH`
- **Value:** `./server/database/game.db`

### 4. TELEGRAM_BOT_TOKEN
- **NAME:** `TELEGRAM_BOT_TOKEN`
- **Value:** `ваш_токен_от_BotFather`
  - Получить: @BotFather в Telegram → `/mybots` → выберите бота → API Token

### 5. JWT_SECRET
- **NAME:** `JWT_SECRET`
- **Value:** `любая_случайная_строка_для_безопасности`
  - Пример: `my-super-secret-jwt-key-2024-colizeum`
  - Или сгенерируйте на: https://randomkeygen.com

### 6. FRONTEND_URL
- **NAME:** `FRONTEND_URL`
- **Value:** `https://colizeum-tower-game.onrender.com`
  - ✅ **ВАШ URL:** `https://colizeum-tower-game.onrender.com`

### 7. TELEGRAM_WEBHOOK_URL (ВАЖНО для работы бота!)
- **NAME:** `TELEGRAM_WEBHOOK_URL`
- **Value:** `https://colizeum-tower-game.onrender.com`
  - ✅ **ВАШ URL:** `https://colizeum-tower-game.onrender.com`
  - ⚠️ **ОБЯЗАТЕЛЬНО!** Без этой переменной бот не будет работать на Render.com

## 📋 Пошаговая инструкция добавления переменных:

1. На втором фото найдите секцию **"Environment Variables"**
2. Нажмите кнопку **"+ Add Environment Variable"**
3. В поле **"NAME_OF_VARIABLE"** введите имя переменной (например, `TELEGRAM_BOT_TOKEN`)
4. В поле **"value"** введите значение (например, ваш токен бота)
5. Нажмите **"+ Add Environment Variable"** снова для следующей переменной
6. Повторите для всех 6 переменных

## ⚠️ Важно:

- **Не добавляйте** символ `$` перед именами переменных в Render
- Значения должны быть **без кавычек**
- После добавления всех переменных нажмите **"Create Web Service"** или **"Save Changes"**

## 🔍 После деплоя:

После успешного деплоя вы получите URL вида:
`https://your-app-name.onrender.com`

**Обновите переменную `FRONTEND_URL`** на этот реальный URL!

## ✅ Итоговый список переменных:

```
NODE_ENV = production
PORT = 3000
DATABASE_PATH = ./server/database/game.db
TELEGRAM_BOT_TOKEN = ваш_токен
TELEGRAM_WEBHOOK_URL = https://colizeum-tower-game.onrender.com
JWT_SECRET = ваш_секретный_ключ
FRONTEND_URL = https://colizeum-tower-game.onrender.com
```

## 🔧 Исправление проблемы с ботом:

Если бот перестал работать, проверьте:

1. **Переменная `TELEGRAM_WEBHOOK_URL` установлена?**
   - Должна быть равна вашему URL на Render.com
   - Например: `https://colizeum-tower-game.onrender.com`

2. **Переменная `TELEGRAM_BOT_TOKEN` установлена?**
   - Должен быть действительный токен от @BotFather

3. **После добавления переменных:**
   - Перезапустите сервис на Render.com (Manual Deploy → Deploy latest commit)
   - Проверьте логи - должно быть сообщение "✅ Telegram bot webhook configured"

4. **Проверка webhook:**
   - Откройте логи сервера на Render.com
   - Должно быть: `✅ Telegram bot webhook configured`
   - Должно быть: `🤖 Webhook URL: https://your-url.onrender.com/webhook`

