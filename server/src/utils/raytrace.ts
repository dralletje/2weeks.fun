import { isEqual, sortBy } from "lodash-es";
import {
  type Face,
  type Position,
} from "../PluginInfrastructure/MinecraftTypes.ts";
import { type World } from "../PluginInfrastructure/World.ts";
import { vec3, type Vec3 } from "./vec3.ts";

/// This can be improved...
let raytrace_iterator = function* (
  from: Vec3,
  direction: Vec3,
  max_distance: number
) {
  let distance = vec3.length(direction);
  let normalized_direction = vec3.normalize(direction);

  let step = 0.01;

  for (let i = 0; i < max_distance; i += step) {
    let point = vec3.add(from, vec3.multiply(normalized_direction, i));
    yield point;
  }
};

/// TODO......?????? Take blockmodels into account

export let get_block_in_sight = ({
  world,
  origin,
  direction,
  max_distance,
}: {
  world: World;
  origin: Vec3;
  direction: Vec3;
  max_distance: number;
}) => {
  let last_block = vec3.floor(origin);
  let block_found: Position | null = null;
  let point_found: Vec3 | null = null;
  for (let point of raytrace_iterator(origin, direction, 4.5)) {
    let block = vec3.floor(point);
    if (isEqual(block, last_block)) continue;
    last_block = block;

    let x = world.get_block({ position: block });
    if (
      x.block.definition.type !== "minecraft:air" &&
      x.block.definition.type !== "minecraft:liquid"
    ) {
      point_found = point;
      block_found = block;
      break;
    }
  }

  if (block_found == null || point_found == null) {
    return null;
  }

  let x1 = (block_found.x - point_found.x) / direction.x;
  let x2 = (block_found.x + 1 - point_found.x) / direction.x;

  let x21 = vec3.add(point_found, vec3.multiply(direction, x1));
  let x22 = vec3.add(point_found, vec3.multiply(direction, x2));

  let y1 = (block_found.y - point_found.y) / direction.y;
  let y2 = (block_found.y + 1 - point_found.y) / direction.y;

  let y21 = vec3.add(point_found, vec3.multiply(direction, y1));
  let y22 = vec3.add(point_found, vec3.multiply(direction, y2));

  let z1 = (block_found.z - point_found.z) / direction.z;
  let z2 = (block_found.z + 1 - point_found.z) / direction.z;

  let z21 = vec3.add(point_found, vec3.multiply(direction, z1));
  let z22 = vec3.add(point_found, vec3.multiply(direction, z2));

  let X_MIN_1 = { x: -1, y: 0, z: 0 };
  let Y_MIN_1 = { x: 0, y: -1, z: 0 };
  let Z_MIN_1 = { x: 0, y: 0, z: -1 };

  let possible_faces = [
    {
      face: "west",
      pos: x21,
      block: vec3.floor(x21),
    },
    {
      face: "east",
      pos: x22,
      block: vec3.add(vec3.floor(x22), X_MIN_1),
    },
    {
      face: "bottom",
      pos: y21,
      block: vec3.floor(y21),
    },
    {
      face: "top",
      pos: y22,
      block: vec3.add(vec3.floor(y22), Y_MIN_1),
    },
    {
      face: "north",
      pos: z21,
      block: vec3.floor(z21),
    },
    {
      face: "south",
      pos: z22,
      block: vec3.add(vec3.floor(z22), Z_MIN_1),
    },
  ];

  let still_possible = possible_faces.filter(({ block }) =>
    isEqual(block, block_found)
  );

  let still_still_possible = still_possible.filter(({ pos }) => {
    /// Is in the same direction
    let diff = vec3.difference(pos, point_found);
    let dot = vec3.dot(direction, diff);
    return dot > 0;
  });

  if (still_still_possible.length === 0) {
    return null;
  }

  let most_possible = sortBy(still_still_possible, ({ pos }) =>
    vec3.length(vec3.difference(pos, point_found))
  )[0];

  return {
    block: block_found,
    point: point_found,
    pos: most_possible.pos,
    face: most_possible.face as Face,
  };
};