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
    // Падение вниз
    this.y += this.speed
    if (checkMoveDown(engine)) {
      this.y += getMoveDownValue(engine) * 0.5
    }
    
    // Вращение снежинки
    this.rotation += this.rotationSpeed
    
    // Волновое качание (более плавное)
    this.wobble += this.wobbleSpeed
    this.x = this.initialX + Math.sin(this.wobble) * this.wobbleAmplitude
    
    // Медленное горизонтальное движение (эффект ветра)
    this.initialX += Math.sin(this.wobble * 0.5) * 0.1
    
    // Перезапуск когда упала за экран
    if (this.y > engine.height + 10) {
      this.y = -10
      this.x = Math.random() * engine.width
      this.initialX = this.x
      this.size = Math.random() * 4 + 1.5
      this.speed = Math.random() * 0.8 + 0.2
      this.opacity = Math.random() * 0.6 + 0.4
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
    ctx.translate(this.x, this.y)
    ctx.rotate(this.rotation)
    
    // Более красивая снежинка с градиентом
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)')
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.6)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.2)')
    
    ctx.fillStyle = gradient
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.lineWidth = 1.5
    
    // Рисуем снежинку в виде звездочки с 6 лучами
    for (let i = 0; i < 6; i++) {
      ctx.save()
      ctx.rotate((Math.PI / 3) * i)
      
      // Основной луч
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, -this.size)
      ctx.stroke()
      
      // Боковые веточки
      ctx.beginPath()
      ctx.moveTo(0, -this.size * 0.6)
      ctx.lineTo(-this.size * 0.3, -this.size * 0.5)
      ctx.moveTo(0, -this.size * 0.6)
      ctx.lineTo(this.size * 0.3, -this.size * 0.5)
      ctx.stroke()
      
      ctx.restore()
    }
    
    // Центральный круг с градиентом
    ctx.beginPath()
    ctx.arc(0, 0, this.size * 0.2, 0, Math.PI * 2)
    ctx.fill()
    
    ctx.restore()
  }
}

// Массив снежинок
let snowflakes = []
let currentEngine = null

export const initSnow = (engine, count = 60) => {
  // Переинициализируем снег при создании новой игры
  // Увеличиваем количество снежинок для более красивого эффекта
  snowflakes = []
  currentEngine = engine
  for (let i = 0; i < count; i++) {
    snowflakes.push(new Snowflake(engine))
  }
}

export const snowAction = (instance, engine) => {
  // Инициализация если еще не созданы или двигатель изменился
  if (snowflakes.length === 0 || currentEngine !== engine) {
    initSnow(engine, 60)
  }
  
  // Обновление всех снежинок
  snowflakes.forEach(snowflake => {
    snowflake.update(engine)
  })
}

export const snowPainter = (instance, engine) => {
  // Рисование всех снежинок поверх всех элементов
  // Используем глобальный composite для рисования поверх всего
  const ctx = engine.ctx
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  snowflakes.forEach(snowflake => {
    snowflake.draw(ctx)
  })
  ctx.restore()
}

