import { Signal } from "signal-polyfill";
import {
  type Plugin_v1,
  type ListedPlayer,
  type Plugin_v1_Args,
} from "../PluginInfrastructure/Plugin_v1.ts";
import {
  type Entity,
  entity_uuid_counter,
} from "../Drivers/entities_driver.ts";
import { Mojang } from "../packages/Mojang.ts";
import { modulo_cycle } from "../utils/modulo_cycle.ts";
import {
  type EntityMetadataEntry,
  PlayPackets,
} from "../protocol/minecraft-protocol.ts";
import { MapStateSignal } from "../packages/MapStateSignal.ts";
import {
  c,
  command,
  CommandError,
} from "../PluginInfrastructure/Commands_v1.ts";
import { chat } from "../utils/chat.ts";
import { TickSignal } from "../utils/TimeSignal.ts";
import {
  type Position,
  type EntityPosition,
} from "../PluginInfrastructure/MinecraftTypes.ts";
import { type AnySignal, effectWithSignal } from "../utils/signals.ts";
import { type Vec3, vec3 } from "../utils/vec3.ts";
import { Record } from "@dral/records-and-tuples";
import { error } from "../utils/error.ts";
import { emplace } from "../packages/immappable.ts";
import { isEqual, range, zip } from "lodash-es";

