import { chunk } from "lodash-es";

export let hex_to_uint8array = (hex: string) => {
  let clustered = chunk(hex.replaceAll(/[^0-9A-Fa-f]/g, ""), 2);
  let bytes = clustered.map((byte) => parseInt(byte.join(""), 16));
  return new Uint8Array(bytes);
};

export let uint8array_as_hex = (buffer: Uint8Array) => {
  return Array.from(buffer)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
};
