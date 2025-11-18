const { Telegraf } = require('telegraf');
const config = require('./config');
const { getOrCreateUser } = require('./database');
const { generateToken } = require('./auth');

let bot = null;

if (config.telegramBotToken) {
  bot = new Telegraf(config.telegramBotToken);

  // Команда /start
  bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id;
    const user = ctx.from;

    try {
      await getOrCreateUser(user);
      
      const gameUrl = `${config.frontendUrl}?tgWebAppStartParam=${user.id}`;
      
      // Проверяем, является ли URL localhost (для разработки)
      const isLocalhost = config.frontendUrl.includes('localhost') || config.frontendUrl.includes('127.0.0.1');
      
      if (isLocalhost) {
        // Для localhost просто отправляем текст со ссылкой (без кнопки)
        await ctx.reply(
          `🎮 Добро пожаловать в Colizeum Tower Game! 🎄\n\n` +
          `🎁 Играй каждый день и получай бонусы!\n\n` +
          `📊 У тебя есть два режима:\n` +
          `• Обычная игра - без ограничений\n` +
          `• Игра за бонусы - раз в сутки\n\n` +
          `🔗 Откройте ссылку в браузере для игры:\n` +
          `<a href="${gameUrl}">${gameUrl}</a>\n\n` +
          `💡 Для production версии будет доступна кнопка Web App!`,
          {
            parse_mode: 'HTML',
            disable_web_page_preview: true
          }
        );
      } else {
        // Для production используем Web App кнопку
        await ctx.reply(
          `🎮 Добро пожаловать в Colizeum Tower Game! 🎄\n\n` +
          `🎁 Играй каждый день и получай бонусы!\n\n` +
          `📊 У тебя есть два режима:\n` +
          `• Обычная игра - без ограничений\n` +
          `• Игра за бонусы - раз в сутки\n\n` +
          `Нажмите на кнопку ниже, чтобы начать:`,
          {
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🎮 Начать игру',
                  web_app: { url: gameUrl }
                }
              ]]
            }
          }
        );
      }
    } catch (err) {
      console.error('Error in /start command:', err);
      await ctx.reply('Произошла ошибка. Попробуйте позже.');
    }
  });

  // Команда /stats
  bot.command('stats', async (ctx) => {
    const chatId = ctx.chat.id;
    const user = ctx.from;

    try {
      const dbUser = await getOrCreateUser(user);
      const { getUserStats } = require('./database');
      const stats = await getUserStats(dbUser.id);

      await ctx.reply(
        `📊 Ваша статистика:\n\n` +
        `🎮 Всего игр: ${stats.games_count || 0}\n` +
        `🎁 Игр за бонусы: ${stats.bonus_games_count || 0}\n` +
        `⭐ Лучший результат: ${stats.best_score || 0} очков\n` +
        `💰 Всего бонусов: ${stats.total_bonuses || 0}\n\n` +
        `Используйте /start для начала игры!`
      );
    } catch (err) {
      console.error('Error in /stats command:', err);
      await ctx.reply('Произошла ошибка при получении статистики.');
    }
  });

  // Команда /help
  bot.command('help', async (ctx) => {
    await ctx.reply(
      `🎮 Colizeum Tower Game - Помощь\n\n` +
      `📋 Команды:\n` +
      `/start - Начать игру\n` +
      `/stats - Ваша статистика\n` +
      `/help - Показать эту справку\n\n` +
      `🎯 Правила игры:\n` +
      `• Стройте башню, нажимая в нужный момент\n` +
      `• За каждую успешную установку блока - 25 очков\n` +
      `• За идеальную установку - 50+ очков\n` +
      `• Игра за бонусы доступна раз в сутки\n\n` +
      `🎁 Бонусы начисляются в зависимости от результата!`
    );
  });

  // Проверяем, используется ли webhook
  const useWebhook = config.telegramWebhookUrl && !config.telegramWebhookUrl.includes('localhost');
  
  if (useWebhook) {
    // Используем webhook для production
    console.log('✅ Telegram bot configured for webhook mode');
    console.log(`🤖 Webhook URL: ${config.telegramWebhookUrl}`);
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
    console.error('Bot error occurred:', err);
    console.error('Update:', ctx.update);
  });

  // Graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
  console.warn('Telegram bot token not provided. Bot will not work.');
}

module.exports = bot;
