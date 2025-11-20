import { checkMoveDown, getMoveDownValue } from './utils'

// Класс снежинки с улучшенной графикой
class Snowflake {
  constructor(engine) {
    this.x = Math.random() * engine.width
    this.y = Math.random() * engine.height
    this.size = Math.random() * 4 + 1.5 // Размер от 1.5 до 5.5
    this.speed = Math.random() * 0.8 + 0.2 // Скорость падения от 0.2 до 1.0
    this.wobble = Math.random() * Math.PI * 2 // Начальная фаза качания
    this.wobbleSpeed = Math.random() * 0.03 + 0.01 // Скорость качания
    this.wobbleAmplitude = Math.random() * 1.5 + 0.5 // Амплитуда качания
    this.opacity = Math.random() * 0.6 + 0.4 // Прозрачность от 0.4 до 1.0
    this.rotation = Math.random() * Math.PI * 2 // Вращение снежинки
    this.rotationSpeed = (Math.random() - 0.5) * 0.05 // Скорость вращения
    this.initialX = this.x // Начальная позиция X для волнового движения
  }

  update(engine) {
    // Плавное падение вниз (как в реальной жизни - медленнее и естественнее)
    const fallSpeed = this.speed * (0.8 + Math.sin(this.wobble * 2) * 0.2) // Легкие колебания скорости
    this.y += fallSpeed
    if (checkMoveDown(engine)) {
      this.y += getMoveDownValue(engine) * 0.3 // Меньше влияние движения камеры для плавности
    }
    
    // Плавное вращение снежинки (медленнее)
    this.rotation += this.rotationSpeed * 0.7
    
    // Волновое качание (более плавное и естественное, как в реальной жизни)
    this.wobble += this.wobbleSpeed * 0.8
    // Более плавное горизонтальное движение с легким ветром
    const windEffect = Math.sin(this.wobble * 0.7) * 0.15 + Math.cos(this.wobble * 0.5) * 0.1
    this.x = this.initialX + Math.sin(this.wobble) * this.wobbleAmplitude + windEffect
    
    // Очень медленное горизонтальное движение (эффект легкого ветра)
    this.initialX += Math.sin(this.wobble * 0.3) * 0.05 + Math.cos(this.y * 0.01) * 0.02
    
    // Перезапуск когда упала за экран
    if (this.y > engine.height + 10) {
      this.y = -10
      this.x = Math.random() * engine.width
      this.initialX = this.x
      this.size = Math.random() * 4 + 1.5
      this.speed = Math.random() * 0.6 + 0.15 // Медленнее для более реалистичного вида
      this.opacity = Math.random() * 0.5 + 0.5 // Более видимые снежинки
    }
    
    // Возврат на другую сторону если вышла за границы по X
    if (this.initialX > engine.width + 50) {
      this.initialX = -50
    } else if (this.initialX < -50) {
      this.initialX = engine.width + 50
    }
  }

  draw(ctx) {
    ctx.save()
    ctx.globalAlpha = this.opacity
    
    // Оптимизация для мобильных: для маленьких снежинок используем простой круг без трансформаций
    if (this.size < 2) {
      // Простейшая отрисовка для маленьких снежинок (быстрее на мобильных)
      ctx.fillStyle = 'rgba(255, 255, 255, ' + this.opacity + ')'
      ctx.beginPath()
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      return
    }
    
    // Для больших снежинок используем трансформации
    ctx.translate(this.x, this.y)
    ctx.rotate(this.rotation)
    
    // Упрощенный градиент для производительности
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size * 1.2)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)')
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.1)')
    
    // Для средних снежинок - простой круг с градиентом
    if (this.size < 3) {
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(0, 0, this.size, 0, Math.PI * 2)
      ctx.fill()
    } else {
      // Для больших снежинок - упрощенная звездочка (меньше деталей для производительности)
      ctx.fillStyle = gradient
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
      ctx.lineWidth = 1
      
      // Упрощенная звездочка - только основные лучи без боковых веточек
      for (let i = 0; i < 6; i++) {
        ctx.save()
        ctx.rotate((Math.PI / 3) * i)
        
        // Только основной луч (без боковых веточек для производительности)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, -this.size)
        ctx.stroke()
        
        ctx.restore()
      }
      
      // Центральный круг
      ctx.beginPath()
      ctx.arc(0, 0, this.size * 0.15, 0, Math.PI * 2)
      ctx.fill()
    }
    
    ctx.restore()
  }
}

// Массив снежинок
let snowflakes = []
let currentEngine = null

export const initSnow = (engine, count = null) => {
  // Переинициализируем снег при создании новой игры
  // Автоматически определяем оптимальное количество снежинок в зависимости от размера экрана
  // Для мобильных устройств - меньше снежинок для производительности
  if (count === null) {
    // Определяем количество снежинок на основе размера экрана
    const screenArea = engine.width * engine.height
    const isMobile = engine.width < 500 || engine.height < 800 // Примерно для мобильных
    count = isMobile ? 40 : 60 // Меньше снежинок на мобильных
  }
  
  snowflakes = []
  currentEngine = engine
  for (let i = 0; i < count; i++) {
    snowflakes.push(new Snowflake(engine))
  }
}

export const snowAction = (instance, engine) => {
  // Инициализация если еще не созданы или двигатель изменился
  if (snowflakes.length === 0 || currentEngine !== engine) {
    initSnow(engine) // Автоматически определит оптимальное количество
  }
  
  // Оптимизация: обновляем снежинки только если игра запущена
  const gameStartNow = engine.getVariable('GAME_START_NOW')
  if (!gameStartNow) return
  
  // Обновление всех снежинок (более плавно, как в реальной жизни)
  snowflakes.forEach(snowflake => {
    snowflake.update(engine)
  })
}

export const snowPainter = (instance, engine) => {
  // Оптимизация: рисуем снежинки только если игра запущена
  const gameStartNow = engine.getVariable('GAME_START_NOW')
  if (!gameStartNow || snowflakes.length === 0) return
  
  // Рисование всех снежинок поверх всех элементов
  // Используем глобальный composite для рисования поверх всего
  const ctx = engine.ctx
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  
  // Оптимизация: группируем операции рисования
  snowflakes.forEach(snowflake => {
    snowflake.draw(ctx)
  })
  
  ctx.restore()
}

