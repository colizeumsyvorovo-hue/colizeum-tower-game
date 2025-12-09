#!/bin/bash

# Скрипт для создания конфигурации Nginx на сервере
# Использование: sudo bash create-nginx-config.sh

set -e

echo "📝 Создание конфигурации Nginx..."

# Запрашиваем домен
read -p "Введите ваш домен (например, game.colizeum.ru): " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo "❌ Домен не указан!"
    exit 1
fi

# Создаем конфигурацию
cat > /etc/nginx/sites-available/colizeum-game << EOF
# Nginx конфигурация для Colizeum Tower Game

# Редирект с HTTP на HTTPS
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    
    # Редирект на HTTPS
    return 301 https://\$server_name\$request_uri;
}

# HTTPS конфигурация
server {
    listen 443 ssl http2;
    server_name ${DOMAIN} www.${DOMAIN};

    # SSL сертификаты (будут настроены Certbot)
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    
    # SSL настройки
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Логи
    access_log /var/log/nginx/colizeum-game-access.log;
    error_log /var/log/nginx/colizeum-game-error.log;

    # Максимальный размер загружаемых файлов
    client_max_body_size 10M;

    # Корневая директория
    root /var/www/colizeum-game;
    index index.html;

    # Gzip сжатие
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # Кеширование статических файлов
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot|mp3|ogg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # Webhook для Telegram бота
    location /webhook {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # API endpoints
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Таймауты для длительных запросов
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Статические файлы (HTML, CSS, JS, изображения)
    location / {
        try_files \$uri \$uri/ /index.html;
        
        # Заголовки безопасности
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
    }

    # Блокировка доступа к скрытым файлам
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }

    # Блокировка доступа к node_modules и другим служебным директориям
    location ~ ^/(node_modules|server|src|\.git|\.env) {
        deny all;
        access_log off;
        log_not_found off;
    }
}
EOF

echo "✅ Конфигурация создана для домена: ${DOMAIN}"
echo "📝 Файл: /etc/nginx/sites-available/colizeum-game"


