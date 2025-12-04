const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Создаем директорию для базы данных, если её нет
const dbDir = path.dirname(config.databasePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`📁 Создана директория для базы данных: ${dbDir}`);
}

// Используем абсолютный путь для базы данных
const absoluteDbPath = path.isAbsolute(config.databasePath) 
  ? config.databasePath 
  : path.join(__dirname, '..', config.databasePath);

console.log(`💾 Путь к базе данных: ${absoluteDbPath}`);

const db = new sqlite3.Database(absoluteDbPath, (err) => {
  if (err) {
    console.error(`❌ Ошибка при открытии базы данных:`, err);
  } else {
    console.log(`✅ База данных успешно подключена: ${absoluteDbPath}`);
    
    // Проверяем, что база данных доступна для записи
    db.run('PRAGMA journal_mode = WAL;', (err) => {
      if (err) {
        console.warn(`⚠️ Не удалось установить WAL режим:`, err);
      } else {
        console.log(`✅ Режим WAL включен для лучшей производительности`);
      }
    });
  }
});

// Инициализация базы данных
db.serialize(() => {
  // Таблица пользователей
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_bonuses INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0,
    best_score INTEGER DEFAULT 0
  )`);

  // Таблица игр
  db.run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game_type TEXT NOT NULL,
    score INTEGER NOT NULL,
    floors INTEGER NOT NULL,
    played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    bonuses_earned INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Таблица попыток игры за бонусы
  db.run(`CREATE TABLE IF NOT EXISTS bonus_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    last_attempt DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id)
  )`);

  console.log('Database initialized');
});

// Функции для работы с пользователями
const getUserByTelegramId = (telegramId) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const createUser = (telegramUser) => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO users (telegram_id, username, first_name, last_name) VALUES (?, ?, ?, ?)',
      [telegramUser.id, telegramUser.username || null, telegramUser.first_name || null, telegramUser.last_name || null],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getOrCreateUser = async (telegramUser) => {
  let user = await getUserByTelegramId(telegramUser.id);
  if (!user) {
    try {
      await createUser(telegramUser);
      user = await getUserByTelegramId(telegramUser.id);
    } catch (err) {
      // Если пользователь уже существует (race condition), просто получаем его
      if (err.code === 'SQLITE_CONSTRAINT') {
        user = await getUserByTelegramId(telegramUser.id);
      } else {
        throw err;
      }
    }
  }
  return user;
};

// Функции для работы с играми
const saveGame = (userId, gameType, score, floors, bonusesEarned = 0) => {
  return new Promise((resolve, reject) => {
    console.log(`💾 Сохранение игры в базу данных:`, {
      userId,
      gameType,
      score,
      floors,
      bonusesEarned
    });

    db.run(
      'INSERT INTO games (user_id, game_type, score, floors, bonuses_earned) VALUES (?, ?, ?, ?, ?)',
      [userId, gameType, score, floors, bonusesEarned],
      function (err) {
        if (err) {
          console.error(`❌ Ошибка при сохранении игры для пользователя ${userId}:`, err);
          reject(err);
          return;
        }

        const gameId = this.lastID;
        console.log(`✅ Игра сохранена в базу данных с ID: ${gameId} для пользователя ${userId}`);

        // Проверяем, что игра действительно сохранилась
        db.get(
          'SELECT * FROM games WHERE id = ?',
          [gameId],
          (err, row) => {
            if (err) {
              console.error(`❌ Ошибка при проверке сохраненной игры ${gameId}:`, err);
              // Не отклоняем промис, так как игра уже сохранена
            } else if (!row) {
              console.error(`⚠️ Игра ${gameId} не найдена после сохранения!`);
            } else {
              console.log(`✅ Подтверждено: игра ${gameId} успешно сохранена в базу данных`);
            }
          }
        );

        resolve(gameId);
      }
    );
  });
};

const updateUserStats = (userId, score, bonusesEarned) => {
  return new Promise((resolve, reject) => {
    // Сначала получаем текущие данные
    db.get(
      'SELECT total_bonuses, total_games, best_score FROM users WHERE id = ?',
      [userId],
      (err, currentRow) => {
        if (err) {
          console.error(`❌ Ошибка при получении текущей статистики для пользователя ${userId}:`, err);
          reject(err);
          return;
        }

        if (!currentRow) {
          console.error(`❌ Пользователь ${userId} не найден в базе данных`);
          reject(new Error(`User ${userId} not found`));
          return;
        }

        const oldBonuses = currentRow.total_bonuses || 0;
        const oldGames = currentRow.total_games || 0;
        const oldBestScore = currentRow.best_score || 0;
        const newBonuses = oldBonuses + bonusesEarned;
        const newGames = oldGames + 1;
        const newBestScore = Math.max(oldBestScore, score);

        console.log(`📝 Обновление статистики для пользователя ${userId}:`, {
          oldBonuses,
          bonusesEarned,
          newBonuses,
          oldGames,
          newGames,
          oldBestScore,
          score,
          newBestScore
        });

        // Обновляем статистику пользователя
        db.run(
          'UPDATE users SET total_games = ?, total_bonuses = ?, best_score = ? WHERE id = ?',
          [newGames, newBonuses, newBestScore, userId],
          function (err) {
            if (err) {
              console.error(`❌ Ошибка при обновлении статистики для пользователя ${userId}:`, err);
              reject(err);
              return;
            }

            if (this.changes === 0) {
              console.error(`⚠️ Не удалось обновить статистику - строк не изменено для пользователя ${userId}`);
              reject(new Error(`No rows updated for user ${userId}`));
              return;
            }

            // Получаем обновленные данные для подтверждения
            db.get(
              'SELECT total_bonuses, total_games, best_score FROM users WHERE id = ?',
              [userId],
              (err, updatedRow) => {
                if (err) {
                  console.error(`❌ Ошибка при проверке обновленной статистики для пользователя ${userId}:`, err);
                  reject(err);
                  return;
                }

                // Проверяем, что данные обновились правильно
                if (updatedRow.total_bonuses !== newBonuses) {
                  console.error(`⚠️ Несоответствие бонусов! Ожидалось: ${newBonuses}, получено: ${updatedRow.total_bonuses}`);
                }
                if (updatedRow.total_games !== newGames) {
                  console.error(`⚠️ Несоответствие игр! Ожидалось: ${newGames}, получено: ${updatedRow.total_games}`);
                }
                if (updatedRow.best_score !== newBestScore) {
                  console.error(`⚠️ Несоответствие лучшего счета! Ожидалось: ${newBestScore}, получено: ${updatedRow.best_score}`);
                }

                console.log(`✅ Статистика успешно обновлена для пользователя ${userId}:`, updatedRow);
                resolve(updatedRow);
              }
            );
          }
        );
      }
    );
  });
};

// Функция обмена бонусов (нужно пополнить счет на 50% от суммы бонусов)
const exchangeBonuses = (userId, bonusesAmount) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get('SELECT total_bonuses FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (!user) {
          reject(new Error('User not found'));
          return;
        }
        
        const currentBonuses = user.total_bonuses || 0;
        
        if (currentBonuses < bonusesAmount) {
          reject(new Error('Not enough bonuses'));
          return;
        }
        
        // Обнуляем бонусы
        db.run(
          'UPDATE users SET total_bonuses = 0 WHERE id = ?',
          [userId],
          function(updateErr) {
            if (updateErr) {
              reject(updateErr);
              return;
            }
            
            // Рассчитываем требуемую сумму пополнения (50% от суммы бонусов)
            const requiredAmount = Math.round(bonusesAmount * 0.5);
            
            resolve({
              bonusesExchanged: bonusesAmount,
              requiredDeposit: requiredAmount,
              remainingBonuses: 0
            });
          }
        );
      });
    });
  });
};

// Функции для проверки доступности игры за бонусы
const canPlayBonusGame = async (userId) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM bonus_attempts WHERE user_id = ?', [userId], async (err, row) => {
      if (err) {
        console.error('Error checking bonus game availability:', err);
        reject(err);
        return;
      }

      if (!row) {
        console.log(`User ${userId} has no bonus attempts - can play`);
        resolve({ canPlay: true, nextAvailable: null });
        return;
      }

      const lastAttempt = new Date(row.last_attempt);
      const now = new Date();
      const timeDiff = now - lastAttempt;
      
      console.log(`User ${userId} bonus game check:`, {
        lastAttempt: lastAttempt.toISOString(),
        now: now.toISOString(),
        timeDiff: timeDiff,
        cooldown: config.bonusGameCooldown,
        canPlay: timeDiff >= config.bonusGameCooldown
      });

      // Проверяем, прошло ли 24 часа с последней попытки
      if (timeDiff >= config.bonusGameCooldown) {
        console.log(`User ${userId} can play - 24 hours passed`);
        resolve({ canPlay: true, nextAvailable: null });
      } else {
        const nextAvailable = new Date(lastAttempt.getTime() + config.bonusGameCooldown);
        const hoursLeft = Math.floor((config.bonusGameCooldown - timeDiff) / (1000 * 60 * 60));
        const minutesLeft = Math.floor(((config.bonusGameCooldown - timeDiff) % (1000 * 60 * 60)) / (1000 * 60));
        console.log(`User ${userId} cannot play - ${hoursLeft}h ${minutesLeft}m left`);
        resolve({ canPlay: false, nextAvailable });
      }
    });
  });
};

const recordBonusAttempt = (userId) => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO bonus_attempts (user_id, last_attempt) VALUES (?, CURRENT_TIMESTAMP)',
      [userId],
      function (err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

// Получить статистику пользователя
const getUserStats = (userId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 
        u.total_bonuses,
        u.total_games,
        u.best_score,
        COUNT(g.id) as games_count,
        SUM(CASE WHEN g.game_type = 'bonus' THEN 1 ELSE 0 END) as bonus_games_count
      FROM users u
      LEFT JOIN games g ON u.id = g.user_id
      WHERE u.id = ?
      GROUP BY u.id, u.total_bonuses, u.total_games, u.best_score`,
      [userId],
      (err, row) => {
        if (err) {
          console.error(`❌ Ошибка при получении статистики для пользователя ${userId}:`, err);
          reject(err);
          return;
        }
        
        if (!row) {
          console.warn(`⚠️ Пользователь ${userId} не найден при получении статистики`);
          resolve(null);
          return;
        }
        
        console.log(`📊 Статистика пользователя ${userId}:`, row);
        resolve(row);
      }
    );
  });
};

