import { v4 as uuidv4 } from "uuid";
import { UUID } from "./utils/UUID.ts";

export class NumberCounter {
  #current_id = 100;
  get_id() {
    return this.#current_id++;
  }
}

export let entity_id_counter = new NumberCounter();

export class BigIntCounter {
  #current_id = 100n;
  get_id(): bigint {
    return this.#current_id++;
    // return UUID.from_string(uuidv4().replaceAll("4", "2")).toBigInt();
  }
}

export let entity_uuid_counter = new BigIntCounter();
