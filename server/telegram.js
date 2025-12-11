const { Telegraf } = require('telegraf');
const config = require('./config');
const { getOrCreateUser } = require('./database');
const { generateToken } = require('./auth');

let bot = null;

// Функция для проверки подписки пользователя на канал
async function checkChannelSubscription(userId) {
  if (!config.requiredChannel || !bot) {
    // Если канал не указан или бот не инициализирован, разрешаем доступ
    return true;
  }

  try {
    let channelIdentifier = config.requiredChannel.replace('@', '');
    
    // Определяем формат канала и пробуем разные варианты
    const channelFormats = [];
    
    // Если это числовой ID (начинается с -100 или просто число)
    if (channelIdentifier.match(/^-?\d+$/)) {
      // Это уже ID канала
      channelFormats.push(channelIdentifier);  // -1001935382352
      // Не добавляем -100, так как он уже есть
    } else {
      // Это username канала
      channelFormats.push(channelIdentifier);           // colizeum_kamensk_uralskiy
      channelFormats.push(`@${channelIdentifier}`);     // @colizeum_kamensk_uralskiy
    }
    
    let lastError = null;
    
    // Пробуем каждый формат
    for (const channelId of channelFormats) {
      try {
        const member = await bot.telegram.getChatMember(channelId, userId);
        
        // Статусы, которые считаются подпиской: member, administrator, creator
        const subscribedStatuses = ['member', 'administrator', 'creator'];
        const isSubscribed = subscribedStatuses.includes(member.status);
        
        console.log(`✅ Subscription check for user ${userId} in ${channelId}:`, {
          status: member.status,
          isSubscribed
        });
        
        return isSubscribed;
      } catch (err) {
        lastError = err;
        // Продолжаем пробовать другие форматы только если есть другие форматы
        if (err.response?.error_code === 400 && err.response?.description?.includes('chat not found')) {
          // Логируем только если есть еще форматы для проверки
          if (channelFormats.indexOf(channelId) < channelFormats.length - 1) {
            console.log(`⚠️ Channel ${channelId} not found, trying next format...`);
          }
          continue;
        }
        // Если это другая ошибка (не "chat not found"), пробуем следующий формат
        continue;
      }
    }
    
    // Если все форматы не сработали
    // Логируем ошибку только один раз в минуту для каждого канала (чтобы не спамить логи)
    const errorKey = `channel_error_${config.requiredChannel}`;
    const lastErrorTime = global[errorKey] || 0;
    const now = Date.now();
    
    if (now - lastErrorTime > 60000) { // Логируем раз в минуту
      console.error(`❌ Error checking subscription for user ${userId}: All channel formats failed`, {
        channel: config.requiredChannel,
        lastError: lastError?.response?.description || lastError?.message
      });
      
      // Если ошибка "chat not found" - это значит, что бот не может найти канал
      // Возможные причины: бот не добавлен в канал, неправильное имя канала, канал приватный
      // В этом случае разрешаем доступ, но логируем предупреждение
      if (lastError?.response?.error_code === 400 && lastError?.response?.description?.includes('chat not found')) {
        console.warn(`⚠️ WARNING: Bot cannot access channel ${config.requiredChannel}. Make sure:`);
        console.warn(`   1. Bot is added to the channel as administrator`);
        console.warn(`   2. Channel username/ID is correct: ${config.requiredChannel}`);
        console.warn(`   3. Bot has permission to view chat members`);
        console.warn(`   Allowing access for now, but subscription check is disabled.`);
      }
      
      global[errorKey] = now;
    }
    
    // Разрешаем доступ при ошибке (чтобы не блокировать пользователей из-за проблем с конфигурацией)
    return true;
    
    // Для других ошибок также разрешаем доступ (чтобы не блокировать пользователей из-за проблем с API)
    return true;
  } catch (err) {
    console.error(`❌ Unexpected error checking subscription for user ${userId}:`, err);
    // При неожиданной ошибке разрешаем доступ
    return true;
  }
}