type NPC = {
  position: {
    x: number;
    y: number;
    z: number;
    pitch: number;
    yaw: number;
    head_yaw: number;
  };
  name: string;
  texture: {
    value: string;
    signature: string;
  } | null;

  walking_to?: EntityPosition;
};

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
  console.log("#1");

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
    if (infinite_loop_protection > 1000) {
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

export default function pathfinding_test_plugin({
  player,
  entities,
  world,
  signal,
}: Plugin_v1_Args): Plugin_v1 {
  let entity_uuid = entity_uuid_counter.get_id();

  let texture$ = signal_from_async(async () => {
    let skin_uuid = await Mojang.get_uuid(NAME);
    let skin_texture =
      skin_uuid != null ? await Mojang.get_texture(skin_uuid) : null;
    return skin_texture;
  });

  let position$ = new Signal.State(player.position);
  let selected$ = new Signal.State<boolean>(false);
  let walking_to$ = new Signal.State<EntityPosition | null>(null);

  entities.on_interact.on(
    (event) => {
      if (event.entity_uuid === entity_uuid) {
        selected$.set(!selected$.get());
        return null;
      }
    },
    { signal }
  );

  player.on_interact_v1(
    (event) => {
      if (!selected$.get()) {
        return;
      }
      if (event.target.type !== "block") {
        return;
      }

      let to = vec3.add(event.target.position, event.target.cursor);
      walking_to$.set({ ...position$.get(), ...to });
      return null;
    },
    { signal }
  );

  let ticks$ = new TickSignal(50, { signal });

  let current_position_block$ = new Signal.Computed(
    () => {
      return vec3.floor(vec3.add(position$.get(), { x: 0, y: 0.3, z: 0 }));
    },
    { equals: isEqual }
  );

  let player_position_block$ = new Signal.Computed(
    () => {
      return vec3.floor(vec3.add(player.position, { x: 0, y: 0.3, z: 0 }));
    },
    { equals: isEqual }
  );

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

  let is_solid = (block: { name: string }) => {
    return !nonsolid.has(block.name);
  };

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
            2,
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
            2,
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
            2,
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
            2,
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
            2,
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
            2,
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
            2,
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
            3,
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

  let sides = [
    // ...walking,
    // ...jump_up_one_block,
    // ...jump_down_one_block,
    // ...jump_one_block_ledge,
    // ...jump_two_block_ledge,
    ...movements.keys(),
  ];
  console.log(`sides:`, sides);

  let path$ = new Signal.Computed(() => {
    let from = current_position_block$.get();
    let to = player_position_block$.get();

    console.log("HI!");

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

      // if (from.y === to.y) {
      //   /// For horizontal movements, there may not be any blocks in the way
      //   let y = from.y;
      //   let [low, high] = vec3.lowhigh(from, to);

      //   for (let x of range(low.x, high.x + 1)) {
      //     for (let z of range(low.z, high.z + 1)) {
      //       let block = world.get_block({ position: { x, y, z } });
      //       if (!nonsolid.has(block.name)) {
      //         return Infinity;
      //       }
      //       let block_above = world.get_block({
      //         position: { x, y: y + 1, z },
      //       });
      //       if (!nonsolid.has(block_above.name)) {
      //         return Infinity;
      //       }
      //     }
      //   }

      //   /// For a horizontal jump, the blocks "in the air" must also be nonsolid
      //   for (let x of range(low.x + 1, high.x)) {
      //     for (let z of range(low.z + 1, high.z)) {
      //       // console.log(`{ x, z }:`, { x, z });
      //       let block = world.get_block({ position: { x, y: y + 2, z } });
      //       // console.log(`block:`, block);
      //       if (!nonsolid.has(block.name)) {
      //         return Infinity;
      //       }
      //     }
      //   }
      // }

      let penalty = distance;

      /// Execute the extra penalty function we got from the movement type
      let movement_type_penalty = movements.get(delta);
      if (movement_type_penalty == null) {
        console.log(`delta:`, delta);
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

    return a_star_basic({
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
    });
  });

  // effectWithSignal(signal, () => {
  //   ticks$.get();

  //   let walking_to = walking_to$.get();

  //   if (walking_to == null) {
  //     return;
  //   }

  //   let position = position$.get();

  //   let next_block = path?.[1];
  //   if (next_block == null) {
  //     return;
  //   }

  //   let dx = next_block.x - position.x;
  //   let dy = next_block.y - position.y;
  //   let dz = next_block.z - position.z;

  //   let distance = Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2);
  //   let speed = 0.1;
  //   let step = speed / distance;
  //   let new_x = position.x + dx * step;
  //   let new_y = position.y + dy * step;
  //   let new_z = position.z + dz * step;

  //   let finished = distance < speed;

  //   position$.set({
  //     ...position$.get(),
  //     x: new_x,
  //     y: new_y,
  //     z: new_z,
  //   });
  //   if (distance < speed) {
  //     walking_to$.set(null);
  //   }
  // });

  /// NOTE Listed player need to be sent before the entity....
  /// .... In the current layout there is no way to enforce this.....
  /// .... This is the only way to get the npc to show up!

  let listed_players$ = new Signal.Computed((): Map<bigint, ListedPlayer> => {
    let texture = texture$.get();
    if (texture == null) {
      return new Map();
    }

    return new Map([
      [
        entity_uuid,
        {
          name: NAME,
          properties:
            texture != null ?
              [
                {
                  name: "textures",
                  value: texture.value,
                  signature: texture.signature,
                },
              ]
            : [],
          listed: false,
          game_mode: "survival",
          ping: 0,
          // display_name: null,
          display_name: `NPC(${NAME})`,
        } as ListedPlayer,
      ],
    ]);
  });

  let entities$ = new Signal.Computed((): Map<bigint, Entity> => {
    if (texture$.get() == null) {
      return new Map();
    }

    let player_position = player.position;
    let is_selected = selected$.get();
    let position = position$.get();

    /// Pitch from this entity to the player
    let dx = player_position.x - position.x;
    let dy = player_position.y + 1.62 - (position.y + 1.62);
    let dz = player_position.z - position.z;
    let distance = Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2);
    let pitch = Math.asin(dy / distance);
    let yaw = Math.atan2(dx, dz);

    let _pitch = -((pitch / Math.PI) * (256 / 2));
    let yaw2 = modulo_cycle((-yaw / (2 * Math.PI)) * 256, 256);

    return new Map([
      [
        entity_uuid,
        {
          type: "minecraft:player",
          position: {
            x: position.x,
            y: position.y,
            z: position.z,
          },
          // x: player.position.x,
          // y: player.position.y,
          // z: player.position.z + 2,

          pitch: _pitch,
          yaw: yaw2,
          head_yaw: yaw2,
          data: 0,
          velocity_x: 0,
          velocity_y: 0,
          velocity_z: 0,

          equipment: {
            main_hand: {
              item: "minecraft:stick",
              count: 1,
            },
          },
          metadata_raw: new Map<number, EntityMetadataEntry["value"]>([
            [2, { type: "optional_chat", value: "sneaking" }],
            [3, { type: "boolean", value: true }],
            // [10, { type: "varint", value: 1 }],
            // [12, { type: "varint", value: 20 }],
            [0, { type: "byte", value: is_selected ? 0x40 : 0 }],
            [18, { type: "byte", value: 0 }],
          ]),
        },
      ],
    ]);
  });

  let path_entities_ids = new Map<number, bigint>();
  let path_entities$ = new Signal.Computed((): Map<bigint, Entity> => {
    let path = path$.get();

    if (path == null) return new Map();
    return new Map(
      zip(path.slice(1, -1), path.slice(2)).map(([_position, _next], index) => {
        let position = _position!;
        let next = _next!;

        let yaw = Math.atan2(next.x - position.x, next.z - position.z);
        let pitch = Math.asin(
          (next.y - position.y) / vec3.length(vec3.difference(next, position))
        );

        return [
          emplace(path_entities_ids, index, {
            insert: () => entity_uuid_counter.get_id(),
          }),
          {
            type: "minecraft:allay",
            position: {
              ...vec3.add(position, { x: 0.5, y: 0.5, z: 0.5 }),
            },
            yaw: -((yaw * (180 / Math.PI)) / 360) * 256,
            pitch: -((pitch * (180 / Math.PI)) / 360) * 256,
            head_yaw: -((yaw * (180 / Math.PI)) / 360) * 256,
          } satisfies Entity,
        ];
      })
    );
  });

  return {
    sinks: {
      entities$: new Signal.Computed(() => {
        return new Map([...entities$.get(), ...path_entities$.get()]);
      }),
      playerlist$: listed_players$,
    },
    commands: [
      command({
        command: c.command`/here`,
        handle: ([], { player }) => {
          position$.set(player.position);
        },
      }),
      command({
        command: c.command`/pathfind`,
        handle: ([], { player }) => {
          let position = position$.get();
          let walking_to = player.position;

          let walking = [
            Record({ x: 1, y: 0, z: 0 }),
            Record({ x: 1, y: 0, z: 1 }),
            Record({ x: 0, y: 0, z: 1 }),
            Record({ x: -1, y: 0, z: 1 }),
            Record({ x: -1, y: 0, z: 0 }),
            Record({ x: -1, y: 0, z: -1 }),
            Record({ x: 0, y: 0, z: -1 }),
          ];

          let jump_up_one_block = walking.map((x) =>
            Record(vec3.add(x, { x: 0, y: 1, z: 0 }))
          );
          let jump_down_one_block = walking.map((x) =>
            Record(vec3.add(x, { x: 0, y: -1, z: 0 }))
          );

          let jump_one_block_ledge = [
            ...range(-1, 2).map((x) => Record({ x: x, y: 0, z: -2 })),
            ...range(-1, 2).map((x) => Record({ x: x, y: 0, z: 2 })),
            ...range(-1, 2).map((z) => Record({ x: -2, y: 0, z: z })),
            ...range(-1, 2).map((z) => Record({ x: 2, y: 0, z: z })),
            Record({ x: -2, y: 0, z: -2 }),
            Record({ x: -2, y: 0, z: 2 }),
            Record({ x: 2, y: 0, z: -2 }),
            Record({ x: 2, y: 0, z: 2 }),
          ];

          let sides = [
            ...walking,
            ...jump_up_one_block,
            ...jump_down_one_block,
            ...jump_one_block_ledge,
          ];

          let path = a_star_basic({
            from: Record(vec3.floor(position)),
            to: Record(vec3.floor(walking_to)),
            neighbors: (node) => sides,
            distance: (from, to) => {
              return 1;
            },
            heuristic: (from, to) => {
              let dx = to.x - from.x;
              let dy = to.y - from.y;
              let dz = to.z - from.z;
              return Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2);
            },
          });

          console.log(`path:`, path);
          player.send(JSON.stringify(path));
        },
      }),
    ],
  };
}
