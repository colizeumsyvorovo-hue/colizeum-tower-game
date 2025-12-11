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
  exchangeBonuses,
  getDailyStats,
  getDailyStatsSummary,
  updateDailyGamesCount,
  createAdvertisement,
  getAdvertisements,
  getAdvertisement,
  updateAdvertisementStatus,
  logAdvertisementSend,
  getTargetUsersForAdvertisement
} = require('./database');
const { generateToken, authMiddleware, validateTelegramWebApp } = require('./auth');

// Обработка необработанных промисов и исключений
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('Stack:', reason?.stack);
  // Не завершаем процесс, а только логируем
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  // Даем время на логирование, затем завершаем процесс
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../')));

// Инициализация Telegram бота
const bot = require('./telegram');

// Webhook endpoint для Telegram бота
if (bot) {
  // Используем стандартный метод Telegraf для обработки webhook
  // webhookCallback возвращает middleware для Express
  const webhookMiddleware = bot.webhookCallback('/webhook');
  
  // Добавляем логирование и обработку ошибок перед обработкой
  app.post('/webhook', async (req, res, next) => {
    try {
      const updateId = req.body?.update_id;
      const hasMessage = !!req.body?.message;
      const hasCallbackQuery = !!req.body?.callback_query;
      
      console.log('📥 Webhook update received:', {
        update_id: updateId,
        has_message: hasMessage,
        has_callback_query: hasCallbackQuery,
        message_text: req.body?.message?.text,
        message_from: req.body?.message?.from?.id,
        callback_data: req.body?.callback_query?.data
      });
      
      // Обрабатываем через Telegraf middleware (он сам отправит ответ)
      await webhookMiddleware(req, res, next);
    } catch (err) {
      console.error('❌ Error in webhook handler:', err);
      console.error('Error message:', err.message);
      console.error('Error stack:', err.stack);
      // Всегда отвечаем 200, чтобы Telegram не повторял запрос
      if (!res.headersSent) {
        res.status(200).json({ ok: false, error: 'Internal error' });
      }
    }
  });
  
  console.log('✅ Webhook endpoint registered: POST /webhook');
  
  // Добавляем обработчик для проверки webhook (GET запрос)
  app.get('/webhook', (req, res) => {
    res.status(200).json({ 
      status: 'ok', 
      message: 'Webhook endpoint is active',
      bot_configured: !!bot,
      timestamp: new Date().toISOString()
    });
  });
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
      // В production лучше логировать, но не блокировать для совместимости
      // console.warn('Telegram validation failed, but continuing for development');
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
    if (!req.user || !req.user.telegramId) {
      return res.status(401).json({ error: 'Invalid user data' });
    }
    
    const { getUserByTelegramId, getOrCreateUser } = require('./database');
    let user = await getUserByTelegramId(req.user.telegramId);
    
    // Если пользователь не найден, создаем его
    if (!user) {
      // Преобразуем req.user в формат, который ожидает getOrCreateUser
      const telegramUser = {
        id: req.user.telegramId,
        username: req.user.username || null,
        first_name: req.user.firstName || null,
        last_name: null
      };
      try {
        user = await getOrCreateUser(telegramUser);
      } catch (createErr) {
        console.error('Error creating user in /api/user/me:', createErr);
        // Пытаемся получить пользователя еще раз
        user = await getUserByTelegramId(req.user.telegramId);
      }
    }
    
    if (!user || !user.id) {
      return res.status(500).json({ error: 'Failed to get or create user' });
    }
    
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
    if (!req.user || !req.user.telegramId) {
      return res.status(401).json({ error: 'Invalid user data' });
    }
    
    const { getOrCreateUser, getUserByTelegramId } = require('./database');
    
    // Преобразуем req.user в формат, который ожидает getOrCreateUser
    // getOrCreateUser ожидает объект с полем 'id', а у нас 'telegramId'
    const telegramUser = {
      id: req.user.telegramId,
      username: req.user.username || null,
      first_name: req.user.firstName || null,
      last_name: null
    };
    
    // Создаем пользователя, если его еще нет (для новых пользователей)
    let user = await getUserByTelegramId(telegramUser.id);
    
    if (!user) {
      try {
        user = await getOrCreateUser(telegramUser);
      } catch (createErr) {
        console.error('Error creating user in bonus check:', createErr);
        // Пытаемся получить пользователя еще раз (возможно, он был создан в другом запросе)
        user = await getUserByTelegramId(telegramUser.id);
      }
    }
    
    if (!user || !user.id) {
      console.error('Check bonus game error: Failed to get or create user', { 
        user, 
        telegramUser,
        reqUser: req.user 
      });
      return res.status(500).json({ error: 'Failed to get or create user' });
    }
    
    const bonusInfo = await canPlayBonusGame(user.id);

    res.json(bonusInfo);
  } catch (err) {
    console.error('Check bonus game error:', err);
    console.error('Error stack:', err.stack);
    console.error('Request user:', req.user);
    res.status(500).json({ error: 'Failed to check bonus game availability' });
  }
});

