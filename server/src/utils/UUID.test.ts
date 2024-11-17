import { UUID } from "./UUID.ts";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("UUID", () => {
  it("should convert to and from string", () => {
    let uuid_string = "00000000-0000-0000-0000-000000000000";
    let uuid = UUID.from_string(uuid_string);
    let str = uuid.toString();
    assert.strictEqual(str, uuid_string);
  });

  it("should convert to and from string", () => {
    let uuid = UUID.from_compact("00000000000000000000000000000000");
    let str = uuid.toString();
    assert.strictEqual(str, "00000000-0000-0000-0000-000000000000");
  });
});
