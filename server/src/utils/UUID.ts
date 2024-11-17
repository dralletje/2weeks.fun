import { stringify as uuid_stringify, parse as uuid_parse } from "uuid";

let compact_uuid_to_bigint = (uuid: string) => {
  return BigInt(`0x${uuid}`);
};

export class UUID {
  bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    if (bytes.length !== 16) {
      this.bytes = new Uint8Array(16);
      this.bytes.set(bytes);
    } else {
      this.bytes = bytes;
    }
  }

  toBigInt() {
    let uuid = BigInt(0);
    for (let i = 0; i < 16; i++) {
      uuid = (uuid << BigInt(8)) | BigInt(this.bytes[i]);
    }
    return uuid;
  }
  toString() {
    return uuid_stringify(this.bytes);
  }

  static from_string(uuid: string) {
    // return new UUID(uuid_parse(uuid));
    let bytes = new Uint8Array(16);
    let parts = uuid.split("-");
    for (let i = 0; i < 16; i++) {
      bytes[i] = parseInt(parts[i], 16);
    }
    return new UUID(bytes);
  }

  static from_bigint(uuid: bigint) {
    let bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = Number((uuid >> BigInt(8 * (15 - i))) & BigInt(0xff));
    }
    return new UUID(bytes);
  }

  static from_compact(uuid: string) {
    return UUID.from_bigint(compact_uuid_to_bigint(uuid));
  }
}
