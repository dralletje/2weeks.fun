import { type Vec3 } from "../../utils/vec3.ts";

export let a_star_basic = <T>(options: {
  from: T;
  to: T;
  neighbors: (node: T) => T[];
  distance: (from: T, to: T) => number;
  heuristic: (from: T, to: T) => number;
}) => {
  let open_set = new Set<T>();
  let came_from = new Map<T, T>();
  let g_score = new Map<T, number>();

  let f_score = new Map<T, number>();

  open_set.add(options.from);
  f_score.set(options.from, 0);
  g_score.set(options.from, 0);

  let infinite_loop_protection = 0;

  while (open_set.size !== 0) {
    infinite_loop_protection++;
    if (infinite_loop_protection > 5000) {
      // throw new Error("Infinite loop protection");
      return null;
    }

    let current = Array.from(open_set).reduce((a, b) => {
      if (f_score.get(a)! < f_score.get(b)!) {
        return a;
      } else {
        return b;
      }
    });

    if (current === options.to) {
      let path = [current];
      while (came_from.has(current)) {
        current = came_from.get(current)!;
        path.unshift(current);
      }
      return path;
    }

    open_set.delete(current);
    let neightbors = options.neighbors(current);

    for (let neighbor of neightbors) {
      let tentative_g_score =
        g_score.get(current)! + options.distance(current, neighbor);
      if (tentative_g_score < (g_score.get(neighbor) ?? Infinity)) {
        came_from.set(neighbor, current);
        g_score.set(neighbor, tentative_g_score);
        f_score.set(
          neighbor,
          tentative_g_score + options.heuristic(neighbor, options.to)
        );
        open_set.add(neighbor);
      }
    }
  }
};

export let a_star_async = async <T>(options: {
  from: T;
  to: T;
  neighbors: (node: T) => T[];
  distance: (from: T, to: T) => number;
  heuristic: (from: T, to: T) => number;
  signal: AbortSignal;
  limit: number;
  tick_limit: number;
}) => {
  let open_set = new Set<T>();
  let came_from = new Map<T, T>();
  let g_score = new Map<T, number>();

  let f_score = new Map<T, number>();

  open_set.add(options.from);
  f_score.set(options.from, 0);
  g_score.set(options.from, 0);

  let infinite_loop_protection = 0;
  let yield_counter = 0;

  while (open_set.size !== 0) {
    infinite_loop_protection++;
    if (infinite_loop_protection > options.limit) {
      // throw new Error("Infinite loop protection");
      return null;
    }

    yield_counter++;
    if (yield_counter > options.tick_limit) {
      yield_counter = 0;
      await new Promise((resolve) => setTimeout(resolve, 0));
      options.signal.throwIfAborted();
    }

    let current = Array.from(open_set).reduce((a, b) => {
      if (f_score.get(a)! < f_score.get(b)!) {
        return a;
      } else {
        return b;
      }
    });

    if (current === options.to) {
      let path = [current];
      while (came_from.has(current)) {
        current = came_from.get(current)!;
        path.unshift(current);
      }
      return path;
    }

    open_set.delete(current);
    let neightbors = options.neighbors(current);

    for (let neighbor of neightbors) {
      let tentative_g_score =
        g_score.get(current)! + options.distance(current, neighbor);
      if (tentative_g_score < (g_score.get(neighbor) ?? Infinity)) {
        came_from.set(neighbor, current);
        g_score.set(neighbor, tentative_g_score);
        f_score.set(
          neighbor,
          tentative_g_score + options.heuristic(neighbor, options.to)
        );
        open_set.add(neighbor);
      }
    }
  }
};
