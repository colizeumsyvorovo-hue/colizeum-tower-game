# Быстрый деплой на VDS

## Быстрая установка (5 минут)

### 1. Подключитесь к VDS по SSH

```bash
ssh root@your-server-ip
```

### 2. Установите необходимые пакеты

```bash
# Обновление системы
apt update && apt upgrade -y

# Git (для клонирования репозитория)
apt install -y git

# Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Nginx
apt install -y nginx

# PM2
npm install -g pm2

# Certbot (для SSL)
apt install -y certbot python3-certbot-nginx
```

### 3. Загрузите проект на сервер

**Вариант A: Через Git**
```bash
cd /var/www
git clone <ваш-репозиторий> colizeum-game
cd colizeum-game
```

**Вариант B: Через SCP (с вашего компьютера)**
```bash
# На вашем компьютере
scp -r /path/to/project root@your-server-ip:/var/www/colizeum-game
```

### 4. Настройте проект

```bash
cd /var/www/colizeum-game

# Установите зависимости
npm install
cd server && npm install && cd ..

# Опционально: исправьте уязвимости (безопасные исправления)
npm audit fix
cd server && npm audit fix && cd ..

# Соберите фронтенд
npm run build

# Создайте .env файл
nano .env
```

Скопируйте в `.env`:
```env
TELEGRAM_BOT_TOKEN=ваш_токен_бота
TELEGRAM_WEBHOOK_URL=https://ваш-домен.com/webhook
JWT_SECRET=сгенерируйте_случайную_строку_32_символа
DATABASE_PATH=./server/database/game.db
PORT=3000
FRONTEND_URL=https://ваш-домен.com
```

### 5. Настройте Nginx

```bash
# Скопируйте конфигурацию
cp nginx.conf /etc/nginx/sites-available/colizeum-game

# Замените yourdomain.com на ваш домен
nano /etc/nginx/sites-available/colizeum-game

# Включите конфигурацию
ln -s /etc/nginx/sites-available/colizeum-game /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 6. Настройте SSL

```bash
certbot --nginx -d ваш-домен.com
```

### 7. Запустите приложение

```bash
# Сделайте скрипт исполняемым
chmod +x deploy.sh

# Запустите деплой
./deploy.sh
```

### 8. Настройте автозапуск PM2

```bash
pm2 startup
# Выполните команду, которую покажет PM2
pm2 save
```

## Готово! 🎉

Ваше приложение доступно по адресу: `https://ваш-домен.com`

## Полезные команды

```bash
# Просмотр логов
pm2 logs colizeum-game

# Перезапуск
pm2 restart colizeum-game

# Статус
pm2 status

# Обновление проекта
cd /var/www/colizeum-game
git pull
./deploy.sh
```

