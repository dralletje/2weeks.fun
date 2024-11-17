import { describe, it } from "node:test";
import assert from "node:assert";
import { chunk, range, sumBy } from "lodash-es";
import fs from "fs/promises";
import {
  bytes,
  combined,
  mcp,
  native,
  prefilled,
  type ValueOfProtocol,
  type Protocol,
} from "../protocol.ts";
import { nbt } from "../nbt-read.ts";

let bigtest_url = new URL("./bigtest.nbt", import.meta.url);
let hello_world_url = new URL("./hello_world.nbt", import.meta.url);
let bigtest = new Uint8Array(await fs.readFile(bigtest_url.pathname));
let hello_world = new Uint8Array(await fs.readFile(hello_world_url));

let unzlib = async (buffer: Uint8Array) => {
  let ds = new DecompressionStream("deflate");
  let writer = ds.writable.getWriter();
  writer.write(buffer);
  writer.close();

  let result = new Uint8Array();
  for await (let chunk of ds.readable) {
    result = new Uint8Array([...result, ...chunk]);
  }

  return result;
};

let ungzip = async (buffer: Uint8Array) => {
  let ds = new DecompressionStream("gzip");
  let writer = ds.writable.getWriter();
  writer.write(buffer);
  writer.close();

  let result = new Uint8Array();
  for await (let chunk of ds.readable) {
    result = new Uint8Array([...result, ...chunk]);
  }

  return result;
};

describe("NBT", () => {
  it("should decode simple nbt", () => {
    let hello_world_uint8array = new Uint8Array(hello_world);
    let [x] = nbt.compound.standalone.decode(hello_world_uint8array);
    assert.deepStrictEqual(x, {
      name: "hello world",
      value: { entries: [{ name: "name", value: "Bananrama" }] },
    });
  });

  // it("should encode simple nbt", () => {
  //   let buffer = nbt_compound.encode(test_nbt_result);
  //   assert.deepStrictEqual(buffer, hello_world);
  // });

  it("should decode complex nbt", async () => {
    let [x] = nbt.any.standalone.decode(await ungzip(bigtest));
    // assert.deepStrictEqual(x, test_nbt_result);
  });

  // it("should encode simple nbt", () => {
  //   let buffer = nbt_compound.encode(test_nbt_result);
  //   assert.deepStrictEqual(buffer, hello_world);
  // });
});
