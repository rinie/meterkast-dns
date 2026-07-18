// Bridges noble's event-driven API (EventEmitter) to the adapter
// contract's pull-based async generator: events push in, the generator
// awaits and yields out. Plain FIFO with waiters for the empty case.
export function createAsyncQueue() {
  const items = [];
  const waiters = [];
  return {
    push(item) {
      const waiter = waiters.shift();
      if (waiter) waiter(item);
      else items.push(item);
    },
    next() {
      if (items.length > 0) return Promise.resolve(items.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}
