// const re = /\((-?[.\d]+), (-?[.\d]+), (-?[.\d]+)\)/

import { subtract } from "lodash-es";

// class Vec3 {
//   constructor (x, y, z) {
//     this.x = x
//     this.y = y
//     this.z = z
//   }

//   isZero () {
//     return this.x === 0 && this.y === 0 && this.z === 0
//   }

//   at (id) {
//     return this.toArray()[id]
//   }

//   xz () {
//     return [this.x, this.z]
//   }

//   xy () {
//     return [this.x, this.y]
//   }

//   yz () {
//     return [this.y, this.z]
//   }

//   xzy () {
//     return new Vec3(this.x, this.z, this.y)
//   }

//   set (x, y, z) {
//     this.x = x
//     this.y = y
//     this.z = z
//     return this
//   }

//   update (other) {
//     this.x = other.x
//     this.y = other.y
//     this.z = other.z
//     return this
//   }

//   rounded () {
//     return new Vec3(Math.round(this.x), Math.round(this.y), Math.round(this.z))
//   }

//   round () {
//     this.x = Math.round(this.x)
//     this.y = Math.round(this.y)
//     this.z = Math.round(this.z)
//     return this
//   }

//   floored () {
//     return new Vec3(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))
//   }

//   floor () {
//     this.x = Math.floor(this.x)
//     this.y = Math.floor(this.y)
//     this.z = Math.floor(this.z)
//     return this
//   }

//   offset (dx, dy, dz) {
//     return new Vec3(this.x + dx, this.y + dy, this.z + dz)
//   }

//   translate (dx, dy, dz) {
//     this.x += dx
//     this.y += dy
//     this.z += dz
//     return this
//   }

//   add (other) {
//     this.x += other.x
//     this.y += other.y
//     this.z += other.z
//     return this
//   }

//   subtract (other) {
//     this.x -= other.x
//     this.y -= other.y
//     this.z -= other.z
//     return this
//   }

//   multiply (other) {
//     this.x *= other.x
//     this.y *= other.y
//     this.z *= other.z
//     return this
//   }

//   divide (other) {
//     this.x /= other.x
//     this.y /= other.y
//     this.z /= other.z
//     return this
//   }

//   plus (other) {
//     return this.offset(other.x, other.y, other.z)
//   }

//   minus (other) {
//     return this.offset(-other.x, -other.y, -other.z)
//   }

//   scaled (scalar) {
//     return new Vec3(this.x * scalar, this.y * scalar, this.z * scalar)
//   }

//   abs () {
//     return new Vec3(Math.abs(this.x), Math.abs(this.y), Math.abs(this.z))
//   }

//   volume () {
//     return this.x * this.y * this.z
//   }

//   modulus (other) {
//     return new Vec3(
//       euclideanMod(this.x, other.x),
//       euclideanMod(this.y, other.y),
//       euclideanMod(this.z, other.z))
//   }

//   distanceTo (other) {
//     const dx = other.x - this.x
//     const dy = other.y - this.y
//     const dz = other.z - this.z
//     return Math.sqrt(dx * dx + dy * dy + dz * dz)
//   }

//   distanceSquared (other) {
//     const dx = other.x - this.x
//     const dy = other.y - this.y
//     const dz = other.z - this.z
//     return dx * dx + dy * dy + dz * dz
//   }

//   equals (other, error = 0) {
//     return Math.abs(this.x - other.x) <= error &&
//       Math.abs(this.y - other.y) <= error &&
//       Math.abs(this.z - other.z) <= error
//   }

//   toString () {
//     return '(' + this.x + ', ' + this.y + ', ' + this.z + ')'
//   }

//   clone () {
//     return this.offset(0, 0, 0)
//   }

//   min (other) {
//     return new Vec3(Math.min(this.x, other.x), Math.min(this.y, other.y), Math.min(this.z, other.z))
//   }

//   max (other) {
//     return new Vec3(Math.max(this.x, other.x), Math.max(this.y, other.y), Math.max(this.z, other.z))
//   }

//   norm () {
//     return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
//   }

//   dot (other) {
//     return this.x * other.x + this.y * other.y + this.z * other.z
//   }

//   cross (other) {
//     return new Vec3(this.y * other.z - this.z * other.y, this.z * other.x - this.x * other.z, this.x * other.y - this.y * other.x)
//   }

//   unit () {
//     const norm = this.norm()
//     if (norm === 0) {
//       return this.clone()
//     } else {
//       return this.scaled(1 / norm)
//     }
//   }

//   normalize () {
//     const norm = this.norm()
//     if (norm !== 0) {
//       this.x /= norm
//       this.y /= norm
//       this.z /= norm
//     }
//     return this
//   }

//   scale (scalar) {
//     this.x *= scalar
//     this.y *= scalar
//     this.z *= scalar
//     return this
//   }

//   xyDistanceTo (other) {
//     const dx = other.x - this.x
//     const dy = other.y - this.y
//     return Math.sqrt(dx * dx + dy * dy)
//   }

//   xzDistanceTo (other) {
//     const dx = other.x - this.x
//     const dz = other.z - this.z
//     return Math.sqrt(dx * dx + dz * dz)
//   }

//   yzDistanceTo (other) {
//     const dy = other.y - this.y
//     const dz = other.z - this.z
//     return Math.sqrt(dy * dy + dz * dz)
//   }

//   innerProduct (other) {
//     return this.x * other.x + this.y * other.y + this.z * other.z
//   }

//   manhattanDistanceTo (other) {
//     return Math.abs(other.x - this.x) + Math.abs(other.y - this.y) + Math.abs(other.z - this.z)
//   }

//   toArray () {
//     return [this.x, this.y, this.z]
//   }
// }

// function v (x, y, z) {
//   if (x == null) {
//     return new Vec3(0, 0, 0)
//   } else if (Array.isArray(x)) {
//     return new Vec3(parseFloat(x[0]), parseFloat(x[1]), parseFloat(x[2]))
//   } else if (typeof x === 'object') {
//     return new Vec3(parseFloat(x.x), parseFloat(x.y), parseFloat(x.z))
//   } else if (typeof x === 'string' && y == null) {
//     const match = x.match(re)
//     if (match) {
//       return new Vec3(
//         parseFloat(match[1]),
//         parseFloat(match[2]),
//         parseFloat(match[3]))
//     } else {
//       throw new Error('vec3: cannot parse: ' + x)
//     }
//   } else {
//     return new Vec3(parseFloat(x), parseFloat(y), parseFloat(z))
//   }
// }

// function euclideanMod (numerator, denominator) {
//   const result = numerator % denominator
//   return result < 0 ? result + denominator : result
// }

// module.exports = v
// v.Vec3 = Vec3

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
  add: (a: Vec3, b: Vec3): Vec3 => {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  },
  subtract: (from: Vec3, to: Vec3): Vec3 => {
    return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  },
  difference: (from: Vec3, to: Vec3): Vec3 => {
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
};
