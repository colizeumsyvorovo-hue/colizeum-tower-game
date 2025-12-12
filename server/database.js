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

  // Таблица ежедневной статистики пользователей
  db.run(`CREATE TABLE IF NOT EXISTS daily_user_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date DATE NOT NULL,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    games_played INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, date)
  )`);

  // Таблица рекламных сообщений
  db.run(`CREATE TABLE IF NOT EXISTS advertisements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME,
    sent_count INTEGER DEFAULT 0,
    target_all_users BOOLEAN DEFAULT 1,
    min_games INTEGER DEFAULT 0,
    min_bonuses INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1
  )`);

  // Таблица логов отправки рекламы
  db.run(`CREATE TABLE IF NOT EXISTS advertisement_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advertisement_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'sent',
    error_message TEXT,
    FOREIGN KEY (advertisement_id) REFERENCES advertisements(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Таблица промокодов для вывода бонусов
  db.run(`CREATE TABLE IF NOT EXISTS promo_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    bonuses_amount INTEGER NOT NULL,
    required_deposit INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    used_at DATETIME,
    used_by_admin_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
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
    // Не создаем пользователя без имени (или с placeholder именем)
    if (!telegramUser.first_name || telegramUser.first_name === 'Игрок' || telegramUser.first_name === 'Demo') {
      console.warn(`⚠️ Attempting to create user ${telegramUser.id} without valid name:`, telegramUser.first_name);
      // Все равно создаем, но логируем предупреждение
    }
    
    db.run(
      'INSERT INTO users (telegram_id, username, first_name, last_name) VALUES (?, ?, ?, ?)',
      [telegramUser.id, telegramUser.username || null, telegramUser.first_name || null, telegramUser.last_name || null],
      function (err) {
        if (err) reject(err);
        else {
          console.log(`✅ Created user ${telegramUser.id} with name: ${telegramUser.first_name || 'NULL'}`);
          resolve(this.lastID);
        }
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
  } else {
    // Обновляем username и first_name, если они изменились
    // НО НЕ перезаписываем реальное имя на "Demo" или "Игрок"
    // И обновляем имя, если текущее имя - placeholder (null, 'Игрок', 'Demo')
    const currentNameIsPlaceholder = !user.first_name || user.first_name === 'Игрок' || user.first_name === 'Demo';
    const shouldUpdateName = telegramUser.first_name && 
                             telegramUser.first_name !== 'Demo' && 
                             telegramUser.first_name !== 'Игрок' &&
                             (currentNameIsPlaceholder || telegramUser.first_name !== user.first_name);
    const shouldUpdateUsername = telegramUser.username && telegramUser.username !== user.username;
    
    if (shouldUpdateName || shouldUpdateUsername) {
      const newFirstName = shouldUpdateName ? telegramUser.first_name : user.first_name;
      const newUsername = shouldUpdateUsername ? telegramUser.username : (telegramUser.username || user.username);
      
      return new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET username = ?, first_name = ? WHERE id = ?',
          [newUsername || null, newFirstName || null, user.id],
          (err) => {
            if (err) {
              console.error('Error updating user info:', err);
              resolve(user);
            } else {
              console.log(`✅ Updated user ${user.id} info: first_name=${newFirstName}, username=${newUsername || 'null'}`);
              user.username = newUsername || user.username;
              user.first_name = newFirstName || user.first_name;
              resolve(user);
            }
          }
        );
      });
    }
  }
  
  // Записываем статистику активности (ежедневная статистика)
  if (user) {
    const today = new Date().toISOString().split('T')[0];
    // Используем INSERT OR REPLACE или проверку существования
    db.run(
      `INSERT OR IGNORE INTO daily_user_stats (user_id, date, first_seen_at, last_seen_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [user.id, today],
      (err) => {
        if (err) {
          console.error('Error recording daily user stats:', err);
        } else {
          // Обновляем last_seen_at если запись уже существует
          db.run(
            `UPDATE daily_user_stats SET last_seen_at = CURRENT_TIMESTAMP 
             WHERE user_id = ? AND date = ?`,
            [user.id, today],
            (updateErr) => {
              if (updateErr) {
                console.error('Error updating last_seen_at:', updateErr);
              }
            }
          );
        }
      }
    );
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
                
                // Обновляем ежедневную статистику игр (используем прямое обращение к БД, чтобы избежать проблем с порядком объявления)
                const today = new Date().toISOString().split('T')[0];
                db.run(
                  `UPDATE daily_user_stats 
                   SET games_played = games_played + 1 
                   WHERE user_id = ? AND date = ?`,
                  [userId, today],
                  (err) => {
                    if (err) {
                      console.error('Error updating daily games count:', err);
                    }
                  }
                );
                
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
      const timeDiff = now.getTime() - lastAttempt.getTime();
      
      // Убеждаемся, что cooldown точно 24 часа (86400000 мс)
      // ВСЕГДА используем 24 часа, независимо от конфига
      const cooldownMs = 24 * 60 * 60 * 1000; // Точно 24 часа = 86400000 мс
      
      // Проверяем, что config.bonusGameCooldown тоже 24 часа (для логирования)
      const configCooldown = config.bonusGameCooldown || cooldownMs;
      if (configCooldown !== cooldownMs) {
        console.warn(`⚠️ WARNING: config.bonusGameCooldown is not 24 hours! Config: ${configCooldown}ms, Using: ${cooldownMs}ms`);
      }
      
      console.log(`User ${userId} bonus game check:`, {
        lastAttempt: lastAttempt.toISOString(),
        now: now.toISOString(),
        timeDiff: timeDiff,
        timeDiffHours: (timeDiff / (1000 * 60 * 60)).toFixed(2),
        cooldown: cooldownMs,
        cooldownHours: (cooldownMs / (1000 * 60 * 60)).toFixed(2),
        canPlay: timeDiff >= cooldownMs
      });

      // Проверяем, прошло ли 24 часа с последней попытки
      if (timeDiff >= cooldownMs) {
        console.log(`User ${userId} can play - 24 hours passed`);
        resolve({ canPlay: true, nextAvailable: null });
      } else {
        const nextAvailable = new Date(lastAttempt.getTime() + cooldownMs);
        const timeLeftMs = cooldownMs - timeDiff;
        const hoursLeft = Math.floor(timeLeftMs / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));
        const totalHoursLeft = (timeLeftMs / (1000 * 60 * 60)).toFixed(2);
        console.log(`User ${userId} cannot play - ${hoursLeft}h ${minutesLeft}m left (total: ${totalHoursLeft} hours, cooldown: ${cooldownMs}ms = ${(cooldownMs / (1000 * 60 * 60)).toFixed(2)} hours)`);
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

// Генерация уникального промокода
const generatePromoCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Исключаем похожие символы (0, O, I, 1)
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Создание промокода для вывода бонусов
const createPromoCode = (userId, bonusesAmount) => {
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
        
        // Генерируем уникальный промокод
        let code = generatePromoCode();
        let attempts = 0;
        const maxAttempts = 10;
        
        const tryInsert = () => {
          // Рассчитываем требуемую сумму пополнения (50% от суммы бонусов)
          const requiredAmount = Math.round(bonusesAmount * 0.5);
          
          // Срок действия промокода - 7 дней
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 7);
          
          db.run(
            `INSERT INTO promo_codes (code, user_id, bonuses_amount, required_deposit, expires_at) 
             VALUES (?, ?, ?, ?, ?)`,
            [code, userId, bonusesAmount, requiredAmount, expiresAt.toISOString()],
            function(insertErr) {
              if (insertErr) {
                if (insertErr.code === 'SQLITE_CONSTRAINT' && attempts < maxAttempts) {
                  // Промокод уже существует, генерируем новый
                  code = generatePromoCode();
                  attempts++;
                  tryInsert();
                } else {
                  reject(insertErr);
                }
              } else {
                console.log(`✅ Promo code created: ${code} for user ${userId}, bonuses: ${bonusesAmount}, deposit: ${requiredAmount}`);
                resolve({
                  code: code,
                  bonusesAmount: bonusesAmount,
                  requiredDeposit: requiredAmount,
                  expiresAt: expiresAt.toISOString()
                });
              }
            }
          );
        };
        
        tryInsert();
      });
    });
  });
};

// Получить промокод по коду
const getPromoCode = (code) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT pc.*, u.telegram_id, u.first_name, u.username 
       FROM promo_codes pc 
       JOIN users u ON pc.user_id = u.id 
       WHERE pc.code = ?`,
      [code.toUpperCase()],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

// Активировать промокод (использовать)
const activatePromoCode = (code, adminId) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get('SELECT * FROM promo_codes WHERE code = ?', [code.toUpperCase()], (err, promo) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (!promo) {
          reject(new Error('Promo code not found'));
          return;
        }
        
        if (promo.status === 'used') {
          reject(new Error('Promo code already used'));
          return;
        }
        
        if (promo.status === 'expired') {
          reject(new Error('Promo code expired'));
          return;
        }
        
        const expiresAt = new Date(promo.expires_at);
        if (expiresAt < new Date()) {
          // Промокод истек
          db.run(
            'UPDATE promo_codes SET status = ? WHERE code = ?',
            ['expired', code.toUpperCase()],
            () => {}
          );
          reject(new Error('Promo code expired'));
          return;
        }
        
        // Обнуляем бонусы пользователя
        db.run(
          'UPDATE users SET total_bonuses = 0 WHERE id = ?',
          [promo.user_id],
          (updateErr) => {
            if (updateErr) {
              reject(updateErr);
              return;
            }
            
            // Помечаем промокод как использованный
            db.run(
              'UPDATE promo_codes SET status = ?, used_at = CURRENT_TIMESTAMP, used_by_admin_id = ? WHERE code = ?',
              ['used', adminId || null, code.toUpperCase()],
              (markErr) => {
                if (markErr) {
                  reject(markErr);
                  return;
                }
                
                console.log(`✅ Promo code ${code} activated by admin ${adminId || 'unknown'}`);
                resolve({
                  code: promo.code,
                  bonusesAmount: promo.bonuses_amount,
                  requiredDeposit: promo.required_deposit,
                  userId: promo.user_id
                });
              }
            );
          }
        );
      });
    });
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

