const { db } = require('./database');
const config = require('./config');

// Функция для отправки уведомлений о доступности игры за бонусы
async function sendBonusGameAvailableNotifications() {
    try {
        console.log('🔔 Проверка игроков для отправки уведомлений о доступности игры за бонусы...');

        // Получаем всех пользователей, у которых таймер закончился (прошло 24 часа)
        const now = new Date();
        // Проверяем пользователей, у которых last_attempt был ровно 24 часа назад (с допуском ±10 минут)
        const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
        const tenMinutesLater = new Date(now.getTime() + 10 * 60 * 1000);

        // Находим пользователей, у которых таймер закончился (прошло 24 часа с последней попытки)
        const cooldownSeconds = config.bonusGameCooldown / 1000;
        const query = `
      SELECT 
        ba.user_id,
        ba.last_attempt,
        u.telegram_id,
        u.first_name,
        u.username
      FROM bonus_attempts ba
      INNER JOIN users u ON ba.user_id = u.id
      WHERE ba.last_attempt IS NOT NULL
      AND datetime(ba.last_attempt, '+' || ${cooldownSeconds} || ' seconds') 
          BETWEEN datetime(?, 'unixepoch') AND datetime(?, 'unixepoch')
    `;

        return new Promise((resolve, reject) => {
            db.all(
                query,
                [Math.floor(tenMinutesAgo.getTime() / 1000), Math.floor(tenMinutesLater.getTime() / 1000)],
                async (err, rows) => {
                    if (err) {
                        console.error('❌ Ошибка при поиске пользователей для уведомлений:', err);
                        reject(err);
                        return;
                    }

                    if (!rows || rows.length === 0) {
                        console.log('✅ Нет пользователей для отправки уведомлений');
                        resolve([]);
                        return;
                    }

                    console.log(`📧 Найдено ${rows.length} пользователей для уведомлений`);

                    // Проверяем каждого пользователя и отправляем уведомление, если игра доступна
                    const bot = require('./telegram');
                    if (!bot) {
                        console.warn('⚠️ Telegram бот не инициализирован, уведомления не будут отправлены');
                        resolve([]);
                        return;
                    }

                    const { canPlayBonusGame } = require('./database');
                    const sentNotifications = [];

                    for (const row of rows) {
                        try {
                            const bonusInfo = await canPlayBonusGame(row.user_id);

                            // Отправляем уведомление только если игра стала доступна (прошло 24 часа)
                            if (bonusInfo.canPlay) {
                                const userName = row.first_name || row.username || 'Игрок';

                                await bot.telegram.sendMessage(
                                    row.telegram_id,
                                    `❄️ <b>ЗИМНИЙ ПОДЪЁМ - ИГРА ДОСТУПНА!</b> ❄️\n\n` +
                                    `🎯 <b>"Поднимайся выше - собирай больше бонусов!"</b>\n\n` +
                                    `🎉 <b>${userName}, игра за бонусы снова доступна!</b>\n\n` +
                                    `🎮 Продолжайте играть и зарабатывать бонусы!\n\n` +
                                    `💰 Напоминание:\n` +
                                    `• За обычный блок: 1 бонус\n` +
                                    `• За идеальный блок (Perfect): 2 бонуса\n` +
                                    `• Максимальный лимит: 500 бонусов\n\n` +
                                    `🚀 Нажмите на кнопку ниже, чтобы начать игру:`,
                                    {
                                        parse_mode: 'HTML',
                                        reply_markup: {
                                            inline_keyboard: [[
                                                {
                                                    text: '🎮 Начать игру за бонусы',
                                                    web_app: {
                                                        url: `${config.frontendUrl}?tgWebAppStartParam=${row.telegram_id}`
                                                    }
                                                }
                                            ]]
                                        }
                                    }
                                );

                                sentNotifications.push(row.user_id);
                                console.log(`✅ Уведомление отправлено пользователю ${row.user_id} (${userName})`);
                            }
                        } catch (userErr) {
                            console.error(`❌ Ошибка при отправке уведомления пользователю ${row.user_id}:`, userErr);
                        }
                    }

                    console.log(`✅ Отправлено ${sentNotifications.length} уведомлений из ${rows.length} проверенных пользователей`);
                    resolve(sentNotifications);
                }
            );
        });
    } catch (err) {
        console.error('❌ Ошибка в sendBonusGameAvailableNotifications:', err);
        throw err;
    }
}

module.exports = {
    sendBonusGameAvailableNotifications
};

