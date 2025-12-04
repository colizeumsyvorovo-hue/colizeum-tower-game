#!/bin/bash

# Безопасное обновление проекта на VDS
# Сохраняет локальные изменения перед обновлением

echo "📦 Сохранение локальных изменений..."

# Сохраняем локальные изменения в stash
git stash push -m "Local changes before update $(date +%Y-%m-%d_%H-%M-%S)"

# Удаляем untracked файлы, которые конфликтуют (они уже есть в репозитории)
echo "🗑️  Удаление конфликтующих untracked файлов..."
rm -f create-nginx-config-temp.sh
rm -f create-nginx-config.sh
rm -f deploy.sh
rm -f ecosystem.config.js
rm -f fix-vulnerabilities.sh
rm -f update-on-vds.sh

# Если server/notifications.js существует локально, но не отслеживается, удаляем его
if [ -f "server/notifications.js" ] && ! git ls-files --error-unmatch server/notifications.js >/dev/null 2>&1; then
    echo "🗑️  Удаление локальной копии server/notifications.js..."
    rm -f server/notifications.js
fi

echo "⬇️  Обновление проекта из GitHub..."
git pull origin main

if [ $? -eq 0 ]; then
    echo "✅ Проект успешно обновлен!"
    echo ""
    echo "📝 Если у вас были важные локальные изменения, они сохранены в stash."
    echo "   Чтобы посмотреть их: git stash list"
    echo "   Чтобы применить: git stash pop"
else
    echo "❌ Ошибка при обновлении проекта"
    exit 1
fi

