const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Создаем директорию для базы данных, если её нет
const dbDir = path.dirname(config.databasePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(config.databasePath);

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
      function(err) {
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
    db.run(
      'INSERT INTO games (user_id, game_type, score, floors, bonuses_earned) VALUES (?, ?, ?, ?, ?)',
      [userId, gameType, score, floors, bonusesEarned],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const updateUserStats = (userId, score, bonusesEarned) => {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET total_games = total_games + 1, total_bonuses = total_bonuses + ?, best_score = MAX(best_score, ?) WHERE id = ?',
      [bonusesEarned, score, userId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

// Функции для проверки доступности игры за бонусы
const canPlayBonusGame = async (userId) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM bonus_attempts WHERE user_id = ?', [userId], async (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      if (!row) {
        resolve({ canPlay: true, nextAvailable: null });
        return;
      }

      const lastAttempt = new Date(row.last_attempt);
      const now = new Date();
      const timeDiff = now - lastAttempt;

      if (timeDiff >= config.bonusGameCooldown) {
        resolve({ canPlay: true, nextAvailable: null });
      } else {
        const nextAvailable = new Date(lastAttempt.getTime() + config.bonusGameCooldown);
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
      function(err) {
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
      GROUP BY u.id`,
      [userId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
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
  getBonusGameHistory
};

