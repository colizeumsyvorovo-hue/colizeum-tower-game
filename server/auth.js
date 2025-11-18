const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('./config');

// Генерация токена для пользователя
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      telegramId: user.telegram_id,
      username: user.username
    },
    config.jwtSecret,
    { expiresIn: '30d' }
  );
};

// Верификация токена
const verifyToken = (token) => {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (err) {
    return null;
  }
};

// Генерация хеша для Telegram Web App авторизации
const generateTelegramHash = (initData) => {
  const botToken = config.telegramBotToken;
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  
  const hash = crypto
    .createHmac('sha256', secretKey)
    .update(initData)
    .digest('hex');
  
  return hash;
};

// Проверка данных от Telegram Web App
const validateTelegramWebApp = (initData) => {
  try {
    // Если нет токена бота, пропускаем валидацию (для разработки)
    if (!config.telegramBotToken) {
      console.warn('Telegram bot token not set, skipping validation');
      return true;
    }

    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return false;
    
    urlParams.delete('hash');
    
    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    
    const calculatedHash = generateTelegramHash(dataCheckString);
    return calculatedHash === hash;
  } catch (err) {
    console.error('Telegram validation error:', err);
    return false;
  }
};

// Middleware для проверки авторизации
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || 
                  req.query.token || 
                  req.body.token;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

module.exports = {
  generateToken,
  verifyToken,
  validateTelegramWebApp,
  authMiddleware
};

