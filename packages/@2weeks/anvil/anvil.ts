import { Anvil as AnvilForVersion } from "prismarine-provider-anvil";
import anvil_loader from "prismarine-provider-anvil";
import fs from "node:fs";

let AnvilApi = AnvilForVersion("1.21.1");

export let anvil = async (path: string) => {
  let anvil = new AnvilApi(`${path}/region`);

  let level2 = await anvil_loader.level.readLevel(`${path}/level.dat`);

  console.log(`level2:`, level2);

  const [, xStr, zStr] = fs
    .readdirSync(`${path}/region`)[0]
    .match(/r\.(-?\d+)\.(-?\d+)\.mca/);
  const [x, z] = [+xStr, zStr];
  const chunks = await anvil.getAllChunksInRegion(x, z);
};

// console.log(`chunks:`, chunks);

// console.log(`anvil:`, await anvil.load(0, 0));
