import { type Vec3 } from "../../utils/vec3.ts";

export type BlockRecord<T extends Vec3 = Vec3> = T;

let block_map = new Map<string, Vec3>();
export let BlockRecord = <T extends Vec3>(value: T) => {
  let key = `${value.x},${value.y},${value.z}`;
  let val = block_map.get(key);
  if (val) {
    return val;
  } else {
    block_map.set(key, value);
    return value;
  }
};
