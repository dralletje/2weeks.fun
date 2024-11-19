let error = (message: string) => {
  throw new Error(message);
};

type WeakMapIfPossible<Key, Value> = Key extends WeakKey
  ? WeakMap<Key, Value>
  : never;
type MapLike<Key, Value> = Map<Key, Value> | WeakMapIfPossible<Key, Value>;

export let emplace = <Key, Value>(
  map: MapLike<Key, Value>,
  key: Key,
  fns: {
    insert?: () => Value;
    update?: (old: Value) => Value;
  }
): Value => {
  let old = map.get(key);
  if (old) {
    if (fns.update) {
      let new_value = fns.update(old);
      map.set(key, new_value);
      return new_value;
    } else {
      return old;
    }
  } else {
    if (fns.insert) {
      let new_value = fns.insert();
      map.set(key, new_value);
      return new_value;
    } else {
      throw new Error(`No insert function provided`);
    }
  }
};

export let immutable_emplace = <Key, Value>(
  map: Map<Key, Value>,
  key: Key,
  fns: {
    insert?: () => Value;
    update?: (old: Value) => Value;
  }
): Map<Key, Value> => {
  let old = map.get(key);
  if (old) {
    if (fns.update) {
      return new Map([...map, [key, fns.update(old)]]);
    } else {
      return map;
    }
  } else {
    if (fns.insert) {
      return new Map([...map, [key, fns.insert()]]);
    } else {
      throw new Error("No insert function provided");
    }
  }
};

export let immutable_erase = <Key, Value>(
  map: Map<Key, Value>,
  key: Key
): Map<Key, Value> => {
  let new_map = new Map(map);
  new_map.delete(key);
  return new_map;
};

export let map_difference = <Key, Value>(
  from: Map<Key, Value>,
  to: Map<Key, Value>
): {
  added: Map<Key, Value>;
  stayed: Map<Key, [Value, Value]>;
  removed: Map<Key, Value>;
} => {
  let added = new Map<Key, Value>();
  let stayed = new Map<Key, [Value, Value]>();
  let removed = new Map<Key, Value>();

  for (let [key, value] of from) {
    if (to.has(key)) {
      stayed.set(key, [value, to.get(key)!]);
    } else {
      removed.set(key, value);
    }
  }

  for (let [key, value] of to) {
    if (!from.has(key)) {
      added.set(key, value);
    }
  }

  return { added, stayed, removed };
};
