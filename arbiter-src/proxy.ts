import { EventEmitter } from 'events'
import axios, { AxiosError } from 'axios'
import { SocksProxyAgent } from 'socks-proxy-agent'

import Token from './token'
import { delay } from './utils'

export type Ip = string;

export default abstract class Proxy extends EventEmitter {

  /**
   * Идентификатор (случайное число)
   */
  id: number

  /**
   * Строка подключения для браузера
   */
  connectionString: string

  /** Статус */
  enabled: boolean

  /** Количество активных токенов */
  activeTokens: number = 0

  /** Время последнего доступа */
  lastAccessTimestamp: number = 0

  /** Ошибка */
  lastError?: string

  /** Находится в состоянии перезагрузки */
  restarting: boolean = false

  /** Кол-во отданных токенов */
  tokensAcquired: number = 0

  /** IP адрес */
  ipAddress: string = ''

  /**
   * Уникальный ИД (например телефон)
   */
  proxyId: string = ''

  /** Требуется обслуживание */
  protected maintenance: boolean = false

  protected constructor (connectionString: string, enabled: boolean = false, proxyId: string = '') {
    super()

    this.id = Math.floor(Math.random() * 100000000000)
    this.enabled = enabled
    this.proxyId = proxyId
    this.connectionString = connectionString
  }

  log (message: string): void {
    this.emit('log', `[${new Date}] [${this.constructor.name}] [${this.connectionString}] ${message}`)
  }

  available (tokenPerRunLimit: number, activeTokenLimit = Infinity) {
    return (
      this.enabled // Включен
      && !this.maintenance // Не ожидает перезагрузки
      && !this.lastError // Нет ошибок
      && this.tokensAcquired < tokenPerRunLimit // Суммарное кол-во выданных токенов меньше лимита
      && this.activeTokens <= activeTokenLimit // Кол-во работающих токенов меньше максимального порога
    )
  }

  /**
   * Получить токен подключения к прокси
   *
   * @param {number} tokenPerRunLimit
   * @param {number} activeTokenLimit
   */
  acquire (tokenPerRunLimit: number, activeTokenLimit: number = Infinity) {
    if (!this.available(tokenPerRunLimit, activeTokenLimit)) {
      return
    }

    if (++this.tokensAcquired === tokenPerRunLimit) {
      this.maintenance = true
    }

    // Активные токены
    this.activeTokens++

    // Дата последнего доступа к прокси
    this.lastAccessTimestamp = (new Date()).getTime()

    const token = new Token()

    token.once('destroy', async () => {
      this.activeTokens--

      // Активных токенов больше не осталось.
      // Если прокси требуется перезагрузка и прокси ещё включено, то перезагружаем
      if (this.activeTokens <= 0 && this.maintenance) {
        this.emit('will-restart')

        if (this.enabled) {
          await this.restart()
        }

        this.activeTokens = 0
        this.maintenance = false
        this.emit('did-restart')
      }
    })

    return token
  }

  /**
   * Перезагрузить прокси
   */
  async restart (): Promise<boolean> {
    this.restarting = true // Помечаем что прокси на обслуживании
    this.lastError = undefined // Сбрасываем ошибку

    try {
      this.log('Перезагрузка...')

      await this.performRestart()

      // Чуть-чуть потупим
      await delay(2000)

      // await this.testConnection()
      await this.getIpAddress()

      this.tokensAcquired = 0 // Сбрасываем кол-во использованных токенов
      this.log('Успешно перезагружен')

      return true
    } catch (e: any) {
      this.lastError = e.message
      this.log('Не удалось перезагрузить: ' + e.message)

      return false
    } finally {
      this.restarting = false
    }
  }

  /**
   * Проверяем состояние прокси и возвращаем текущий IP адрес
   */
  async checkStatus (): Promise<Ip> {
    try {
      await this.performCheckStatus()
      // await this.testConnection()
      await this.getIpAddress()

      return this.ipAddress
    } catch (e: any) {
      this.log('Ошибка проверки статуса: ' + e.message)

      return ''
    }
  }

  /**
   * Обновить данные прокси
   * @param body
   */
  abstract update (body: { [key: string]: any }): Promise<boolean>

  abstract getAccountBalance (): Promise<string>;

  /**
   * Первичная проверка прокси
   */
  async initialize () {
    this.tokensAcquired = 0
    this.activeTokens = 0
    this.lastError = undefined

    // Прокси выключен, пропускаем инициализацию
    if (!this.enabled) {
      return
    }

    // Временно отключаем прокси на этапе инициализации
    this.enabled = false

    // Проверяем, как себя чувствует прокси
    // если всё хорошо, то помечаем что прокси активный
    if (await this.checkStatus()) {
      this.log('Прокси работает')
      this.enabled = true
    }
    // Пробуем сделать рестарт прокси
    else {
      this.log(`Прокси не работает. Пробую сделать перезагрузку`)

      if (await this.restart()) {
        this.enabled = true
      }
    }
  }

  /**
   * Конвертация прокси в JSON формат (Для сохранения)
   */
  toJson (): any {
    return {
      type: this.constructor.name,
      connectionString: this.connectionString,
      enabled: this.enabled,
      proxyId: this.proxyId,
    }
  }

  /**
   * Выгрузка данных по прокси
   */
  dump () {
    return {
      connectionString: this.connectionString,
      enabled: this.enabled,
      activeTokens: this.activeTokens,
      lastAccessTimestamp: this.lastAccessTimestamp,
      maintenance: this.maintenance,
      restarting: this.restarting,
      tokensAcquired: this.tokensAcquired,
    }
  }

  /**
   * Выполнить проверку статуса прокси
   */
  protected abstract performCheckStatus (): Promise<void>;

  /**
   * Выполняем перезагрузку
   */
  protected abstract performRestart (): Promise<void>;

  /**
   * Получаем IP адрес на выходе
   * @private
   */
  private async getIpAddress (): Promise<void> {
    this.log('Проверяю доступ в интернет')

    let error: AxiosError

    // Пробуем 2 раза
    for (let i = 0; i < 2; i++) {
      try {
        const httpAgent = new SocksProxyAgent(`socks5://${this.connectionString}`)
        const client = axios.create({
          baseURL: 'http://st.babysfera.ru',
          headers: {
            'Host': 'st.babysfera.ru',
            'User-Agent': 'bots',
          },
          httpAgent: httpAgent,
          maxRedirects: 0,
          timeout: 4000,
        })

        this.ipAddress = (await client.get<string>('/myip')).data.trim()
        this.log('IP: ' + this.ipAddress)
        return
      } catch (e: AxiosError | any) {
        error = e

        await delay(1000)
      }
    }

    throw new Error('Не смог проверить IP адрес [' + error!.message + '] [' + error!.name + ']' +
      ' Data: ' + JSON.stringify(error!.response?.data) +
      ' Headers: ' + JSON.stringify(error!.response?.headers)
    )
  }

  disable () {
    this.maintenance = false
    this.restarting = false
    this.tokensAcquired = 0
    this.lastAccessTimestamp = 0
    this.lastError = ''
  }
}
