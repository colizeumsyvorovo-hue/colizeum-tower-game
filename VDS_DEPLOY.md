# Деплой на VDS (Virtual Dedicated Server)

## Требования

- Ubuntu 20.04+ или Debian 11+
- Node.js 18+ и npm
- Nginx
- PM2 (для управления процессами)
- SSL сертификат (Let's Encrypt)

## Шаг 1: Подготовка сервера

### 1.1 Обновление системы

```bash
sudo apt update && sudo apt upgrade -y
```

### 1.2 Установка Git

```bash
sudo apt install -y git
```

### 1.3 Установка Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

### 1.4 Установка Nginx

```bash
sudo apt install -y nginx
```

### 1.5 Установка PM2

```bash
sudo npm install -g pm2
```

### 1.6 Установка Certbot (для SSL)

```bash
sudo apt install -y certbot python3-certbot-nginx
```

## Шаг 2: Клонирование проекта

```bash
cd /var/www
sudo git clone <ваш-git-репозиторий> colizeum-game
cd colizeum-game
```

Или загрузите проект через SCP/SFTP в `/var/www/colizeum-game`

## Шаг 3: Установка зависимостей

```bash
# Установка зависимостей для фронтенда
npm install

# Установка зависимостей для бэкенда
cd server
npm install
cd ..
```

## Шаг 4: Сборка фронтенда

```bash
npm run build
```

## Шаг 5: Настройка переменных окружения

```bash
# Создайте .env файл в корне проекта
nano .env
```

Скопируйте содержимое из `.env.example` и заполните:

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_WEBHOOK_URL=https://yourdomain.com/webhook

# JWT Secret (сгенерируйте случайную строку)
JWT_SECRET=your_very_long_random_secret_key_here

# Database
DATABASE_PATH=./server/database/game.db

# Server
PORT=3000
FRONTEND_URL=https://yourdomain.com
```

## Шаг 6: Настройка Nginx

Создайте конфигурационный файл:

```bash
sudo nano /etc/nginx/sites-available/colizeum-game
```

Скопируйте содержимое из `nginx.conf` (будет создан ниже).

Включите конфигурацию:

```bash
sudo ln -s /etc/nginx/sites-available/colizeum-game /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Шаг 7: Настройка SSL (Let's Encrypt)

```bash
sudo certbot --nginx -d yourdomain.com
```

Следуйте инструкциям. Certbot автоматически обновит конфигурацию Nginx.

## Шаг 8: Настройка PM2

```bash
# Запустите приложение через PM2
pm2 start ecosystem.config.js

# Сохраните конфигурацию PM2
pm2 save

# Настройте автозапуск PM2 при перезагрузке
pm2 startup
```

## Шаг 9: Настройка прав доступа

```bash
# Установите правильные права для директории проекта
sudo chown -R $USER:$USER /var/www/colizeum-game
sudo chmod -R 755 /var/www/colizeum-game

# Права для базы данных
sudo chmod 644 /var/www/colizeum-game/server/database/game.db
```

## Шаг 10: Проверка работы

1. Проверьте статус PM2: `pm2 status`
2. Проверьте логи: `pm2 logs`
3. Проверьте Nginx: `sudo systemctl status nginx`
4. Откройте в браузере: `https://yourdomain.com`

## Обновление проекта

```bash
cd /var/www/colizeum-game
git pull origin main
npm install
cd server && npm install && cd ..
npm run build
pm2 restart colizeum-game
```

## Мониторинг

- PM2 мониторинг: `pm2 monit`
- Логи PM2: `pm2 logs colizeum-game`
- Логи Nginx: `sudo tail -f /var/log/nginx/error.log`

## Резервное копирование базы данных

```bash
# Создайте скрипт для бэкапа
nano /var/www/colizeum-game/backup-db.sh
```

Добавьте:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/colizeum-game"
mkdir -p $BACKUP_DIR
cp /var/www/colizeum-game/server/database/game.db $BACKUP_DIR/game_$(date +%Y%m%d_%H%M%S).db
# Удаляем старые бэкапы (старше 7 дней)
find $BACKUP_DIR -name "game_*.db" -mtime +7 -delete
```

Сделайте исполняемым:

```bash
chmod +x /var/www/colizeum-game/backup-db.sh
```

Добавьте в crontab (ежедневный бэкап в 3:00):

```bash
crontab -e
# Добавьте строку:
0 3 * * * /var/www/colizeum-game/backup-db.sh
```

