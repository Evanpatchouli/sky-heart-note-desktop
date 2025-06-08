class AsyncStore {
  #state: Record<string | symbol, any> = {};
  #listeners: Array<(state: Record<string | symbol, any>) => void> = [];

  constructor(initialState?: Record<string | symbol, any>) {
    this.#state = initialState || {};
  }

  async set<T = any>(key: string | symbol, value: T): Promise<void> {
    this.#state[key] = value;
    this.#notify();
  }

  async get<T = any>(key: string | symbol): Promise<T> {
    return this.#state[key];
  }

  toString(): string {
    return "[AsyncStore]";
  }

  static create(initialState?: Record<string | symbol, any>): AsyncStore {
    return new AsyncStore(initialState);
  }

  async clear(): Promise<void> {
    this.#state = {};
    this.#notify();
  }

  async getState(): Promise<Record<string | symbol, any>> {
    return this.#state;
  }

  subscribe(callback: (state: Record<string | symbol, any>) => void): () => void {
    this.#listeners.push(callback);
    return () => {
      this.#listeners = this.#listeners.filter(listener => listener !== callback);
    };
  }

  #notify() {
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}

const asyncStore = AsyncStore.create();

export default asyncStore;