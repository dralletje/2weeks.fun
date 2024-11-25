export class NumberCounter {
  #current_id = 1;
  get_id() {
    return this.#current_id++;
  }

  return(id: number) {
    /// Nothing yet, but could be used to recycle ids
  }
}

export class BigIntCounter {
  #current_id = 100n;
  get_id(): bigint {
    return this.#current_id++;
    // return UUID.from_string(uuidv4().replaceAll("4", "2")).toBigInt();
  }
}