// Функции для работы со статистикой
const getDailyStats = (date = null) => {
  return new Promise((resolve, reject) => {
    const targetDate = date || new Date().toISOString().split('T')[0];
    db.all(
      `SELECT 
        dus.user_id,
        u.telegram_id,
        u.username,
        u.first_name,
        dus.first_seen_at,
        dus.last_seen_at,
        dus.games_played
      FROM daily_user_stats dus
      INNER JOIN users u ON dus.user_id = u.id
      WHERE dus.date = ?
      ORDER BY dus.first_seen_at ASC`,
      [targetDate],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const getDailyStatsSummary = (date = null) => {
  return new Promise((resolve, reject) => {
    const targetDate = date || new Date().toISOString().split('T')[0];
    db.get(
      `SELECT 
        COUNT(DISTINCT user_id) as total_users,
        SUM(games_played) as total_games,
        COUNT(DISTINCT CASE WHEN games_played > 0 THEN user_id END) as active_users
      FROM daily_user_stats
      WHERE date = ?`,
      [targetDate],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || { total_users: 0, total_games: 0, active_users: 0 });
      }
    );
  });
};

// Функция для получения общей статистики за все время
const getAllTimeStats = () => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 
        COUNT(DISTINCT u.id) as total_users,
        SUM(u.total_games) as total_games,
        SUM(u.total_bonuses) as total_bonuses,
        MAX(u.best_score) as best_score,
        COUNT(DISTINCT CASE WHEN u.total_games > 0 THEN u.id END) as active_users,
        COUNT(DISTINCT CASE WHEN u.created_at >= date('now', '-7 days') THEN u.id END) as new_users_7d,
        COUNT(DISTINCT CASE WHEN u.created_at >= date('now', '-30 days') THEN u.id END) as new_users_30d
      FROM users u`,
      [],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || {
          total_users: 0,
          total_games: 0,
          total_bonuses: 0,
          best_score: 0,
          active_users: 0,
          new_users_7d: 0,
          new_users_30d: 0
        });
      }
    );
  });
};

// Функция для получения списка всех пользователей с деталями
const getAllUsersWithStats = (limit = 100, offset = 0) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
        u.id,
        u.telegram_id,
        u.username,
        u.first_name,
        u.created_at,
        u.total_games,
        u.total_bonuses,
        u.best_score,
        (SELECT COUNT(*) FROM games WHERE user_id = u.id) as games_count
      FROM users u
      ORDER BY u.total_games DESC, u.best_score DESC
      LIMIT ? OFFSET ?`,
      [limit, offset],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const updateDailyGamesCount = (userId, date = null) => {
  return new Promise((resolve, reject) => {
    const targetDate = date || new Date().toISOString().split('T')[0];
    db.run(
      `UPDATE daily_user_stats 
       SET games_played = games_played + 1 
       WHERE user_id = ? AND date = ?`,
      [userId, targetDate],
      function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
};

// Функции для работы с рекламой
const createAdvertisement = (title, message, options = {}) => {
  return new Promise((resolve, reject) => {
    const {
      targetAllUsers = true,
      minGames = 0,
      minBonuses = 0,
      isActive = true
    } = options;

    db.run(
      `INSERT INTO advertisements 
       (title, message, target_all_users, min_games, min_bonuses, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, message, targetAllUsers ? 1 : 0, minGames, minBonuses, isActive ? 1 : 0],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getAdvertisements = (activeOnly = false) => {
  return new Promise((resolve, reject) => {
    let query = 'SELECT * FROM advertisements';
    const params = [];
    
    if (activeOnly) {
      query += ' WHERE is_active = 1';
    }
    
    query += ' ORDER BY created_at DESC';
    
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getAdvertisement = (adId) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM advertisements WHERE id = ?', [adId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const updateAdvertisementStatus = (adId, sentCount, sentAt) => {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE advertisements SET sent_count = ?, sent_at = ? WHERE id = ?',
      [sentCount, sentAt, adId],
      function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
};

const logAdvertisementSend = (adId, userId, status = 'sent', errorMessage = null) => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO advertisement_logs (advertisement_id, user_id, status, error_message) VALUES (?, ?, ?, ?)',
      [adId, userId, status, errorMessage],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getTargetUsersForAdvertisement = (ad) => {
  return new Promise((resolve, reject) => {
    let query = 'SELECT DISTINCT u.id, u.telegram_id, u.username, u.first_name FROM users u';
    const params = [];
    const conditions = [];

    if (ad.target_all_users === 0 || !ad.target_all_users) {
      // Фильтруем по критериям
      if (ad.min_games > 0) {
        conditions.push('u.total_games >= ?');
        params.push(ad.min_games);
      }
      if (ad.min_bonuses > 0) {
        conditions.push('u.total_bonuses >= ?');
        params.push(ad.min_bonuses);
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

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
  exchangeBonuses,
  createPromoCode,
  getPromoCode,
  activatePromoCode,
  getDailyStats,
  getDailyStatsSummary,
  updateDailyGamesCount,
  getAllTimeStats,
  getAllUsersWithStats,
  createAdvertisement,
  getAdvertisements,
  getAdvertisement,
  updateAdvertisementStatus,
  logAdvertisementSend,
  getTargetUsersForAdvertisement
};

