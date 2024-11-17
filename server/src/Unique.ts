export class NumberCounter {
  #current_id = 100;
  get_id() {
    return this.#current_id++;
  }
}

export let entity_id_counter = new NumberCounter();

export class BigIntCounter {
  #current_id = 100n;
  get_id() {
    return this.#current_id++;
  }
}

export let entity_uuid_counter = new BigIntCounter();
