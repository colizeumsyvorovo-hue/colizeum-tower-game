# 🔧 Исправление Webhook URL

## Проблема:
В логах видно двойной `/webhook`: `https://osiptzovs.fvds.ru/webhook/webhook`

## Причина:
В `.env` файле указан `TELEGRAM_WEBHOOK_URL=https://osiptzovs.fvds.ru/webhook`, а код автоматически добавляет еще `/webhook`.

## Решение:

### Исправьте .env файл:

```bash
cd /var/www/colizeum-game
nano .env
```

Измените строку:
```env
TELEGRAM_WEBHOOK_URL=https://osiptzovs.fvds.ru/webhook
```

На:
```env
TELEGRAM_WEBHOOK_URL=https://osiptzovs.fvds.ru
```

**Важно:** Уберите `/webhook` из конца URL! Код автоматически добавит его.

Сохраните: `Ctrl+O`, `Enter`, `Ctrl+X`

### Перезапустите приложение:

```bash
pm2 restart colizeum-game
```

### Проверьте логи:

```bash
pm2 logs colizeum-game --lines 20
```

Теперь должно быть:
- `🔧 Setting webhook to: https://osiptzovs.fvds.ru/webhook` ✅
- `🤖 Webhook URL: https://osiptzovs.fvds.ru/webhook` ✅

(Без двойного `/webhook/webhook`)

