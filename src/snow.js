import { checkMoveDown, getMoveDownValue } from './utils'

// Класс снежинки
class Snowflake {
  constructor(engine) {
    this.x = Math.random() * engine.width
    this.y = Math.random() * engine.height
    this.size = Math.random() * 3 + 1 // Размер от 1 до 4
    this.speed = Math.random() * 0.5 + 0.3 // Скорость падения
    this.wobble = Math.random() * 2 - 1 // Качание влево-вправо
    this.wobbleSpeed = Math.random() * 0.02 + 0.01
    this.opacity = Math.random() * 0.5 + 0.3 // Прозрачность от 0.3 до 0.8
  }

  update(engine) {
    // Падение вниз
    this.y += this.speed
    if (checkMoveDown(engine)) {
      this.y += getMoveDownValue(engine) * 0.5
    }
    
    // Качание влево-вправо
    this.wobble += this.wobbleSpeed
    this.x += Math.sin(this.wobble) * 0.5
    
    // Перезапуск когда упала за экран
    if (this.y > engine.height) {
      this.y = -10
      this.x = Math.random() * engine.width
    }
    
    // Возврат на другую сторону если вышла за границы по X
    if (this.x > engine.width) {
      this.x = -this.size
    } else if (this.x < -this.size) {
      this.x = engine.width
    }
  }

  draw(ctx) {
    ctx.save()
    ctx.globalAlpha = this.opacity
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

// Массив снежинок
let snowflakes = []
let currentEngine = null

export const initSnow = (engine, count = 50) => {
  // Переинициализируем снег при создании новой игры
  snowflakes = []
  currentEngine = engine
  for (let i = 0; i < count; i++) {
    snowflakes.push(new Snowflake(engine))
  }
}

export const snowAction = (instance, engine) => {
  // Инициализация если еще не созданы или двигатель изменился
  if (snowflakes.length === 0 || currentEngine !== engine) {
    initSnow(engine, 50)
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

