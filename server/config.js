const path = require('path');
// Загружаем .env из корня проекта
require('dotenv').config({ path: path.join(__dirname, '../.env') });

module.exports = {
  port: process.env.PORT || 3000,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'colizeum-secret-key-change-in-production',
  databasePath: process.env.DATABASE_PATH || './database/game.db',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  bonusGameCooldown: 24 * 60 * 60 * 1000, // 24 часа в миллисекундах (86400000)
  bonusRewards: {
    minScore: 100,
    baseBonus: 10,
    maxBonus: 500
  }
};

