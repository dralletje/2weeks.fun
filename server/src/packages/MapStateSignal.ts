import { Signal } from "signal-polyfill";

export class MapStateSignal<Key, Value> extends Signal.State<Map<Key, Value>> {
  constructor(initial: Array<[Key, Value]> = []) {
    super(new Map(initial));
  }

  add(key: Key, value: Value) {
    if (this.get().has(key)) {
      throw new Error("Key already exists");
    }
    this.set(new Map([...this.get(), [key, value]]));
  }

  delete(key: Key) {
    if (!this.get().has(key)) {
      throw new Error("Key does not exist");
    }
    this.set(new Map([...this.get()].filter(([k, v]) => k !== key)));
  }

  remove(key: Key) {
    if (!this.get().has(key)) {
      throw new Error("Key does not exist");
    }
    this.set(new Map([...this.get()].filter(([k, v]) => k !== key)));
  }

  values() {
    return this.get().values();
  }
}
