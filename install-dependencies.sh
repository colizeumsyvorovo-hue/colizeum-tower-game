#!/bin/bash

# Скрипт для установки всех зависимостей на VDS
# Использование: sudo bash install-dependencies.sh

set -e

echo "🚀 Установка зависимостей для Colizeum Tower Game..."

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Проверка прав root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}❌ Пожалуйста, запустите скрипт с правами root: sudo bash install-dependencies.sh${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Обновление системы...${NC}"
apt update && apt upgrade -y

echo -e "${YELLOW}📦 Установка Git...${NC}"
apt install -y git

echo -e "${YELLOW}📦 Установка Node.js 18...${NC}"
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Проверка версии Node.js
NODE_VERSION=$(node -v)
echo -e "${GREEN}✅ Node.js установлен: ${NODE_VERSION}${NC}"

NPM_VERSION=$(npm -v)
echo -e "${GREEN}✅ npm установлен: ${NPM_VERSION}${NC}"

echo -e "${YELLOW}📦 Установка Nginx...${NC}"
apt install -y nginx

echo -e "${YELLOW}📦 Установка PM2...${NC}"
npm install -g pm2

# Проверка версии PM2
PM2_VERSION=$(pm2 -v)
echo -e "${GREEN}✅ PM2 установлен: ${PM2_VERSION}${NC}"

echo -e "${YELLOW}📦 Установка Certbot (для SSL)...${NC}"
apt install -y certbot python3-certbot-nginx

echo -e "${GREEN}✅ Все зависимости установлены успешно!${NC}"
echo ""
echo -e "${GREEN}📋 Установленные компоненты:${NC}"
echo -e "  • Git: $(git --version)"
echo -e "  • Node.js: ${NODE_VERSION}"
echo -e "  • npm: ${NPM_VERSION}"
echo -e "  • PM2: ${PM2_VERSION}"
echo -e "  • Nginx: $(nginx -v 2>&1)"
echo -e "  • Certbot: $(certbot --version 2>&1 | head -n 1)"
echo ""
echo -e "${GREEN}✅ Теперь вы можете клонировать проект:${NC}"
echo -e "  ${YELLOW}cd /var/www${NC}"
echo -e "  ${YELLOW}git clone https://github.com/colizeumsyvorovo-hue/colizeum-tower-game colizeum-game${NC}"

