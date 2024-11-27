import { Signal } from "signal-polyfill";
import { type AnySignal, async_computed } from "../../utils/signals.ts";
import { type Vec3, vec3 } from "../../utils/vec3.ts";
// import { Record } from "@dral/records-and-tuples";
import { isEqual } from "lodash-es";
import { World } from "../../PluginInfrastructure/World.ts";
import { type Position } from "../../PluginInfrastructure/MinecraftTypes.ts";

type Record<T extends Vec3 = Vec3> = T;

let chunk_map = new Map<string, Vec3>();
let Record = <T extends Vec3>(value: T) => {
  let key = `${value.x},${value.y},${value.z}`;
  let val = chunk_map.get(key);
  if (val) {
    return val;
  } else {
    chunk_map.set(key, value);
    return value;
  }
};

// let chunk_map: { [key: string]: Vec3 } = {};
// let Record = <T extends Vec3>(value: T) => {
//   let key = `${value.x},${value.y},${value.z}`;
//   let val = chunk_map[key];
//   if (val) {
//     return val;
//   } else {
//     chunk_map[key] = value;
//     return value;
//   }
// };

let signal_from_async = <T>(fn: () => Promise<T>): AnySignal<T | null> => {
  let signal = new Signal.State<T | null>(null);
  fn().then((value) => signal.set(value));
  return signal;
};

let NAME = "Nymeria10k";

