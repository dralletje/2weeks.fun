import { describe, it } from "node:test";
import assert from "node:assert";
import { bytes } from "./protocol.ts";
import { mcp } from "./mcp.ts";

describe("Position", () => {
  let WIKI_VG_BINARY =
    bytes.uint64.encode(
      0b0100011000000111011000110010110000010101101101001000001100111111n
    );
  let WIKI_VG_POSITION = { x: 18357644, y: 831, z: -20882616 };
  it("should decode example from wiki.vg", () => {
    let [position] = mcp.Position.decode(WIKI_VG_BINARY);
    assert.deepStrictEqual(position, WIKI_VG_POSITION);
  });
  it("should encode example from wiki.vg", () => {
    let buffer = mcp.Position.encode(WIKI_VG_POSITION);
    assert.deepStrictEqual(buffer, WIKI_VG_BINARY);
  });

  let WIKI_VG_BINARY_NON_NEGATIVE =
    bytes.uint64.encode(
      0b0000000000000000000000000100000000000000000000000001000000000001n
    );
  console.log(`WIKI_VG_BINARY_NON_NEGATIVE:`, WIKI_VG_BINARY_NON_NEGATIVE);
  let WIKI_VG_POSITION_NON_NEGATIVE = { x: 1, y: 1, z: 1 };
  it("should decode example from wiki.vg (non-negative)", () => {
    let [position] = mcp.Position.decode(WIKI_VG_BINARY_NON_NEGATIVE);
    assert.deepStrictEqual(position, WIKI_VG_POSITION_NON_NEGATIVE);
  });
  it("should encode example from wiki.vg (non-negative)", () => {
    let buffer = mcp.Position.encode(WIKI_VG_POSITION_NON_NEGATIVE);
    assert.deepStrictEqual(buffer, WIKI_VG_BINARY_NON_NEGATIVE);
  });

  // it("should encode and decode", () => {
  //   let position = { x: 1, y: 2, z: 3 };
  //   let buffer = mcp.Position.encode(position);
  //   let decoded = mcp.Position.decode(buffer);
  //   assert.deepStrictEqual(decoded, position);
  // });
});
