#!/bin/bash

# Скрипт для создания ecosystem.config.js на сервере
# Использование: bash create-ecosystem.sh

set -e

echo "📝 Создание ecosystem.config.js..."

# Получаем текущую директорию
CURRENT_DIR=$(pwd)

cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'colizeum-game',
    script: './server/server.js',
    cwd: '${CURRENT_DIR}',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '500M',
    watch: false,
    ignore_watch: ['node_modules', 'logs', 'database', 'dist', '.git']
  }]
};
EOF

echo "✅ Файл ecosystem.config.js создан в ${CURRENT_DIR}"