// API: Начать игру за бонусы (записывает попытку сразу при старте)
app.post('/api/game/bonus/start', authMiddleware, async (req, res) => {
  try {
    console.log('[/api/game/bonus/start] Request received from user:', req.user.telegramId);

    const { getUserByTelegramId, getOrCreateUser } = require('./database');

    // Получаем пользователя из базы данных
    let user = await getUserByTelegramId(req.user.telegramId);

    // Если пользователя нет, создаем его с данными из токена
    if (!user) {
      console.log('[/api/game/bonus/start] User not found, creating new user');
      try {
        // Создаем пользователя с данными из токена
        const telegramUserData = {
          id: req.user.telegramId,
          username: req.user.username || null,
          first_name: req.user.firstName || 'User',
          last_name: null
        };
        user = await getOrCreateUser(telegramUserData);
        console.log('[/api/game/bonus/start] User created:', user.id);
      } catch (userErr) {
        console.error('[/api/game/bonus/start] Error creating user:', userErr);
        return res.status(500).json({ error: 'Failed to create user', details: userErr.message });
      }
    } else {
      console.log('[/api/game/bonus/start] User found:', user.id);
    }

    // Проверяем доступность игры за бонусы
    let bonusInfo;
    try {
      bonusInfo = await canPlayBonusGame(user.id);
      console.log('[/api/game/bonus/start] Bonus game availability:', bonusInfo);
    } catch (bonusErr) {
      console.error('[/api/game/bonus/start] Error checking bonus availability:', bonusErr);
      return res.status(500).json({ error: 'Failed to check bonus game availability', details: bonusErr.message });
    }

    if (!bonusInfo.canPlay) {
      console.log('[/api/game/bonus/start] Bonus game not available, nextAvailable:', bonusInfo.nextAvailable);
      return res.status(403).json({ error: 'Bonus game not available yet', nextAvailable: bonusInfo.nextAvailable });
    }

    // Записываем попытку сразу при старте игры
    try {
      await recordBonusAttempt(user.id);
      console.log('[/api/game/bonus/start] Bonus attempt recorded for user:', user.id);
    } catch (recordErr) {
      console.error('[/api/game/bonus/start] Error recording bonus attempt:', recordErr);
      return res.status(500).json({ error: 'Failed to record bonus attempt', details: recordErr.message });
    }

    console.log('[/api/game/bonus/start] Bonus game started successfully for user:', user.id);
    res.json({ success: true, message: 'Bonus game started' });
  } catch (err) {
    console.error('[/api/game/bonus/start] Unexpected error:', err);
    console.error('[/api/game/bonus/start] Error stack:', err.stack);
    res.status(500).json({ error: 'Failed to start bonus game', details: err.message });
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

    // Получаем текущую статистику пользователя ДО начисления бонусов
    const userStatsBefore = await getUserStats(user.id);
    const currentTotalBonuses = userStatsBefore.total_bonuses || 0;
    const maxBonuses = 500;

    // Начисление бонусов
    let bonusesEarned = 0;

    if (gameType === 'bonus') {
      // Проверка для игры за бонусы (но попытка уже записана при старте)
      const bonusInfo = await canPlayBonusGame(user.id);
      // Если попытка уже записана при старте, это нормально, просто проверяем

      // В игре за бонусы: 1 бонус за обычный блок, 2 за perfect
      const calculatedBonuses = (normalCount * 1) + (perfectCount * 2);

      // Проверяем лимит накопления для игры за бонусы (максимум 500)
      const newTotalBonuses = currentTotalBonuses + calculatedBonuses;

      if (newTotalBonuses > maxBonuses) {
        // Начисляем только до лимита (если уже достигли лимита, начисляем 0)
        bonusesEarned = Math.max(0, maxBonuses - currentTotalBonuses);
        console.log(`⚠️ Лимит бонусов достигнут! Было: ${currentTotalBonuses}, пытались начислить: ${calculatedBonuses}, начислено: ${bonusesEarned}`);
      } else {
        bonusesEarned = calculatedBonuses;
      }
    } else if (gameType === 'normal') {
      // В обычной игре: 1 бонус за обычный блок, 2 за perfect
      const calculatedBonuses = (normalCount * 1) + (perfectCount * 2);

      // Проверяем лимит накопления (максимум 500)
      const newTotalBonuses = currentTotalBonuses + calculatedBonuses;

      if (newTotalBonuses > maxBonuses) {
        // Начисляем только до лимита
        bonusesEarned = Math.max(0, maxBonuses - currentTotalBonuses);
        console.log(`⚠️ Лимит бонусов достигнут! Было: ${currentTotalBonuses}, пытались начислить: ${calculatedBonuses}, начислено: ${bonusesEarned}`);
      } else {
        bonusesEarned = calculatedBonuses;
      }
    }

    console.log(`💾 Сохранение игры для пользователя ${user.id}:`, {
      gameType,
      score,
      floors,
      bonusesEarned,
      perfectCount,
      normalCount,
      currentTotalBonuses
    });

    // Сохранение игры в таблицу games
    const gameId = await saveGame(user.id, gameType, score, floors, bonusesEarned);
    console.log(`✅ Игра сохранена с ID: ${gameId}`);

    // Получаем статистику до обновления для проверки уведомлений
    const statsBefore = await getUserStats(user.id);
    const bonusesBefore = statsBefore.total_bonuses || 0;
    console.log(`📊 Статистика ДО обновления:`, statsBefore);

    // Обновляем статистику пользователя (total_games, total_bonuses, best_score)
    const updatedStats = await updateUserStats(user.id, score, bonusesEarned);
    console.log(`📊 Статистика ПОСЛЕ обновления:`, updatedStats);

    // Получаем финальную статистику для проверки
    const statsAfter = await getUserStats(user.id);
    const bonusesAfter = statsAfter.total_bonuses || 0;
    console.log(`✅ Финальная статистика:`, {
      bonusesBefore,
      bonusesEarned,
      bonusesAfter,
      expectedBonuses: bonusesBefore + bonusesEarned,
      matches: bonusesAfter === bonusesBefore + bonusesEarned
    });

    // Отправляем уведомления
    try {
      const bot = require('./telegram');
      if (bot) {
        // Уведомления отправляются ТОЛЬКО для игры за бонусы
        if (gameType === 'bonus') {
          const remaining = Math.max(0, 500 - bonusesAfter);
          const progressBar = Math.floor((bonusesAfter / 500) * 10);
          const progressBarFill = '🟩'.repeat(progressBar);
          const progressBarEmpty = '⬜'.repeat(10 - progressBar);

          // Всегда отправляем уведомление после игры за бонусы (даже если 0 бонусов)
          await bot.telegram.sendMessage(
            user.telegram_id,
            `❄️ <b>ЗИМНИЙ ПОДЪЁМ - ИГРА ЗАВЕРШЕНА!</b> ❄️\n\n` +
            `🎯 <b>"Поднимайся выше - собирай больше бонусов!"</b>\n\n` +
            `🎉 Поздравляем с завершением игры за бонусы!\n\n` +
            `💰 <b>Набрано бонусов:</b> ${bonusesEarned}\n` +
            `📊 <b>Всего в банке:</b> ${bonusesAfter} / 500\n\n` +
            `📈 <b>Прогресс к выводу:</b>\n` +
            `${progressBarFill}${progressBarEmpty}\n\n` +
            `${remaining > 0 ? `⏳ Осталось накопить: <b>${remaining} бонусов</b> до вывода\n\n` : `✅ Поздравляем! Вы достигли лимита в 500 бонусов!\n\n`}` +
            `🎁 <b>Как вывести бонусы:</b>\n` +
            `1️⃣ Накопите <b>500 бонусов</b> (${remaining > 0 ? `осталось ${remaining}` : '✅ готово'})\n` +
            `2️⃣ Пополните игровой баланс на <b>50% от суммы</b> (250 рублей)\n` +
            `3️⃣ Подойдите к ресепшну в одном из клубов:\n` +
            `   • Суворова 27а\n` +
            `   • Ленина 26\n` +
            `4️⃣ Получите свои 500 бонусов!\n\n` +
            `⏰ <b>Напоминание:</b> Игра за бонусы доступна <b>1 раз в день</b>\n\n` +
            `🚀 Продолжайте подниматься к вершине!`,
            {
              parse_mode: 'HTML'
            }
          );

          // Дополнительное поздравление при достижении 500 бонусов в игре за бонусы (только один раз)
          if (bonusesBefore < 500 && bonusesAfter >= 500) {
            await bot.telegram.sendMessage(
              user.telegram_id,
              `❄️🎉 <b>ЗИМНИЙ ПОДЪЁМ - УСПЕХ!</b> 🎉❄️\n\n` +
              `🎯 <b>"Поднимайся выше - собирай больше бонусов!"</b>\n\n` +
              `🏆 <b>ПОЗДРАВЛЯЕМ!</b> 🏆\n\n` +
              `✨ Вы достигли лимита в <b>500 бонусов</b> в банке!\n\n` +
              `💪 Невероятный результат! Вы настоящий мастер игры!\n\n` +
              `🎁 <b>Теперь вы можете вывести свои бонусы!</b>\n\n` +
              `📋 <b>Что нужно сделать для вывода:</b>\n` +
              `1️⃣ Подойдите к ресепшну в одном из наших клубов:\n` +
              `   🏢 Суворова 27а\n` +
              `   🏢 Ленина 26\n\n` +
              `2️⃣ Пополните игровой баланс на <b>50% от суммы</b>\n` +
              `   💰 Это <b>250 рублей</b> (50% от 500 бонусов)\n\n` +
              `3️⃣ Скажите сотруднику, что хотите вывести бонусы из игры\n\n` +
              `4️⃣ Получите свои <b>500 бонусов</b>! 🎊\n\n` +
              `💡 <b>Важно:</b> Бонусы сохраняются в вашем банке до вывода. Новые бонусы будут начисляться только после вывода.\n\n` +
              `🚀 Спасибо за участие в акции "Зимний Подъём"!\n` +
              `🎮 Продолжайте играть и устанавливайте новые рекорды!`,
              {
                parse_mode: 'HTML'
              }
            );
          }
        }
      }
    } catch (err) {
      console.error('Error sending bonus notification:', err);
      // Не прерываем сохранение игры из-за ошибки уведомления
    }

    // Возвращаем обновленную статистику в ответе
    const finalStats = await getUserStats(user.id);

    res.json({
      success: true,
      bonusesEarned,
      message: bonusesEarned > 0 ? `Вы получили ${bonusesEarned} бонусов!` : null,
      stats: {
        totalBonuses: finalStats.total_bonuses || 0,
        totalGames: finalStats.total_games || 0,
        bestScore: finalStats.best_score || 0,
        bonusGamesCount: finalStats.bonus_games_count || 0
      }
    });

    console.log(`✅ Сохранение игры завершено успешно для пользователя ${user.id}`);
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

// API: Получить ежедневную статистику
app.get('/api/admin/daily-stats', async (req, res) => {
  try {
    // В production здесь должна быть проверка прав администратора
    const { getDailyStats, getDailyStatsSummary } = require('./database');
    const date = req.query.date || null;
    
    const summary = await getDailyStatsSummary(date);
    const details = await getDailyStats(date);
    
    res.json({
      date: date || new Date().toISOString().split('T')[0],
      summary,
      details
    });
  } catch (err) {
    console.error('Get daily stats error:', err);
    res.status(500).json({ error: 'Failed to get daily stats' });
  }
});

// API: Получить общую статистику за все время
app.get('/api/admin/all-time-stats', async (req, res) => {
  try {
    // В production здесь должна быть проверка прав администратора
    const { getAllTimeStats, getAllUsersWithStats } = require('./database');
    
    const allTimeStats = await getAllTimeStats();
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const users = await getAllUsersWithStats(limit, offset);
    
    res.json({
      stats: allTimeStats,
      users,
      pagination: {
        limit,
        offset,
        total: allTimeStats.total_users
      }
    });
  } catch (err) {
    console.error('Get all-time stats error:', err);
    res.status(500).json({ error: 'Failed to get all-time stats' });
  }
});

// API: Создать рекламное сообщение
app.post('/api/admin/advertisement/create', async (req, res) => {
  try {
    const { createAdvertisement } = require('./database');
    const { title, message, targetAllUsers = true, minGames = 0, minBonuses = 0 } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }
    
    const adId = await createAdvertisement(title, message, {
      targetAllUsers,
      minGames,
      minBonuses
    });
    
    res.json({ success: true, advertisementId: adId });
  } catch (err) {
    console.error('Create advertisement error:', err);
    res.status(500).json({ error: 'Failed to create advertisement' });
  }
});

// API: Получить список рекламных сообщений
app.get('/api/admin/advertisements', async (req, res) => {
  try {
    const { getAdvertisements } = require('./database');
    const activeOnly = req.query.active === 'true';
    const ads = await getAdvertisements(activeOnly);
    res.json({ advertisements: ads });
  } catch (err) {
    console.error('Get advertisements error:', err);
    res.status(500).json({ error: 'Failed to get advertisements' });
  }
});

// API: Отправить рекламное сообщение
app.post('/api/admin/advertisement/:adId/send', async (req, res) => {
  try {
    const { getAdvertisement, getTargetUsersForAdvertisement, updateAdvertisementStatus, logAdvertisementSend } = require('./database');
    const bot = require('./telegram');
    const adId = parseInt(req.params.adId);
    
    if (!bot) {
      return res.status(500).json({ error: 'Bot not initialized' });
    }
    
    const ad = await getAdvertisement(adId);
    if (!ad) {
      return res.status(404).json({ error: 'Advertisement not found' });
    }
    
    const targetUsers = await getTargetUsersForAdvertisement(ad);
    
    let sentCount = 0;
    let errorCount = 0;
    
    for (const user of targetUsers) {
      try {
        await bot.telegram.sendMessage(
          user.telegram_id,
          `📢 <b>${ad.title}</b>\n\n${ad.message}`,
          { parse_mode: 'HTML' }
        );
        await logAdvertisementSend(adId, user.id, 'sent');
        sentCount++;
        
        // Небольшая задержка чтобы не превысить лимиты Telegram API
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (err) {
        console.error(`Error sending ad ${adId} to user ${user.id}:`, err);
        await logAdvertisementSend(adId, user.id, 'error', err.message);
        errorCount++;
      }
    }
    
    await updateAdvertisementStatus(adId, sentCount, new Date().toISOString());
    
    res.json({
      success: true,
      sent: sentCount,
      errors: errorCount,
      total: targetUsers.length
    });
  } catch (err) {
    console.error('Send advertisement error:', err);
    res.status(500).json({ error: 'Failed to send advertisement' });
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

// Система уведомлений о доступности игры за бонусы
const { sendBonusGameAvailableNotifications } = require('./notifications');

// Запускаем проверку уведомлений каждый час
let notificationInterval = null;
function startNotificationScheduler() {
  // Проверяем сразу при запуске
  sendBonusGameAvailableNotifications().catch(err => {
    console.error('Error in initial notification check:', err);
  });

  // Затем проверяем каждый час
  notificationInterval = setInterval(() => {
    sendBonusGameAvailableNotifications().catch(err => {
      console.error('Error in scheduled notification check:', err);
    });
  }, 60 * 60 * 1000); // Каждый час

  console.log('🔔 Система уведомлений о доступности игры за бонусы запущена (проверка каждый час)');
}

// Запуск сервера
app.listen(config.port, async () => {
  console.log(`🚀 Server running on port ${config.port}`);
  console.log(`🎮 Game available at ${config.frontendUrl}`);

  // Запускаем систему уведомлений
  startNotificationScheduler();

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
      
      // Периодическая проверка webhook (каждые 10 минут)
      setInterval(async () => {
        try {
          const currentWebhookInfo = await bot.telegram.getWebhookInfo();
          if (currentWebhookInfo.url !== webhookUrl) {
            console.log('⚠️  Webhook URL changed or missing, re-setting...');
            await bot.telegram.setWebhook(webhookUrl);
            console.log('✅ Webhook re-set successfully');
          } else if (currentWebhookInfo.pending_update_count > 100) {
            console.log(`⚠️  Too many pending updates (${currentWebhookInfo.pending_update_count}), clearing...`);
            await bot.telegram.deleteWebhook({ drop_pending_updates: true });
            await bot.telegram.setWebhook(webhookUrl);
            console.log('✅ Webhook cleared and re-set');
          }
        } catch (checkErr) {
          console.error('❌ Error checking webhook:', checkErr);
        }
      }, 10 * 60 * 1000); // Каждые 10 минут
    } catch (err) {
      console.error('❌ Error setting webhook:', err);
      console.error('Error details:', err.message);
      if (err.response) {
        console.error('Telegram API response:', err.response);
      }
      console.error('Bot will not receive updates until webhook is configured correctly');
      
      // Пытаемся переустановить webhook через минуту
      setTimeout(async () => {
        try {
          const webhookUrl = `${config.telegramWebhookUrl}/webhook`;
          console.log('🔄 Retrying webhook setup...');
          await bot.telegram.setWebhook(webhookUrl);
          console.log('✅ Webhook set successfully on retry');
        } catch (retryErr) {
          console.error('❌ Retry failed:', retryErr);
        }
      }, 60 * 1000);
    }
  } else if (config.telegramBotToken) {
    console.log(`⚠️  Bot token found but webhook URL not set - bot will work in polling mode`);
    console.log(`🤖 Telegram bot is active (polling mode)`);
  } else if (!config.telegramBotToken) {
    console.log(`⚠️  Telegram bot token not provided - bot disabled`);
  }
});


