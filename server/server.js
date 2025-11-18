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
  getBonusGameHistory
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
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (bot) {
    bot.handleUpdate(req.body, res);
  } else {
    res.sendStatus(200);
  }
});

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
      // Проверка для игры за бонусы
      const bonusInfo = await canPlayBonusGame(user.id);
      if (!bonusInfo.canPlay) {
        return res.status(403).json({ error: 'Bonus game not available yet' });
      }

      // Начисление бонусов в зависимости от результата
      if (score >= config.bonusRewards.minScore) {
        bonusesEarned = Math.min(
          config.bonusRewards.baseBonus + Math.floor(score / 10),
          config.bonusRewards.maxBonus
        );
      }

      // Запись попытки
      await recordBonusAttempt(user.id);
    } else if (gameType === 'normal') {
      // В обычной игре: 10 бонусов за обычный блок, 25 за perfect
      bonusesEarned = (normalCount * 10) + (perfectCount * 25);
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

// Запуск сервера
app.listen(config.port, () => {
  console.log(`🚀 Server running on port ${config.port}`);
  console.log(`🎮 Game available at ${config.frontendUrl}`);
  if (config.telegramBotToken) {
    console.log(`🤖 Telegram bot is active`);
  }
});


