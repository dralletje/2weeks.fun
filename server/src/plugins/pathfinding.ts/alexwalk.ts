import { Signal } from "signal-polyfill";
import { type AnySignal, async_computed } from "../../utils/signals.ts";
import { type Vec3, vec3 } from "../../utils/vec3.ts";
import { isEqual } from "lodash-es";
import { World } from "../../PluginInfrastructure/World.ts";
import { type Position } from "../../PluginInfrastructure/MinecraftTypes.ts";
import { BlockRecord } from "./shared.ts";
import { a_star_async } from "./a-star.ts";

/**
 * Pathfinding algorithm based on A*.
 * Trying to make it feel as natural as possible.
 *
 * Current implementation is to find a path that a minecraft player can walk.
 *
 * - https://www.gamedeveloper.com/programming/toward-more-realistic-pathfinding
 */

/// Normalized form of notating movement:
/// x is always the highest or the horizontal movements
/// Then gets "expanded" like this:
/// IN: { x: X, y: Y, z: Z }
/// OUT: [
///   { x: X, y: Y, z: Z },
///   { x: X, y: Y, z: -Z },
///   { x: -X, y: Y, z: Z },
///   { x: -X, y: Y, z: -Z },
///   { x: Z, y: Y, z: X },
///   { x: Z, y: Y, z: -X },
///   { x: -Z, y: Y, z: X },
///   { x: -Z, y: Y, z: -X },
///   { x: X, y: -Y, z: Z },
///   { x: X, y: -Y, z: -Z },
///   { x: -X, y: -Y, z: Z },
///   { x: -X, y: -Y, z: -Z },
///   { x: Z, y: -Y, z: X },
///   { x: Z, y: -Y, z: -X },
///   { x: -Z, y: -Y, z: X },
///   { x: -Z, y: -Y, z: -X },
/// ]

/// Also, we assume for now you only want to go where
/// you can get back from, so all ups have a corresponding down, but not the other way around
let expand_movement_options = (
  { x, y, z }: Vec3,
  penalty_fn: PenaltyFunction
): Array<[BlockRecord<Vec3>, (from: Vec3, to: Vec3) => number]> => {
  if (z > x) {
    throw new Error(`z > x in movement: { x: ${x}, y: ${y}, z: ${z} }`);
  }
  if (y < 0) {
    throw new Error(`y < 0 in movement: { x: ${x}, y: ${y}, z: ${z} }`);
  }

  return [
    [
      BlockRecord({ x: x, y: y, z: z }),
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
      BlockRecord({ x: x, y: y, z: -z }),
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
      BlockRecord({ x: -x, y: y, z: z }),
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
      BlockRecord({ x: -x, y: y, z: -z }),
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
      BlockRecord({ x: z, y: y, z: x }),
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
      BlockRecord({ x: z, y: y, z: -x }),
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
      BlockRecord({ x: -z, y: y, z: x }),
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
      BlockRecord({ x: -z, y: y, z: -x }),
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
      BlockRecord({ x: x, y: -y, z: z }),
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
      BlockRecord({ x: x, y: -y, z: -z }),
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
      BlockRecord({ x: -x, y: -y, z: z }),
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
      BlockRecord({ x: -x, y: -y, z: -z }),
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
      BlockRecord({ x: z, y: -y, z: x }),
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
      BlockRecord({ x: z, y: -y, z: -x }),
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
      BlockRecord({ x: -z, y: -y, z: x }),
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
      BlockRecord({ x: -z, y: -y, z: -x }),
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
  let movements = new Map<BlockRecord<Vec3>, (from: Vec3, to: Vec3) => number>(
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
    ).flatMap(([movement, penalty_fn]) =>
      expand_movement_options(movement, penalty_fn)
    )
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

      let delta = BlockRecord(vec3.difference(from, to));
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

    return a_star_async({
      from: BlockRecord(vec3.floor(from)),
      to: BlockRecord(vec3.floor(to)),
      neighbors: (node) => {
        return sides.map((x) => BlockRecord(vec3.add(node, x)));
      },
      distance: (from, to) => {
        return score_from_to(from, to);
      },
      heuristic: (from, goal) => {
        let distance = vec3.difference(from, goal);
        /// Up and down is more expensive, so that should be praised
        return vec3.length(distance) + distance.y;
      },

      // key: (node) => `${node.x},${node.y},${node.z}`,
      limit: limit,
      tick_limit: 10,
      signal: a_star_signal,
    });
  });

  return path$;
};
