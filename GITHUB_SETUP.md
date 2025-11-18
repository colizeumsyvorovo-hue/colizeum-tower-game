# Инструкция по загрузке на GitHub

## Шаг 1: Создайте репозиторий на GitHub

1. Перейдите на https://github.com
2. Нажмите кнопку "+" в правом верхнем углу
3. Выберите "New repository"
4. Заполните:
   - **Repository name:** `colizeum-tower-game` (или любое другое имя)
   - **Description:** `Tower Building Game for Colizeum with Telegram integration`
   - **Visibility:** Public или Private (на ваше усмотрение)
   - **НЕ** создавайте README, .gitignore или LICENSE (они уже есть)
5. Нажмите "Create repository"

## Шаг 2: Подключите локальный репозиторий к GitHub

После создания репозитория GitHub покажет инструкции. Выполните команды:

```bash
# Добавьте remote (замените YOUR_USERNAME и REPO_NAME на ваши значения)
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# Переименуйте ветку в main (если еще не сделано)
git branch -M main

# Загрузите код на GitHub
git push -u origin main
```

## Альтернативный способ (через SSH)

Если у вас настроен SSH ключ:

```bash
git remote add origin git@github.com:YOUR_USERNAME/REPO_NAME.git
git branch -M main
git push -u origin main
```

## После загрузки

После успешной загрузки ваш проект будет доступен по адресу:
`https://github.com/YOUR_USERNAME/REPO_NAME`

## Важно!

⚠️ **Не забудьте:**
- Создать файл `.env` на сервере с вашими реальными токенами
- Не коммитьте `.env` файл (он уже в .gitignore)
- Настройте переменные окружения на хостинге

## Деплой на хостинг

Для деплоя на хостинг (например, Heroku, Railway, или VPS):
1. Установите зависимости: `npm install` и `cd server && npm install`
2. Соберите проект: `npm run build`
3. Настройте переменные окружения в `.env`
4. Запустите сервер: `npm start`

