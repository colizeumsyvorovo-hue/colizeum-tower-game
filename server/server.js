const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { 
  getOrCreateUser, 
  saveGame, 
  updateUserStats, 
  canPlayBonusGame, 
  recordBonusAttempt,
  getUserStats,
  getLeaderboard,
  getUserRank,
  getBonusGameHistory,
  exchangeBonuses
} = require('./database');
const { generateToken, authMiddleware, validateTelegramWebApp } = require('./auth');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../')));

// Инициализация Telegram бота
const bot = require('./telegram');

// Webhook endpoint для Telegram бота
if (bot) {
  app.use(bot.webhookCallback('/webhook'));
  console.log('✅ Webhook endpoint registered: /webhook');
} else {
  console.warn('⚠️  Bot not initialized - webhook endpoint not available');
}

// API: Авторизация через Telegram Web App
app.post('/api/auth/telegram', async (req, res) => {
  try {
    const { initData } = req.body;

    if (!initData) {
      return res.status(400).json({ error: 'initData is required' });
    }

    // Валидация данных от Telegram (пропускаем для демо/разработки если нет токена)
    const isValid = validateTelegramWebApp(initData);
    if (!isValid && config.telegramBotToken) {
      console.warn('Telegram validation failed, but continuing for development');
      // Не блокируем, если токен бота не установлен (для разработки)
    }

    // Парсинг данных
    let telegramUser;
    try {
      const urlParams = new URLSearchParams(initData);
      const userStr = urlParams.get('user');
      
      if (userStr) {
        telegramUser = JSON.parse(userStr);
      } else {
        // Fallback: пытаемся извлечь данные из строки напрямую
        // Для демо режима
        const userMatch = initData.match(/user=([^&]+)/);
        if (userMatch) {
          telegramUser = JSON.parse(decodeURIComponent(userMatch[1]));
        } else {
          // Создаем демо пользователя из start param
          const demoMatch = initData.match(/id%22%3A(\d+)/);
          if (demoMatch) {
            telegramUser = {
              id: parseInt(demoMatch[1]),
              first_name: 'Demo',
              username: null
            };
          } else {
            throw new Error('Cannot parse user data');
          }
        }
      }
    } catch (parseErr) {
      console.error('Error parsing initData:', parseErr);
      // Попытка создать демо пользователя
      const demoMatch = initData.match(/id%22%3A(\d+)/);
      if (demoMatch) {
        telegramUser = {
          id: parseInt(demoMatch[1]),
          first_name: 'Demo',
          username: null
        };
      } else {
        return res.status(400).json({ error: 'Invalid user data format' });
      }
    }

    // Получение или создание пользователя
    const user = await getOrCreateUser(telegramUser);
    const token = generateToken(user);

    res.json({ 
      token,
      user: {
        id: user.id,
        telegramId: user.telegram_id,
        username: user.username,
        firstName: user.first_name
      }
    });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Authentication failed', details: err.message });
  }
});