if (config.telegramBotToken) {
  bot = new Telegraf(config.telegramBotToken);

  // Логирование всех входящих обновлений для отладки
  bot.use(async (ctx, next) => {
    try {
      console.log('📨 Bot update received:', {
        update_id: ctx.update?.update_id,
        type: ctx.updateType,
        message: ctx.message ? { text: ctx.message.text, command: ctx.message.entities?.[0]?.type } : null,
        callback_query: ctx.callbackQuery ? { data: ctx.callbackQuery.data } : null
      });
      await next();
    } catch (err) {
      console.error('❌ Error in bot middleware:', err);
      // Не пробрасываем ошибку дальше, чтобы не упал процесс
      try {
        if (ctx && ctx.reply) {
          await ctx.reply('Произошла ошибка. Попробуйте позже или используйте команду /help.').catch(() => {});
        }
      } catch (replyErr) {
        console.error('Error sending error message:', replyErr);
      }
    }
  });

  // Команда /start
  bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id;
    const user = ctx.from;

    try {
      console.log('[/start] ========================================');
      console.log('[/start] Command received from user:', user?.id, user?.first_name);
      console.log('[/start] Chat ID:', chatId);
      console.log('[/start] Update ID:', ctx.update?.update_id);
      console.log('[/start] ========================================');
      
      // Проверяем наличие пользователя
      if (!user || !user.id) {
        console.error('[/start] Invalid user data:', user);
        await ctx.reply('Ошибка: Не удалось получить данные пользователя. Попробуйте позже.');
        return;
      }

      // Проверяем подписку на канал
      const isSubscribed = await checkChannelSubscription(user.id);
      if (!isSubscribed) {
        const channelLink = config.requiredChannel || '@colizeum_kamensk_uralskiy';
        await ctx.reply(
          `⚠️ <b>Для игры требуется подписка на наш канал!</b>\n\n` +
          `📢 Подпишитесь на канал: ${channelLink}\n\n` +
          `После подписки используйте команду /start еще раз.`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '📢 Подписаться на канал',
                    url: `https://t.me/${channelLink.replace('@', '')}`
                  }
                ],
                [
                  {
                    text: '✅ Я подписался',
                    callback_data: 'check_subscription'
                  }
                ]
              ]
            }
          }
        );
        return;
      }

      // Создаем или получаем пользователя
      let dbUser;
      try {
        dbUser = await getOrCreateUser(user);
        console.log('[/start] User created/retrieved:', dbUser.id);
      } catch (dbErr) {
        console.error('[/start] Database error:', dbErr);
        // Продолжаем работу даже если есть проблема с БД (для совместимости)
        dbUser = null;
      }
      
      // Формируем URL игры
      const gameUrl = `${config.frontendUrl}?tgWebAppStartParam=${user.id}`;
      console.log('[/start] Game URL:', gameUrl);
      
      // Проверяем, является ли URL localhost (для разработки)
      const isLocalhost = config.frontendUrl.includes('localhost') || config.frontendUrl.includes('127.0.0.1');
      
      const welcomeMessage = 
        `❄️ <b>ЗИМНИЙ ПОДЪЁМ</b> ❄️\n\n` +
        `🎯 <b>"Поднимайся выше - собирай больше бонусов!"</b>\n\n` +
        `🎮 <b>Добро пожаловать в Colizeum Tower Game!</b>\n\n` +
        `🚀 Готов начать свой подъём к вершине?\n\n` +
        `Нажмите на кнопку ниже, чтобы начать:`;
      
      if (isLocalhost) {
        // Для localhost просто отправляем текст со ссылкой (без кнопки)
        console.log('[/start] Sending localhost message');
        await ctx.reply(
          welcomeMessage + `\n\n🔗 Откройте ссылку в браузере:\n<a href="${gameUrl}">${gameUrl}</a>`,
          {
            parse_mode: 'HTML',
            disable_web_page_preview: true
          }
        );
      } else {
        // Для production используем Web App кнопку и дополнительные кнопки
        console.log('[/start] Sending production message with buttons');
        
        // Формируем кнопки правильно для Telegram API
        const inlineKeyboard = [
          [
            {
              text: '🎮 Начать игру',
              web_app: {
                url: gameUrl
              }
            }
          ],
          [
            {
              text: '🏗️ Концепция игры',
              callback_data: 'info_concept'
            },
            {
              text: '🎲 Как играть',
              callback_data: 'info_howtoplay'
            }
          ],
          [
            {
              text: '💰 Накопительная система',
              callback_data: 'info_bonus_system'
            },
            {
              text: '🎁 Как вывести бонусы',
              callback_data: 'info_withdrawal'
            }
          ],
          [
            {
              text: '📊 Статистика',
              callback_data: 'show_stats'
            },
            {
              text: '❓ Помощь',
              callback_data: 'show_help'
            }
          ]
        ];
        
        console.log('[/start] Keyboard structure:', JSON.stringify(inlineKeyboard, null, 2));
        
        await ctx.reply(
          welcomeMessage,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: inlineKeyboard
            }
          }
        );
      }
      console.log('[/start] Command completed successfully');
    } catch (err) {
      console.error('[/start] Error details:', {
        message: err.message,
        stack: err.stack,
        name: err.name,
        user: user ? { id: user.id, name: user.first_name } : 'null'
      });
      try {
        await ctx.reply('❌ Произошла ошибка. Попробуйте позже или используйте команду /help для помощи.');
      } catch (replyErr) {
        console.error('[/start] Error sending error message:', replyErr);
      }
    }
  });

  // Callback для проверки подписки после того, как пользователь подписался
  bot.action('check_subscription', async (ctx) => {
    try {
      await ctx.answerCbQuery('Проверяю подписку...');
      
      const userId = ctx.from.id;
      const isSubscribed = await checkChannelSubscription(userId);
      
      if (isSubscribed) {
        await ctx.reply('✅ Отлично! Вы подписаны на канал. Теперь используйте команду /start для начала игры!');
      } else {
        const channelLink = config.requiredChannel || '@colizeum_kamensk_uralskiy';
        await ctx.reply(
          `❌ Вы еще не подписаны на канал.\n\n` +
          `Пожалуйста, подпишитесь: ${channelLink}\n` +
          `Затем нажмите кнопку "✅ Я подписался" еще раз.`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '📢 Подписаться на канал',
                    url: `https://t.me/${channelLink.replace('@', '')}`
                  }
                ],
                [
                  {
                    text: '✅ Я подписался',
                    callback_data: 'check_subscription'
                  }
                ]
              ]
            }
          }
        );
      }
    } catch (err) {
      console.error('Error in check_subscription callback:', err);
      await ctx.answerCbQuery('Произошла ошибка').catch(() => {});
    }
  });

  // Команда /stats
  bot.command('stats', async (ctx) => {
    const chatId = ctx.chat.id;
    const user = ctx.from;

    try {
      const dbUser = await getOrCreateUser(user);
      const { getUserStats, getUserRank, canPlayBonusGame } = require('./database');
      const stats = await getUserStats(dbUser.id);
      const rank = await getUserRank(dbUser.id);
      const bonusInfo = await canPlayBonusGame(dbUser.id);

      let bonusStatus = '';
      if (bonusInfo.canPlay) {
        bonusStatus = '✅ <b>Доступно сейчас!</b>\n🎮 Можете играть за бонусы прямо сейчас!';
      } else {
        const nextAvailable = new Date(bonusInfo.nextAvailable);
        const now = new Date();
        const hours = Math.floor((nextAvailable - now) / (1000 * 60 * 60));
        const minutes = Math.floor(((nextAvailable - now) % (1000 * 60 * 60)) / (1000 * 60));
        bonusStatus = `⏰ <b>Доступно через: ${hours}ч ${minutes}м</b>\n⏳ Осталось подождать до следующей игры за бонусы`;
      }

      const totalBonuses = stats.total_bonuses || 0;
      const remaining = Math.max(0, 500 - totalBonuses);
      const progressBar = Math.floor((totalBonuses / 500) * 10);
      const progressBarFill = '🟩'.repeat(progressBar);
      const progressBarEmpty = '⬜'.repeat(10 - progressBar);

      await ctx.reply(
        `❄️ <b>ЗИМНИЙ ПОДЪЁМ - ВАША СТАТИСТИКА</b> ❄️\n\n` +
        `👤 <b>Игрок:</b> ${user.first_name || 'Игрок'}\n\n` +
        `📊 <b>Игровые достижения:</b>\n` +
        `🎮 Всего игр: <b>${stats.games_count || 0}</b>\n` +
        `🎁 Игр за бонусы: <b>${stats.bonus_games_count || 0}</b>\n` +
        `⭐ Лучший результат: <b>${stats.best_score || 0} этажей</b>\n` +
        `🏆 Место в топе: <b>${rank ? `#${rank}` : '-'}</b>\n\n` +
        `💰 <b>Банк бонусов:</b> <b>${totalBonuses}</b> / 500\n` +
        `${progressBarFill}${progressBarEmpty}\n` +
        `${remaining > 0 ? `⏳ Осталось накопить: <b>${remaining} бонусов</b> до вывода\n` : `✅ Вы достигли лимита в 500 бонусов!\n`}` +
        `\n🎁 <b>Игра за бонусы:</b>\n${bonusStatus}\n\n` +
        `💡 <b>Напоминание:</b> Для вывода бонусов накопите 500 и пополните баланс на 50% (250 рублей) в клубе.\n\n` +
        `🚀 Используйте /start для начала игры!`,
        {
          parse_mode: 'HTML'
        }
      );
    } catch (err) {
      console.error('Error in /stats command:', err);
      await ctx.reply('Произошла ошибка при получении статистики.');
    }
  });

  // Команда /help
  bot.command('help', async (ctx) => {
    await ctx.reply(
      `❄️ <b>ЗИМНИЙ ПОДЪЁМ - СПРАВКА</b> ❄️\n\n` +
      `📋 <b>Доступные команды:</b>\n` +
      `/start - Начать игру и узнать об акции\n` +
      `/stats - Посмотреть вашу статистику и прогресс\n` +
      `/help - Показать эту справку\n\n` +
      `🎯 <b>Правила игры:</b>\n` +
      `• Блок раскачивается на верёвке - следите за его движением\n` +
      `• Нажмите в нужный момент, чтобы установить блок на башню\n` +
      `• Если блок установлен успешно - получаете <b>1 бонус</b>\n` +
      `• Если блок установлен идеально (Perfect) - получаете <b>2 бонуса</b>\n` +
      `• Чем выше башня, тем сложнее попасть идеально\n` +
      `• Башня упала? Игра окончена!\n\n` +
      `💰 <b>Накопительная система бонусов:</b>\n` +
      `• Все заработанные бонусы сохраняются в вашем "банке"\n` +
      `• Бонусы накапливаются от игры к игре\n` +
      `• Максимальный лимит накопления: <b>500 бонусов</b>\n` +
      `• После достижения 500 бонусов новые не начисляются (до вывода)\n\n` +
      `🎁 <b>Как вывести бонусы:</b>\n` +
      `1️⃣ Накопите <b>500 бонусов</b> в игре\n` +
      `2️⃣ Пополните игровой баланс на <b>50% от суммы</b> (250 рублей)\n` +
      `3️⃣ Подойдите к ресепшну в клубе:\n` +
      `   • Суворова 27а\n` +
      `   • Ленина 26\n` +
      `4️⃣ Получите свои 500 бонусов!\n\n` +
      `⏰ <b>Важные правила:</b>\n` +
      `• Игра за бонусы доступна <b>только 1 раз в день</b>\n` +
      `• Обычная игра без ограничений (бонусы начисляются, но копятся до лимита 500)\n` +
      `• Прогресс сохраняется автоматически\n\n` +
      `🎮 <b>Два режима игры:</b>\n` +
      `• <b>Обычная игра</b> - тренируйтесь без ограничений (бонусы начисляются: 1 за обычный блок, 2 за perfect, копятся до лимита 500)\n` +
      `• <b>Игра за бонусы</b> - играйте раз в день и получайте бонусы в банк\n\n` +
      `❄️ <b>"Поднимайся выше - собирай больше бонусов!"</b> ❄️`,
      {
        parse_mode: 'HTML'
      }
    );
  });

  // Обработчики callback для кнопок
  bot.action('info_concept', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        `🏗️ <b>КОНЦЕПЦИЯ ИГРЫ</b>\n\n` +
        `Построй самую высокую башню! Управляй блоком, нажимая в нужный момент. Чем выше башня, тем больше бонусов ты получаешь!\n\n` +
        `🎯 Цель: Установить как можно больше блоков, построив самую высокую башню!\n\n` +
        `💡 Твоя задача - следить за движением блока и нажимать в нужный момент для его установки.`,
        {
          parse_mode: 'HTML'
        }
      );
    } catch (err) {
      console.error('Error in info_concept callback:', err);
      await ctx.answerCbQuery('Произошла ошибка').catch(() => {});
    }
  });

  bot.action('info_howtoplay', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        `🎲 <b>КАК ИГРАТЬ</b>\n\n` +
        `1️⃣ Блок раскачивается на верёвке\n` +
        `2️⃣ Следи за его движением\n` +
        `3️⃣ Нажми в нужный момент, чтобы установить блок\n` +
        `4️⃣ Идеальное попадание (Perfect) даёт больше бонусов\n` +
        `5️⃣ Чем выше башня, тем сложнее играть\n\n` +
        `⚠️ Если блок упал мимо башни - игра окончена!`,
        {
          parse_mode: 'HTML'
        }
      );
    } catch (err) {
      console.error('Error in info_howtoplay callback:', err);
      await ctx.answerCbQuery('Произошла ошибка').catch(() => {});
    }
  });

  bot.action('info_bonus_system', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        `💰 <b>НАКОПИТЕЛЬНАЯ СИСТЕМА БОНУСОВ</b>\n\n` +
        `🎯 <b>Начисление бонусов:</b>\n` +
        `• За обычный блок: <b>1 бонус</b>\n` +
        `• За идеальный блок (Perfect): <b>2 бонуса</b>\n\n` +
        `🏦 <b>Банк бонусов:</b>\n` +
        `• Бонусы копятся в вашем "банке" и не теряются\n` +
        `• Максимальный лимит накопления: <b>500 бонусов</b>\n` +
        `• После достижения 500 бонусов новые не начисляются (до вывода)\n\n` +
        `💡 Все бонусы сохраняются между играми!`,
        {
          parse_mode: 'HTML'
        }
      );
    } catch (err) {
      console.error('Error in info_bonus_system callback:', err);
      await ctx.answerCbQuery('Произошла ошибка').catch(() => {});
    }
  });

  bot.action('info_withdrawal', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        `🎁 <b>КАК ВЫВЕСТИ БОНУСЫ</b>\n\n` +
        `📋 <b>Что нужно сделать:</b>\n\n` +
        `1️⃣ Накопите <b>500 бонусов</b> в игре\n\n` +
        `2️⃣ Пополните игровой баланс на <b>50% от суммы</b>\n` +
        `   💰 Это <b>250 рублей</b> (50% от 500 бонусов)\n\n` +
        `3️⃣ Подойдите к ресепшну в одном из клубов:\n` +
        `   🏢 Суворова 27а\n` +
        `   🏢 Ленина 26\n\n` +
        `4️⃣ Скажите сотруднику, что хотите вывести бонусы из игры\n\n` +
        `5️⃣ Получите свои <b>500 бонусов</b>! 🎊\n\n` +
        `⏰ <b>Важно:</b> Игра за бонусы доступна <b>только 1 раз в день</b>!`,
        {
          parse_mode: 'HTML'
        }
      );
    } catch (err) {
      console.error('Error in info_withdrawal callback:', err);
      await ctx.answerCbQuery('Произошла ошибка').catch(() => {});
    }
  });

  bot.action('show_stats', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const user = ctx.from;
      const dbUser = await getOrCreateUser(user);
      const { getUserStats, getUserRank, canPlayBonusGame } = require('./database');
      const stats = await getUserStats(dbUser.id);
      const rank = await getUserRank(dbUser.id);
      const bonusInfo = await canPlayBonusGame(dbUser.id);

      let bonusStatus = '';
      if (bonusInfo.canPlay) {
        bonusStatus = '✅ <b>Доступно сейчас!</b>\n🎮 Можете играть за бонусы прямо сейчас!';
      } else {
        const nextAvailable = new Date(bonusInfo.nextAvailable);
        const now = new Date();
        const hours = Math.floor((nextAvailable - now) / (1000 * 60 * 60));
        const minutes = Math.floor(((nextAvailable - now) % (1000 * 60 * 60)) / (1000 * 60));
        bonusStatus = `⏰ <b>Доступно через: ${hours}ч ${minutes}м</b>\n⏳ Осталось подождать до следующей игры за бонусы`;
      }

      const totalBonuses = stats.total_bonuses || 0;
      const remaining = Math.max(0, 500 - totalBonuses);
      const progressBar = Math.floor((totalBonuses / 500) * 10);
      const progressBarFill = '🟩'.repeat(progressBar);
      const progressBarEmpty = '⬜'.repeat(10 - progressBar);

      await ctx.reply(
        `❄️ <b>ЗИМНИЙ ПОДЪЁМ - ВАША СТАТИСТИКА</b> ❄️\n\n` +
        `👤 <b>Игрок:</b> ${user.first_name || 'Игрок'}\n\n` +
        `📊 <b>Игровые достижения:</b>\n` +
        `🎮 Всего игр: <b>${stats.games_count || 0}</b>\n` +
        `🎁 Игр за бонусы: <b>${stats.bonus_games_count || 0}</b>\n` +
        `⭐ Лучший результат: <b>${stats.best_score || 0} этажей</b>\n` +
        `🏆 Место в топе: <b>${rank ? `#${rank}` : '-'}</b>\n\n` +
        `💰 <b>Банк бонусов:</b> <b>${totalBonuses}</b> / 500\n` +
        `${progressBarFill}${progressBarEmpty}\n` +
        `${remaining > 0 ? `⏳ Осталось накопить: <b>${remaining} бонусов</b> до вывода\n` : `✅ Вы достигли лимита в 500 бонусов!\n`}` +
        `\n🎁 <b>Игра за бонусы:</b>\n${bonusStatus}\n\n` +
        `💡 <b>Напоминание:</b> Для вывода бонусов накопите 500 и пополните баланс на 50% (250 рублей) в клубе.`,
        {
          parse_mode: 'HTML'
        }
      );
    } catch (err) {
      console.error('Error in show_stats callback:', err);
      try {
        await ctx.answerCbQuery('Произошла ошибка').catch(() => {});
        await ctx.reply('Произошла ошибка при получении статистики.').catch(() => {});
      } catch (replyErr) {
        console.error('Error sending error message:', replyErr);
      }
    }
  });

  // Административные команды (только для администраторов)
  const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS ? process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => parseInt(id.trim())) : [];
  
  const isAdmin = (userId) => {
    return ADMIN_IDS.length === 0 || ADMIN_IDS.includes(userId);
  };

  // Команда /admin_stats - статистика за день
  bot.command('admin_stats', async (ctx) => {
    try {
      if (!isAdmin(ctx.from.id)) {
        await ctx.reply('❌ У вас нет прав для выполнения этой команды.');
        return;
      }

      const { getDailyStats, getDailyStatsSummary } = require('./database');
      const date = ctx.message.text.split(' ')[1] || null; // Опциональная дата в формате YYYY-MM-DD
      
      const summary = await getDailyStatsSummary(date);
      const details = await getDailyStats(date);
      
      const dateStr = date || new Date().toISOString().split('T')[0];
      
      let message = `📊 <b>СТАТИСТИКА ЗА ${dateStr}</b>\n\n`;
      message += `👥 <b>Всего пользователей:</b> ${summary.total_users}\n`;
      message += `🎮 <b>Активных игроков:</b> ${summary.active_users}\n`;
      message += `🎯 <b>Всего игр сыграно:</b> ${summary.total_games}\n\n`;
      
      if (details.length > 0) {
        message += `<b>Список пользователей:</b>\n`;
        details.slice(0, 20).forEach((user, index) => {
          const username = user.username ? `@${user.username}` : user.first_name || 'Без имени';
          message += `${index + 1}. ${username} (ID: ${user.telegram_id}) - ${user.games_played} игр\n`;
        });
        if (details.length > 20) {
          message += `\n... и еще ${details.length - 20} пользователей`;
        }
      }
      
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('Error in /admin_stats command:', err);
      await ctx.reply('❌ Ошибка при получении статистики.');
    }
  });

  // Команда /admin_all_stats - общая статистика за все время
  bot.command('admin_all_stats', async (ctx) => {
    try {
      if (!isAdmin(ctx.from.id)) {
        await ctx.reply('❌ У вас нет прав для выполнения этой команды.');
        return;
      }

      const { getAllTimeStats, getAllUsersWithStats } = require('./database');
      
      const allTimeStats = await getAllTimeStats();
      const topUsers = await getAllUsersWithStats(20, 0);
      
      let message = `📊 <b>ОБЩАЯ СТАТИСТИКА ЗА ВСЕ ВРЕМЯ</b>\n\n`;
      message += `👥 <b>Всего зарегистрировано пользователей:</b> ${allTimeStats.total_users}\n`;
      message += `🎮 <b>Активных игроков:</b> ${allTimeStats.active_users}\n`;
      message += `🎯 <b>Всего игр сыграно:</b> ${allTimeStats.total_games || 0}\n`;
      message += `💰 <b>Всего бонусов заработано:</b> ${allTimeStats.total_bonuses || 0}\n`;
      message += `🏆 <b>Лучший результат:</b> ${allTimeStats.best_score || 0} этажей\n`;
      message += `📈 <b>Новых пользователей за 7 дней:</b> ${allTimeStats.new_users_7d || 0}\n`;
      message += `📈 <b>Новых пользователей за 30 дней:</b> ${allTimeStats.new_users_30d || 0}\n\n`;
      
      if (topUsers.length > 0) {
        message += `<b>Топ-20 активных игроков:</b>\n`;
        topUsers.forEach((user, index) => {
          const username = user.username ? `@${user.username}` : user.first_name || 'Без имени';
          message += `${index + 1}. ${username} - ${user.total_games || 0} игр, ${user.best_score || 0} этажей, ${user.total_bonuses || 0} бонусов\n`;
        });
      }
      
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('Error in /admin_all_stats command:', err);
      await ctx.reply('❌ Ошибка при получении общей статистики.');
    }
  });

  // Команда /admin_ad - создать рекламу
  bot.command('admin_ad', async (ctx) => {
    try {
      if (!isAdmin(ctx.from.id)) {
        await ctx.reply('❌ У вас нет прав для выполнения этой команды.');
        return;
      }

      const args = ctx.message.text.split('\n').filter(line => line.trim());
      if (args.length < 3) {
        await ctx.reply(
          '📝 <b>Создание рекламы</b>\n\n' +
          'Использование:\n' +
          '<code>/admin_ad\n' +
          'Заголовок\n' +
          'Текст сообщения\n' +
          'all (или min_games:5 min_bonuses:10)</code>\n\n' +
          'Пример:\n' +
          '<code>/admin_ad\n' +
          '🎉 Акция!\n' +
          'Новая акция для всех игроков!\n' +
          'all</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const title = args[1];
      const message = args[2];
      const optionsStr = args[3] || 'all';
      
      let options = { targetAllUsers: true, minGames: 0, minBonuses: 0 };
      
      if (optionsStr !== 'all') {
        options.targetAllUsers = false;
        const minGamesMatch = optionsStr.match(/min_games:(\d+)/);
        const minBonusesMatch = optionsStr.match(/min_bonuses:(\d+)/);
        if (minGamesMatch) options.minGames = parseInt(minGamesMatch[1]);
        if (minBonusesMatch) options.minBonuses = parseInt(minBonusesMatch[1]);
      }

      const { createAdvertisement } = require('./database');
      const adId = await createAdvertisement(title, message, options);
      
      await ctx.reply(
        `✅ Реклама создана!\n\n` +
        `ID: ${adId}\n` +
        `Заголовок: ${title}\n` +
        `Целевая аудитория: ${options.targetAllUsers ? 'Все пользователи' : `Мин. игр: ${options.minGames}, Мин. бонусов: ${options.minBonuses}`}\n\n` +
        `Отправьте /admin_send_ad ${adId} для отправки`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error('Error in /admin_ad command:', err);
      await ctx.reply('❌ Ошибка при создании рекламы.');
    }
  });

  // Команда /admin_ads - список рекламных сообщений
  bot.command('admin_ads', async (ctx) => {
    try {
      if (!isAdmin(ctx.from.id)) {
        await ctx.reply('❌ У вас нет прав для выполнения этой команды.');
        return;
      }

      const { getAdvertisements } = require('./database');
      const ads = await getAdvertisements(false);
      
      if (ads.length === 0) {
        await ctx.reply('📢 Рекламных сообщений пока нет.');
        return;
      }

      let message = `📢 <b>СПИСОК РЕКЛАМНЫХ СООБЩЕНИЙ</b>\n\n`;
      ads.slice(0, 10).forEach(ad => {
        message += `ID: ${ad.id}\n`;
        message += `📌 ${ad.title}\n`;
        message += `📊 Отправлено: ${ad.sent_count || 0}\n`;
        message += `📅 Создано: ${new Date(ad.created_at).toLocaleDateString('ru-RU')}\n`;
        message += `${ad.is_active ? '✅ Активно' : '❌ Неактивно'}\n\n`;
      });
      
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('Error in /admin_ads command:', err);
      await ctx.reply('❌ Ошибка при получении списка рекламы.');
    }
  });

  // Команда /admin_send_ad - отправить рекламу
  bot.command('admin_send_ad', async (ctx) => {
    try {
      if (!isAdmin(ctx.from.id)) {
        await ctx.reply('❌ У вас нет прав для выполнения этой команды.');
        return;
      }

      const adId = parseInt(ctx.message.text.split(' ')[1]);
      if (!adId) {
        await ctx.reply('❌ Укажите ID рекламы: /admin_send_ad 1');
        return;
      }

      await ctx.reply('⏳ Отправка рекламы начата...');

      const { getAdvertisement, getTargetUsersForAdvertisement, updateAdvertisementStatus, logAdvertisementSend } = require('./database');
      
      const ad = await getAdvertisement(adId);
      if (!ad) {
        await ctx.reply(`❌ Реклама с ID ${adId} не найдена.`);
        return;
      }

      const targetUsers = await getTargetUsersForAdvertisement(ad);
      
      if (targetUsers.length === 0) {
        await ctx.reply('❌ Нет пользователей для отправки рекламы.');
        return;
      }

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
          
          // Задержка чтобы не превысить лимиты Telegram API
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (err) {
          console.error(`Error sending ad ${adId} to user ${user.id}:`, err);
          await logAdvertisementSend(adId, user.id, 'error', err.message);
          errorCount++;
        }
      }

      await updateAdvertisementStatus(adId, sentCount, new Date().toISOString());

      await ctx.reply(
        `✅ Реклама отправлена!\n\n` +
        `📊 Отправлено: ${sentCount}\n` +
        `❌ Ошибок: ${errorCount}\n` +
        `👥 Всего: ${targetUsers.length}`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error('Error in /admin_send_ad command:', err);
      await ctx.reply('❌ Ошибка при отправке рекламы.');
    }
  });

  bot.action('show_help', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        `❄️ <b>ЗИМНИЙ ПОДЪЁМ - СПРАВКА</b> ❄️\n\n` +
        `📋 <b>Доступные команды:</b>\n` +
        `/start - Начать игру и узнать об акции\n` +
        `/stats - Посмотреть вашу статистику и прогресс\n` +
        `/help - Показать эту справку\n\n` +
        `🎯 <b>Правила игры:</b>\n` +
        `• Блок раскачивается на верёвке - следите за его движением\n` +
        `• Нажмите в нужный момент, чтобы установить блок на башню\n` +
        `• Если блок установлен успешно - получаете <b>1 бонус</b>\n` +
        `• Если блок установлен идеально (Perfect) - получаете <b>2 бонуса</b>\n` +
        `• Чем выше башня, тем сложнее попасть идеально\n` +
        `• Башня упала? Игра окончена!\n\n` +
        `💰 <b>Накопительная система бонусов:</b>\n` +
        `• Все заработанные бонусы сохраняются в вашем "банке"\n` +
        `• Бонусы накапливаются от игры к игре\n` +
        `• Максимальный лимит накопления: <b>500 бонусов</b>\n` +
        `• После достижения 500 бонусов новые не начисляются (до вывода)\n\n` +
        `🎁 <b>Как вывести бонусы:</b>\n` +
        `1️⃣ Накопите <b>500 бонусов</b> в игре\n` +
        `2️⃣ Пополните игровой баланс на <b>50% от суммы</b> (250 рублей)\n` +
        `3️⃣ Подойдите к ресепшну в клубе:\n` +
        `   • Суворова 27а\n` +
        `   • Ленина 26\n` +
        `4️⃣ Получите свои 500 бонусов!\n\n` +
        `⏰ <b>Важные правила:</b>\n` +
        `• Игра за бонусы доступна <b>только 1 раз в день</b>\n` +
        `• Обычная игра без ограничений (бонусы начисляются, но копятся до лимита 500)\n` +
        `• Прогресс сохраняется автоматически\n\n` +
        `🎮 <b>Два режима игры:</b>\n` +
        `• <b>Обычная игра</b> - тренируйтесь без ограничений (бонусы начисляются: 1 за обычный блок, 2 за perfect, копятся до лимита 500)\n` +
        `• <b>Игра за бонусы</b> - играйте раз в день и получайте бонусы в банк\n\n` +
        `❄️ <b>"Поднимайся выше - собирай больше бонусов!"</b> ❄️`,
        {
          parse_mode: 'HTML'
        }
      );
    } catch (err) {
      console.error('Error in show_help callback:', err);
      await ctx.answerCbQuery('Произошла ошибка').catch(() => {});
    }
  });

  // Проверяем, используется ли webhook
  const useWebhook = config.telegramWebhookUrl && !config.telegramWebhookUrl.includes('localhost');
  
  if (useWebhook) {
    // Используем webhook для production (webhook будет настроен в server.js)
    console.log('✅ Telegram bot configured for webhook mode');
    console.log(`🤖 Webhook URL will be set to: ${config.telegramWebhookUrl}/webhook`);
    // Не запускаем бота здесь, webhook будет настроен в server.js после запуска сервера
  } else {
    // Используем polling для разработки
    bot.launch().then(() => {
      console.log('✅ Telegram bot initialized and started successfully (polling mode)');
      console.log(`🤖 Bot is ready! Use /start command in Telegram`);
    }).catch((err) => {
      console.error('❌ Error starting bot:', err);
      console.error('Error details:', err.message);
      if (err.response) {
        console.error('Telegram API response:', err.response);
      }
    });
  }

  // Обработка ошибок бота
  bot.catch((err, ctx) => {
    console.error('❌ Bot error occurred:', err);
    console.error('Error message:', err.message);
    console.error('Error stack:', err.stack);
    if (ctx && ctx.update) {
      console.error('Update ID:', ctx.update.update_id);
      console.error('Update type:', ctx.updateType);
    }
    
    // Пытаемся ответить пользователю об ошибке (безопасно)
    try {
      if (ctx && ctx.reply) {
        ctx.reply('❌ Произошла ошибка. Попробуйте позже или используйте команду /help.').catch((replyErr) => {
          console.error('Error sending error message to user:', replyErr);
        });
      }
    } catch (replyErr) {
      console.error('Error in error handler reply:', replyErr);
    }
    
    // Не пробрасываем ошибку дальше, чтобы не упал процесс
  });

  // Graceful stop (только если бот запущен в polling режиме)
  const gracefulStop = async (signal) => {
    try {
      // Проверяем, запущен ли бот (только для polling режима)
      if (!useWebhook) {
        await bot.stop(signal);
        console.log(`Bot stopped gracefully with ${signal}`);
      } else {
        // Для webhook режима просто закрываем webhook
        console.log(`Bot webhook mode - graceful shutdown with ${signal}`);
      }
    } catch (err) {
      // Игнорируем ошибку, если бот не запущен
      if (err.message && err.message.includes('Bot is not running')) {
        console.log(`Bot not running, skipping stop (${signal})`);
      } else {
        console.error(`Error stopping bot (${signal}):`, err);
      }
    }
  };
  
  process.once('SIGINT', () => gracefulStop('SIGINT'));
  process.once('SIGTERM', () => gracefulStop('SIGTERM'));
} else {
  console.warn('Telegram bot token not provided. Bot will not work.');
}

// Экспортируем функцию проверки подписки для использования в других модулях
module.exports.checkChannelSubscription = checkChannelSubscription;

module.exports = bot;
