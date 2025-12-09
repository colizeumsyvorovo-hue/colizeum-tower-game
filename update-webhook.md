# 🔄 Обновление Webhook URL в Telegram боте

## Что нужно сделать:

### Шаг 1: Обновите .env файл

```bash
cd /var/www/colizeum-game
nano .env
```

Убедитесь, что указан правильный новый URL:

```env
TELEGRAM_WEBHOOK_URL=https://osiptzovs.fvds.ru/webhook
```

**Важно:** Убедитесь, что URL начинается с `https://` и заканчивается на `/webhook`

Сохраните: `Ctrl+O`, `Enter`, `Ctrl+X`

### Шаг 2: Перезапустите приложение

```bash
pm2 restart colizeum-game
```

Или используйте скрипт деплоя:

```bash
./deploy.sh
```

### Шаг 3: Проверьте логи

```bash
pm2 logs colizeum-game --lines 30
```

Ищите строки:
- `🔧 Setting webhook to: https://osiptzovs.fvds.ru/webhook`
- `✅ Telegram bot webhook set successfully`
- `🤖 Webhook URL: https://osiptzovs.fvds.ru/webhook`

## ✅ Готово!

Webhook автоматически обновится при перезапуске. Старый webhook (с Render.com) будет автоматически заменен новым.

## 🔍 Проверка webhook вручную (опционально)

Если хотите проверить текущий webhook:

```bash
# Войдите в Node.js REPL
cd /var/www/colizeum-game/server
node

# Выполните:
const { Telegraf } = require('telegraf');
const bot = new Telegraf('ВАШ_ТОКЕН_БОТА');
bot.telegram.getWebhookInfo().then(console.log);

# Или удалите старый webhook (если нужно):
bot.telegram.deleteWebhook().then(console.log);
```

Но это не обязательно - при установке нового webhook старый автоматически удаляется.


