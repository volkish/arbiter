import Token from './token'

export default new class {
  tokens = new Map<string, Token>()

  set (token: Token) {
    this.tokens.set(token.id, token)
  }

  delete (token: Token) {
    this.tokens.delete(token.id)
  }

  get (id: string) {
    return this.tokens.get(id)
  }
}
