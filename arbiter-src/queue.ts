class PromiseQueue {
  queue = Promise.resolve<any>(true)

  add(operation: () => void) {
    this.queue = this.queue.then(operation)
  }
}

export default new PromiseQueue;