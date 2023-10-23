import { EventEmitter } from 'events'

function generateRandomString () {
  return String(Math.floor(Math.random() * 100000000000000))
}

export default class Token extends EventEmitter {
  readonly id: string

  private destroyed: boolean = false

  constructor () {
    super()

    this.id = generateRandomString()
  }

  destroy () {
    if (!this.destroyed) {
      this.destroyed = true
      this.emit('destroy')
    }
  }
}