let a_star_basic = <T extends Record>(options: {
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

let a_star_async = async <T extends Record>(options: {
  from: T;
  to: T;
  neighbors: (node: T) => T[];
  distance: (from: T, to: T) => number;
  heuristic: (from: T, to: T) => number;
  signal: AbortSignal;
  limit: number;
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
    yield_counter++;
    if (infinite_loop_protection > options.limit) {
      // throw new Error("Infinite loop protection");
      return null;
    }

    if (yield_counter > 10) {
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

/// Normalized form of notating movement:
/// x is always the highest or the horizontal movements
/// Then gets "expanded" like this:
/// IN: { x: 1, y: 0, z: 0 }
/// OUT: [
///   { x: 1, y: 0, z: 0 },
///   { x: 0, y: 0, z: 1 },
///   { x: -1, y: 0, z: 0 },
///   { x: 0, y: 0, z: -1 },
/// ]

/// Also, we assume for now you only want to go where
/// you can get back from, so all ups have a corresponding down, but not the other way around
let expand = (
  { x, y, z }: Vec3,
  penalty_fn: PenaltyFunction
): Array<[Record<Vec3>, (from: Vec3, to: Vec3) => number]> => {
  if (z > x) {
    throw new Error(`z > x in movement: { x: ${x}, y: ${y}, z: ${z} }`);
  }
  if (y < 0) {
    throw new Error(`y < 0 in movement: { x: ${x}, y: ${y}, z: ${z} }`);
  }

  return [
    [
      Record({ x: x, y: y, z: z }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(from, {
            x: vec.x,
            y: vec.y,
            z: vec.z,
          })
        ),
    ],
    [
      Record({ x: x, y: y, z: -z }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(from, {
            x: vec.x,
            y: vec.y,
            z: -vec.z,
          })
        ),
    ],
    [
      Record({ x: -x, y: y, z: z }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(from, {
            x: -vec.x,
            y: vec.y,
            z: vec.z,
          })
        ),
    ],
    [
      Record({ x: -x, y: y, z: -z }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(from, {
            x: -vec.x,
            y: vec.y,
            z: -vec.z,
          })
        ),
    ],
    [
      Record({ x: z, y: y, z: x }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(from, {
            x: vec.z,
            y: vec.y,
            z: vec.x,
          })
        ),
    ],
    [
      Record({ x: z, y: y, z: -x }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(from, {
            x: vec.z,
            y: vec.y,
            z: -vec.x,
          })
        ),
    ],
    [
      Record({ x: -z, y: y, z: x }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(from, {
            x: -vec.z,
            y: vec.y,
            z: vec.x,
          })
        ),
    ],
    [
      Record({ x: -z, y: y, z: -x }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(from, {
            x: -vec.z,
            y: vec.y,
            z: -vec.x,
          })
        ),
    ],

    /// NEGATIVE Y
    /// Same pattern as above, but we go from `to` instead of `from`,
    /// and we subtract the current delta
    [
      Record({ x: x, y: -y, z: z }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(to, {
            x: -vec.x,
            y: vec.y,
            z: -vec.z,
          })
        ),
    ],
    [
      Record({ x: x, y: -y, z: -z }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(to, {
            x: -vec.x,
            y: vec.y,
            z: vec.z,
          })
        ),
    ],
    [
      Record({ x: -x, y: -y, z: z }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(to, {
            x: vec.x,
            y: vec.y,
            z: -vec.z,
          })
        ),
    ],
    [
      Record({ x: -x, y: -y, z: -z }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(to, {
            x: vec.x,
            y: vec.y,
            z: vec.z,
          })
        ),
    ],

    [
      Record({ x: z, y: -y, z: x }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(to, {
            x: -vec.z,
            y: vec.y,
            z: -vec.x,
          })
        ),
    ],
    [
      Record({ x: z, y: -y, z: -x }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(to, {
            x: -vec.z,
            y: vec.y,
            z: vec.x,
          })
        ),
    ],
    [
      Record({ x: -z, y: -y, z: x }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(to, {
            x: vec.z,
            y: vec.y,
            z: -vec.x,
          })
        ),
    ],
    [
      Record({ x: -z, y: -y, z: -x }),
      (from: Vec3, to: Vec3) =>
        penalty_fn((vec) =>
          vec3.add(to, {
            x: vec.z,
            y: vec.y,
            z: vec.x,
          })
        ),
    ],
  ];
};

type PenaltyFunction = (transform_location: (vec: Vec3) => Vec3) => number;

let nonsolid = new Set([
  "minecraft:air",
  "minecraft:sugar_cane",
  "minecraft:water",
  "minecraft:tall_grass",
  "minecraft:short_grass",
  "minecraft:rose_bush",
]);

let move_through_penalty = (material: { name: string }) => {
  if (!nonsolid.has(material.name)) {
    return Infinity;
  }
  /// Dislike water
  if (material.name === "minecraft:water") {
    return 1;
  }
  /// Dislike other non-air blocks a little
  if (material.name !== "minecraft:air") {
    return 0.5;
  }
  return 0;
};

export let alexwalk = ({
  world,
  from$,
  to$,
  limit = 10000,
}: {
  world: World;
  from$: AnySignal<Position>;
  to$: AnySignal<Position>;
  limit?: number;
}) => {
  let current_position_block$ = new Signal.Computed(
    () => {
      return vec3.floor(vec3.add(from$.get(), { x: 0, y: 0.3, z: 0 }));
    },
    { equals: isEqual }
  );

  let player_position_block$ = new Signal.Computed(
    () => {
      return vec3.floor(vec3.add(to$.get(), { x: 0, y: 0.3, z: 0 }));
    },
    { equals: isEqual }
  );

  let get_block = (vec: Vec3) => world.get_block({ position: vec });
  let movements = new Map<Record<Vec3>, (from: Vec3, to: Vec3) => number>(
    (
      [
        /// Normal walk
        [{ x: 1, y: 0, z: 0 }, () => 0],
        /// Diagonal walk
        [
          { x: 1, y: 0, z: 1 },
          (transform) =>
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 0, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 1, z: 1 }))),
        ],

        /// One block up
        [
          { x: 1, y: 1, z: 0 },
          (transform) =>
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Slight dislike for going up or down
            1,
        ],
        /// One block up diagonal
        /// - y=0 to y=2 of the diagonals must be nonsolid
        [
          { x: 1, y: 1, z: 1 },
          (transform) =>
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 0, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 1, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 1 }))) +
            /// Slight dislike for going up or down
            1,
        ],

        // /// Jump over one block
        [
          { x: 2, y: 0, z: 0 },
          (transform) =>
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 0 }))) +
            /// Blocks in between
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            1,
        ],
        [
          { x: 2, y: 1, z: 0 },
          (transform) =>
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 2, y: 3, z: 0 }))) +
            /// Blocks in between
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            2,
        ],
        [
          { x: 2, y: 0, z: 1 },
          /// Z=1 - - B
          /// Z=0 A - -
          ///     0 1 2
          (transform) =>
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 1 }))) +
            /// Blocks in between
            /// x=0 z=1
            move_through_penalty(get_block(transform({ x: 0, y: 0, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 1, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 1 }))) +
            /// x=1 z=0
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            /// x=1 z=1
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 1 }))) +
            /// x=2 z=0
            move_through_penalty(get_block(transform({ x: 2, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 0 }))) +
            2,
        ],
        [
          { x: 2, y: 1, z: 1 },
          /// Z=1 - - B
          /// Z=0 A - -
          ///     0 1 2
          (transform) =>
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 2, y: 3, z: 1 }))) +
            /// Blocks in between
            /// x=0 z=1
            move_through_penalty(get_block(transform({ x: 0, y: 0, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 1, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 1 }))) +
            /// x=1 z=0
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            /// x=1 z=1
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 1 }))) +
            /// x=2 z=0
            // move_through_penalty(get_block(transform({ x: 2, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 0 }))) +
            4,
        ],
        [
          { x: 2, y: 0, z: 2 },
          (transform) =>
            /// Z=2   - B
            /// Z=1 - - -
            /// Z=0 A -
            ///     0 1 2
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 1 }))) +
            /// Blocks in between
            /// x=0 z=1
            move_through_penalty(get_block(transform({ x: 0, y: 0, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 1, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 1 }))) +
            /// x=1 z=0
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            /// x=1 z=1
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 1 }))) +
            /// x=1 z=2
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 2 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 2 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 2 }))) +
            /// x=2 z=1
            move_through_penalty(get_block(transform({ x: 2, y: 0, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 1, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 1 }))) +
            4,
        ],

        [
          { x: 2, y: 1, z: 2 },
          (transform) =>
            /// Z=2   - B
            /// Z=1 - - -
            /// Z=0 A -
            ///     0 1 2
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 2, y: 3, z: 1 }))) +
            /// Blocks in between
            /// x=0 z=1
            move_through_penalty(get_block(transform({ x: 0, y: 0, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 1, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 1 }))) +
            /// x=1 z=0
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            /// x=1 z=1
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 1 }))) +
            /// x=1 z=2
            // move_through_penalty(get_block(transform({ x: 1, y: 0, z: 2 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 2 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 2 }))) +
            /// x=2 z=1
            // move_through_penalty(get_block(transform({ x: 2, y: 0, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 1, z: 1 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 1 }))) +
            4,
        ],

        /// Jump over two blocks
        [
          { x: 3, y: 0, z: 0 },
          (transform) =>
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 3, y: 2, z: 0 }))) +
            /// Blocks in between
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 0 }))) +
            4,
        ],
        [
          { x: 3, y: 0, z: 1 },
          (transform) =>
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 3, y: 2, z: 0 }))) +
            /// Blocks in between
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 0 }))) +
            4,
        ],

        /// Jump over two blocks and one up
        [
          { x: 3, y: 1, z: 0 },
          (transform) =>
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 3, y: 3, z: 0 }))) +
            /// Blocks in between
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 0 }))) +
            4,
        ],

        [
          { x: 3, y: 1, z: 2 },
          (transform) =>
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 3, y: 3, z: 2 }))) +
            /// Blocks in between
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 0 }))) +
            4,
        ],

        /// Jump over three blocks
        [
          { x: 4, y: 0, z: 0 },
          (transform) =>
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 4, y: 2, z: 0 }))) +
            /// Blocks in between
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 3, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 3, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 3, y: 2, z: 0 }))) +
            5,
        ],

        [
          { x: 4, y: 1, z: 0 },
          (transform) =>
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 4, y: 3, z: 0 }))) +
            /// Blocks in between
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 2, y: 2, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 3, y: 0, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 3, y: 1, z: 0 }))) +
            move_through_penalty(get_block(transform({ x: 3, y: 2, z: 0 }))) +
            /// This jump takes a lot of effort
            10,
        ],

        /// Jump over three blocks, z=1
        [
          { x: 4, y: 0, z: 1 },
          (transform) =>
            /// Block above where we jump from
            move_through_penalty(get_block(transform({ x: 0, y: 2, z: 0 }))) +
            /// Block above where we jump to
            move_through_penalty(get_block(transform({ x: 4, y: 2, z: 1 }))) +
            /// Blocks in between
            move_through_penalty(get_block(transform({ x: 1, y: 0, z: 0 }))) +
            // move_through_penalty(get_block(transform({ x: 1, y: 1, z: 0 }))) +
            // move_through_penalty(get_block(transform({ x: 1, y: 2, z: 0 }))) +
            // move_through_penalty(get_block(transform({ x: 2, y: 0, z: 0 }))) +
            // move_through_penalty(get_block(transform({ x: 2, y: 1, z: 0 }))) +
            // move_through_penalty(get_block(transform({ x: 2, y: 2, z: 0 }))) +
            // move_through_penalty(get_block(transform({ x: 2, y: 0, z: 1 }))) +
            // move_through_penalty(get_block(transform({ x: 2, y: 1, z: 1 }))) +
            // move_through_penalty(get_block(transform({ x: 2, y: 2, z: 1 }))) +
            // move_through_penalty(get_block(transform({ x: 3, y: 0, z: 0 }))) +
            // move_through_penalty(get_block(transform({ x: 3, y: 1, z: 0 }))) +
            // move_through_penalty(get_block(transform({ x: 3, y: 2, z: 0 }))) +
            // move_through_penalty(get_block(transform({ x: 3, y: 0, z: 1 }))) +
            // move_through_penalty(get_block(transform({ x: 3, y: 1, z: 1 }))) +
            // move_through_penalty(get_block(transform({ x: 3, y: 2, z: 1 }))) +
            10,
        ],

        // /// Jump over two blocks
        // [{ x: 3, y: 0, z: 0 }, () => 10],
        // [{ x: 3, y: 0, z: 1 }, () => 10],
        // [{ x: 3, y: 0, z: 2 }, () => 10],
        // [{ x: 3, y: 0, z: 3 }, () => 10],
      ] as Array<[Vec3, PenaltyFunction]>
    ).flatMap(([movement, penalty_fn]) => expand(movement, penalty_fn))
  );

  let sides = [...movements.keys()];

  // let path$ = new Signal.Computed(() => {
  let path$ = async_computed((a_star_signal) => {
    let from = current_position_block$.get();
    let to = player_position_block$.get();

    // let sides =

    let score_from_to = (from: Vec3, to: Vec3) => {
      let material_to_in = world.get_block({ position: to });
      let material_to_head_in = world.get_block({
        position: vec3.add(to, { x: 0, y: 1, z: 0 }),
      });
      let material_to_ground = world.get_block({
        position: vec3.add(to, { x: 0, y: -1, z: 0 }),
      });

      let delta = Record(vec3.difference(from, to));
      let distance2 = vec3.length2(delta);
      let distance = vec3.length(delta);

      /// TODO Swimming

      if (
        !nonsolid.has(material_to_in.name) ||
        !nonsolid.has(material_to_head_in.name) ||
        nonsolid.has(material_to_ground.name)
      ) {
        return Infinity;
      }

      let penalty = distance;

      /// Execute the extra penalty function we got from the movement type
      let movement_type_penalty = movements.get(delta);
      if (movement_type_penalty == null) {
        throw new Error(`No movement type penalty for ${delta}`);
      }
      penalty += movement_type_penalty(from, to);

      /// Like going on dirt paths!
      if (material_to_ground.name !== "minecraft:dirt_path") {
        penalty += 0.5;
      }

      /// Dislike water
      if (material_to_in.name === "minecraft:water") {
        penalty += 1;
      }

      return penalty;
    };

    // console.log(`sides:`, sides);

    // return a_star_basic({
    //   from: Record(vec3.floor(from)),
    //   to: Record(vec3.floor(to)),
    //   neighbors: (node) => {
    //     return sides.map((x) => Record(vec3.add(node, x)));
    //   },
    //   distance: (from, to) => {
    //     return score_from_to(from, to);
    //   },
    //   heuristic: (from, goal) => {
    //     let distance = vec3.difference(from, goal);
    //     /// Up and down is more expensive, so that should be praised
    //     return vec3.length(distance) + distance.y;
    //   },
    // });

    return a_star_async({
      from: Record(vec3.floor(from)),
      to: Record(vec3.floor(to)),
      neighbors: (node) => {
        return sides.map((x) => Record(vec3.add(node, x)));
      },
      distance: (from, to) => {
        return score_from_to(from, to);
      },
      heuristic: (from, goal) => {
        let distance = vec3.difference(from, goal);
        /// Up and down is more expensive, so that should be praised
        return vec3.length(distance) + distance.y;
      },
      limit: limit,
      signal: a_star_signal,
    });
  });

  return path$;
};
