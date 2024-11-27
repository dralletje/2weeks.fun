export type Vec2 = [number, number];

export let vec2 = {
  add: (a: Vec2, b: Vec2): Vec2 => {
    return [a[0] + b[0], a[1] + b[1]];
  },
  subtract: (from: Vec2, to: Vec2): Vec2 => {
    return [to[0] - from[0], to[1] - from[1]];
  },
  length: (a: Vec2) => {
    return Math.sqrt(a[0] * a[0] + a[1] * a[1]);
  },
  length2: (a: Vec2) => {
    return a[0] * a[0] + a[1] * a[1];
  },
};

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export let vec3 = {
  equals: (a: Vec3, b: Vec3, error = 0): boolean => {
    return (
      Math.abs(a.x - b.x) <= error &&
      Math.abs(a.y - b.y) <= error &&
      Math.abs(a.z - b.z) <= error
    );
  },
  add: (a: Vec3, b: Vec3): Vec3 => {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  },
  subtract: (a: Vec3, b: Vec3): Vec3 => {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  },
  difference: (from: Vec3, to: Vec3): Vec3 => {
    return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  },
  fromto: (from: Vec3, to: Vec3): Vec3 => {
    return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  },
  multiplyVec3: (a: Vec3, b: Vec3): Vec3 => {
    return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z };
  },
  multiply: (v: Vec3, n: number): Vec3 => {
    return { x: v.x * n, y: v.y * n, z: v.z * n };
  },
  length: (a: Vec3) => {
    return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  },
  length2: (a: Vec3) => {
    return a.x * a.x + a.y * a.y + a.z * a.z;
  },
  xz: (a: Vec3): Vec2 => {
    return [a.x, a.z];
  },
  lowhigh: (a: Vec3, b: Vec3): [Vec3, Vec3] => {
    return [
      { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
      { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
    ];
  },
  floor: (a: Vec3): Vec3 => {
    return { x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) };
  },
  normalize: (a: Vec3): Vec3 => {
    return vec3.multiply(a, 1 / vec3.length(a));
  },
  cross: (a: Vec3, b: Vec3): Vec3 => {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  },
  dot: (a: Vec3, b: Vec3): number => {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  },
  scale: (a: Vec3, n: number): Vec3 => {
    return { x: a.x * n, y: a.y * n, z: a.z * n };
  },

  NULL: { x: 0, y: 0, z: 0 },
};
