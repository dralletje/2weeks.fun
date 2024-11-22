export type Position = {
  x: number;
  y: number;
  z: number;
};

export type EntityPosition = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type CardinalDirection = "north" | "south" | "east" | "west";

export type CardinalDirectionWithHalf =
  | CardinalDirection
  | "northwest"
  | "northeast"
  | "southwest"
  | "southeast";
