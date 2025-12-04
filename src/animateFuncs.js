import { Instance } from 'cooljs'
import { blockAction, blockPainter } from './block'
import {
  checkMoveDown,
  getMoveDownValue,
  drawYellowString,
  getAngleBase
} from './utils'
import { addFlight } from './flight'
import * as constant from './constant'

// Кеширование для оптимизации производительности
let cachedScoreImage = null
let cachedScoreDimensions = null
let cachedHeartImage = null
let cachedHeartDimensions = null

export const endAnimate = (engine) => {
  const gameStartNow = engine.getVariable(constant.gameStartNow)
  if (!gameStartNow) return
  
  // Кешируем переменные для избежания повторных вызовов
  const successCount = engine.getVariable(constant.successCount, 0)
  const failedCount = engine.getVariable(constant.failedCount)
  const gameScore = engine.getVariable(constant.gameScore, 0)
  const threeFiguresOffset = Number(successCount) > 99 ? engine.width * 0.1 : 0
  const ctx = engine.ctx

  // Оптимизация: кешируем изображения и размеры
  if (!cachedScoreImage) {
    cachedScoreImage = engine.getImg('score')
    if (cachedScoreImage) {
      const zoomedWidth = engine.width * 0.35
      const zoomedHeight = (cachedScoreImage.height * zoomedWidth) / cachedScoreImage.width
      cachedScoreDimensions = { width: zoomedWidth, height: zoomedHeight }
    }
  }
  
  if (!cachedHeartImage) {
    cachedHeartImage = engine.getImg('heart')
    if (cachedHeartImage) {
      const zoomedHeartWidth = engine.width * 0.08
      const zoomedHeartHeight = (cachedHeartImage.height * zoomedHeartWidth) / cachedHeartImage.width
      cachedHeartDimensions = { width: zoomedHeartWidth, height: zoomedHeartHeight }
    }
  }

  // Рисуем текст "ЭТАЖ" и счетчик этажей
  drawYellowString(engine, {
    string: 'ЭТАЖ',
    size: engine.width * 0.06,
    x: (engine.width * 0.24) + threeFiguresOffset,
    y: engine.width * 0.12,
    textAlign: 'left',
    fontName: 'Arial',
    fontWeight: 'bold'
  })
  drawYellowString(engine, {
    string: successCount,
    size: engine.width * 0.17,
    x: (engine.width * 0.22) + threeFiguresOffset,
    y: engine.width * 0.2,
    textAlign: 'right'
  })
  
  // Рисуем изображение score (кешированное)
  if (cachedScoreImage && cachedScoreDimensions) {
    engine.ctx.drawImage(
      cachedScoreImage,
      engine.width * 0.61,
      0,
      cachedScoreDimensions.width,
      cachedScoreDimensions.height
    )
  }
  
  // Всегда показываем бонусы вместо очков в обоих режимах
  const gameBonuses = engine.getVariable('GAME_BONUSES')
  const bonusesToShow = (gameBonuses !== undefined && gameBonuses !== null) ? gameBonuses : 0
  drawYellowString(engine, {
    string: String(bonusesToShow),
    size: engine.width * 0.06,
    x: engine.width * 0.9,
    y: engine.width * 0.11,
    textAlign: 'right'
  })
  
  // Рисуем сердца (оптимизировано)
  if (cachedHeartImage && cachedHeartDimensions) {
    const { width: heartWidth, height: heartHeight } = cachedHeartDimensions
    const heartX = engine.width * 0.66
    
    // Группируем операции рисования для оптимизации
    for (let i = 1; i <= 3; i += 1) {
      ctx.save()
      if (i <= failedCount) {
        ctx.globalAlpha = 0.2
      }
      ctx.drawImage(
        cachedHeartImage,
        heartX + ((i - 1) * heartWidth),
        engine.width * 0.16,
        heartWidth,
        heartHeight
      )
      ctx.restore()
    }
  }
}

export const startAnimate = (engine) => {
  const gameStartNow = engine.getVariable(constant.gameStartNow)
  if (!gameStartNow) return
  const lastBlock = engine.getInstance(`block_${engine.getVariable(constant.blockCount)}`)
  if (!lastBlock || [constant.land, constant.out].indexOf(lastBlock.status) > -1) {
    if (checkMoveDown(engine) && getMoveDownValue(engine)) return
    if (engine.checkTimeMovement(constant.hookUpMovement)) return
    const angleBase = getAngleBase(engine)
    const initialAngle = (Math.PI
      * engine.utils.random(angleBase, angleBase + 5)
      * engine.utils.randomPositiveNegative()
    ) / 180
    engine.setVariable(constant.blockCount, engine.getVariable(constant.blockCount) + 1)
    engine.setVariable(constant.initialAngle, initialAngle)
    engine.setTimeMovement(constant.hookDownMovement, 500)
    const block = new Instance({
      name: `block_${engine.getVariable(constant.blockCount)}`,
      action: blockAction,
      painter: blockPainter
    })
    engine.addInstance(block)
  }
  const successCount = Number(engine.getVariable(constant.successCount, 0))
  switch (successCount) {
    case 2:
      addFlight(engine, 1, 'leftToRight')
      break
    case 6:
      addFlight(engine, 2, 'rightToLeft')
      break
    case 8:
      addFlight(engine, 3, 'leftToRight')
      break
    case 14:
      addFlight(engine, 4, 'bottomToTop')
      break
    case 18:
      addFlight(engine, 5, 'bottomToTop')
      break
    case 22:
      addFlight(engine, 6, 'bottomToTop')
      break
    case 25:
      addFlight(engine, 7, 'rightTopToLeft')
      break
    default:
      break
  }
}