// Получить мировой топ игроков
const getLeaderboard = (limit = 10) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
        u.id,
        u.telegram_id,
        u.username,
        u.first_name,
        u.best_score,
        u.total_bonuses,
        u.total_games,
        COUNT(g.id) as games_count
      FROM users u
      LEFT JOIN games g ON u.id = g.user_id
      WHERE u.best_score > 0
      GROUP BY u.id
      ORDER BY u.best_score DESC, u.total_bonuses DESC
      LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

// Получить позицию пользователя в топе
const getUserRank = (userId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) + 1 as rank
      FROM users u
      WHERE u.best_score > (
        SELECT best_score FROM users WHERE id = ?
      ) OR (u.best_score = (SELECT best_score FROM users WHERE id = ?) 
           AND u.total_bonuses > (SELECT total_bonuses FROM users WHERE id = ?))`,
      [userId, userId, userId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.rank : null);
      }
    );
  });
};

// Получить историю игр за бонусы для пользователя
function getBonusGameHistory(userId, limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, score, floors, bonuses_earned, played_at 
       FROM games 
       WHERE user_id = ? AND game_type = 'bonus' 
       ORDER BY played_at DESC 
       LIMIT ?`,
      [userId, limit],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    );
  });
}

module.exports = {
  db,
  getUserByTelegramId,
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
};

