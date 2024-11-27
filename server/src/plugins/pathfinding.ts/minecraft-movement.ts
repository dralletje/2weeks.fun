import { vec3, type Vec3 } from "../../utils/vec3.ts";

export type MinecraftMover = {
  velocity: Vec3;
  ticks_till_jump: number;
  last_tick_had_ground: boolean;
};

export type KeyboardState = {
  direction: Vec3;
  movement: "walking" | "sprinting" | "sneaking" | "stopping";
  on_ground: boolean;
  jump: boolean;
};

export let INITIAL_MOVER = {
  velocity: { x: 0, y: 0, z: 0 },
  ticks_till_jump: 0,
  last_tick_had_ground: false,
};

let MOVE: { [key in KeyboardState["movement"]]: number } = {
  sprinting: 1.3,
  walking: 1,
  sneaking: 0.3,
  stopping: 0,
};
/// Something about "strafing"
let NOT_STRAFING = 0.98;

export let move = (
  { velocity, ticks_till_jump, last_tick_had_ground }: MinecraftMover,
  input: KeyboardState
): MinecraftMover => {
  // console.log(`MOVE velocity:`, velocity);
  // console.log(`MOVE input:`, input);

  let direction = vec3.normalize({
    x: input.direction.x,
    y: 0,
    z: input.direction.z,
  });
  let horizontal_velocity = {
    x: velocity.x,
    y: 0,
    z: velocity.z,
  };
  let vertical_velocity = {
    x: 0,
    y: velocity.y,
    z: 0,
  };

  let movement_multiplier = MOVE[input.movement];

  if (input.jump) {
    console.log(`ticks_till_jump:`, ticks_till_jump);
    console.log(`input.on_ground:`, input.on_ground);
    console.log(`last_tick_had_ground:`, last_tick_had_ground);
  }

  if (
    input.jump &&
    ticks_till_jump <= 0 &&
    (input.on_ground || last_tick_had_ground)
  ) {
    let momentum = vec3.multiply(horizontal_velocity, 0.91);
    let acceleration = vec3.multiply(
      vec3.multiply(direction, movement_multiplier * NOT_STRAFING),
      0.1
    );

    console.log("JUMP!!!");

    let jump_acceleration = { x: 0, y: 0.42, z: 0 };

    let sprint_bonus =
      input.movement === "sprinting" ?
        vec3.multiply(direction, 0.2)
      : vec3.NULL;

    console.log(`sprint_bonus:`, sprint_bonus);

    return {
      velocity: vec3.add(
        momentum,
        vec3.add(vec3.add(acceleration, jump_acceleration), sprint_bonus)
      ),
      ticks_till_jump: 10,
      last_tick_had_ground: true,
    };
  } else if (input.on_ground) {
    let momentum = vec3.multiply(horizontal_velocity, 0.546);
    let acceleration = vec3.multiply(
      vec3.multiply(direction, movement_multiplier * NOT_STRAFING),
      0.1
    );

    // console.log(`momentum:`, momentum);
    // console.log(`acceleration:`, acceleration);

    return {
      velocity: vec3.add(momentum, acceleration),
      ticks_till_jump: ticks_till_jump - 1,
      last_tick_had_ground: true,
    };
  } else {
    console.log(`IN AIR`);
    /// Air velocity & gravity & drag
    let momentum = vec3.multiply(horizontal_velocity, 0.91);
    let acceleration = vec3.multiply(
      vec3.multiply(direction, movement_multiplier * NOT_STRAFING),
      0.02
    );
    let y_velocity = vec3.multiply(
      vec3.add(vertical_velocity, { x: 0, y: -0.08, z: 0 }),
      0.98
    );
    let velocity = vec3.add(vec3.add(momentum, acceleration), y_velocity);
    return {
      velocity: velocity,
      ticks_till_jump: ticks_till_jump - 1,
      last_tick_had_ground: false,
    };
  }
};