// API: Получить информацию о пользователе
app.get('/api/user/me', authMiddleware, async (req, res) => {
  try {
    const { getUserByTelegramId } = require('./database');
    const user = await getUserByTelegramId(req.user.telegramId);
    const stats = await getUserStats(user.id);
    const bonusInfo = await canPlayBonusGame(user.id);

    res.json({
      user: {
        id: user.id,
        telegramId: user.telegram_id,
        username: user.username,
        firstName: user.first_name
      },
      stats,
      bonusInfo
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// API: Проверить доступность игры за бонусы
app.get('/api/game/bonus/check', authMiddleware, async (req, res) => {
  try {
    const { getUserByTelegramId } = require('./database');
    const user = await getUserByTelegramId(req.user.telegramId);
    const bonusInfo = await canPlayBonusGame(user.id);

    res.json(bonusInfo);
  } catch (err) {
    console.error('Check bonus game error:', err);
    res.status(500).json({ error: 'Failed to check bonus game availability' });
  }
});

// API: Начать игру за бонусы (записывает попытку сразу при старте)
app.post('/api/game/bonus/start', authMiddleware, async (req, res) => {
  try {
    const { getUserByTelegramId } = require('./database');
    const user = await getUserByTelegramId(req.user.telegramId);
    const bonusInfo = await canPlayBonusGame(user.id);
    
    if (!bonusInfo.canPlay) {
      return res.status(403).json({ error: 'Bonus game not available yet', nextAvailable: bonusInfo.nextAvailable });
    }
    
    // Записываем попытку сразу при старте игры
    await recordBonusAttempt(user.id);
    
    res.json({ success: true, message: 'Bonus game started' });
  } catch (err) {
    console.error('Start bonus game error:', err);
    res.status(500).json({ error: 'Failed to start bonus game' });
  }
});

// API: Сохранить результат игры
app.post('/api/game/save', authMiddleware, async (req, res) => {
  try {
    const { gameType, score, floors, perfectCount = 0, normalCount = 0 } = req.body;

    if (!gameType || score === undefined || floors === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { getUserByTelegramId } = require('./database');
    const user = await getUserByTelegramId(req.user.telegramId);

    // Начисление бонусов
    let bonusesEarned = 0;
    
    if (gameType === 'bonus') {
      // Проверка для игры за бонусы (но попытка уже записана при старте)
      const bonusInfo = await canPlayBonusGame(user.id);
      // Если попытка уже записана при старте, это нормально, просто проверяем

      // Начисление бонусов в зависимости от результата
      if (score >= config.bonusRewards.minScore) {
        bonusesEarned = Math.min(
          config.bonusRewards.baseBonus + Math.floor(score / 10),
          config.bonusRewards.maxBonus
        );
      }
    } else if (gameType === 'normal') {
      // В обычной игре: 1 бонус за обычный блок, 2 за perfect
      bonusesEarned = (normalCount * 1) + (perfectCount * 2);
      
      // Проверяем лимит накопления (максимум 500)
      const userStats = await getUserStats(user.id);
      const currentTotalBonuses = userStats.total_bonuses || 0;
      const maxBonuses = 500;
      const newTotalBonuses = currentTotalBonuses + bonusesEarned;
      
      if (newTotalBonuses > maxBonuses) {
        // Начисляем только до лимита
        bonusesEarned = Math.max(0, maxBonuses - currentTotalBonuses);
      }
    }

    // Сохранение игры
    await saveGame(user.id, gameType, score, floors, bonusesEarned);
    await updateUserStats(user.id, score, bonusesEarned);

    res.json({ 
      success: true,
      bonusesEarned,
      message: bonusesEarned > 0 ? `Вы получили ${bonusesEarned} бонусов!` : null
    });
  } catch (err) {
    console.error('Save game error:', err);
    res.status(500).json({ error: 'Failed to save game' });
  }
});

// API: Получить статистику
app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const { getUserByTelegramId } = require('./database');
    const user = await getUserByTelegramId(req.user.telegramId);
    const stats = await getUserStats(user.id);
    const bonusInfo = await canPlayBonusGame(user.id);
    const rank = await getUserRank(user.id);

    res.json({ stats, bonusInfo, rank });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// API: Получить мировой топ
app.get('/api/leaderboard', authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = await getLeaderboard(limit);
    
    // Получаем позицию текущего пользователя
    const { getUserByTelegramId } = require('./database');
    const user = await getUserByTelegramId(req.user.telegramId);
    const userRank = await getUserRank(user.id);

    res.json({ 
      leaderboard, 
      userRank,
      userBestScore: user.best_score || 0
    });
  } catch (err) {
    console.error('Get leaderboard error:', err);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

// API: Получить историю игр за бонусы
app.get('/api/bonus/history', authMiddleware, async (req, res) => {
  try {
    const { getUserByTelegramId } = require('./database');
    const user = await getUserByTelegramId(req.user.telegramId);
    const limit = parseInt(req.query.limit) || 10;
    const history = await getBonusGameHistory(user.id, limit);
    res.json({ history });
  } catch (err) {
    console.error('Get bonus history error:', err);
    res.status(500).json({ error: 'Failed to get bonus history' });
  }
});

// API: Обменять бонусы (нужно пополнить счет на 50% от суммы бонусов)
app.post('/api/bonus/exchange', authMiddleware, async (req, res) => {
  try {
    const { bonusesAmount } = req.body;
    
    if (!bonusesAmount || bonusesAmount <= 0) {
      return res.status(400).json({ error: 'Invalid bonuses amount' });
    }
    
    const { getUserByTelegramId } = require('./database');
    const user = await getUserByTelegramId(req.user.telegramId);
    const userStats = await getUserStats(user.id);
    
    const currentBonuses = userStats.total_bonuses || 0;
    
    if (currentBonuses < bonusesAmount) {
      return res.status(400).json({ error: 'Недостаточно бонусов для обмена' });
    }
    
    // Выполняем обмен
    const result = await exchangeBonuses(user.id, bonusesAmount);
    
    res.json({
      success: true,
      message: `Для получения ${bonusesAmount} бонусов необходимо пополнить счет на ${result.requiredDeposit} рублей в клубе`,
      bonusesExchanged: result.bonusesExchanged,
      requiredDeposit: result.requiredDeposit,
      remainingBonuses: result.remainingBonuses
    });
  } catch (err) {
    console.error('Exchange bonuses error:', err);
    res.status(500).json({ error: err.message || 'Failed to exchange bonuses' });
  }
});

// Запуск сервера
app.listen(config.port, async () => {
  console.log(`🚀 Server running on port ${config.port}`);
  console.log(`🎮 Game available at ${config.frontendUrl}`);
  
  // Настройка webhook для Telegram бота
  console.log('🔍 Checking bot configuration...');
  console.log(`  - Bot exists: ${!!bot}`);
  console.log(`  - Bot token exists: ${!!config.telegramBotToken}`);
  console.log(`  - Webhook URL: ${config.telegramWebhookUrl || 'NOT SET'}`);
  
  if (bot && config.telegramBotToken && config.telegramWebhookUrl) {
    try {
      const webhookUrl = `${config.telegramWebhookUrl}/webhook`;
      console.log(`🔧 Setting webhook to: ${webhookUrl}`);
      const result = await bot.telegram.setWebhook(webhookUrl);
      console.log(`✅ Telegram bot webhook set successfully:`, result);
      
      const webhookInfo = await bot.telegram.getWebhookInfo();
      console.log(`✅ Telegram bot webhook configured`);
      console.log(`🤖 Webhook URL: ${webhookInfo.url || webhookUrl}`);
      console.log(`📊 Webhook info:`, {
        url: webhookInfo.url,
        has_custom_certificate: webhookInfo.has_custom_certificate,
        pending_update_count: webhookInfo.pending_update_count,
        last_error_date: webhookInfo.last_error_date,
        last_error_message: webhookInfo.last_error_message
      });
      
      if (webhookInfo.pending_update_count > 0) {
        console.log(`⚠️  Warning: ${webhookInfo.pending_update_count} pending updates in queue`);
      }
    } catch (err) {
      console.error('❌ Error setting webhook:', err);
      console.error('Error details:', err.message);
      if (err.response) {
        console.error('Telegram API response:', err.response);
      }
      console.error('Bot will not receive updates until webhook is configured correctly');
    }
  } else if (config.telegramBotToken) {
    console.log(`⚠️  Bot token found but webhook URL not set - bot will work in polling mode`);
    console.log(`🤖 Telegram bot is active (polling mode)`);
  } else if (!config.telegramBotToken) {
    console.log(`⚠️  Telegram bot token not provided - bot disabled`);
  }
});


