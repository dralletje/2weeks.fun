import { sumBy } from "lodash-es";
import { type Transformer } from "node:stream/web";
import { mcp } from "./mcp.ts";

let concat = (buffers: Array<Uint8Array>) => {
  let length = sumBy(buffers, (buffer) => buffer.length);
  let result = new Uint8Array(length);
  let offset = 0;
  for (let buffer of buffers) {
    result.set(buffer, offset);
    offset = offset + buffer.length;
  }
  return result;
};

/**
 * Similar to the one in @weeks/binary-protocol,
 * but this one does not cut off the lengths from the packets.
 * This does mean that you need to re-parse the packets every time,
 * but it also means we can pipe through this repeatedly, and "don't lose any bytes"
 */

class WithVarintLengthTransformer
  implements Transformer<Uint8Array, Uint8Array>
{
  #buffer: Array<Uint8Array> = [];

  transform(
    chunk: Uint8Array,
    controller: TransformStreamDefaultController<Uint8Array>
  ) {
    if (chunk.length === 0) {
      return;
    }

    this.#buffer.push(chunk);

    while (this.#buffer.length > 0) {
      let [size, offset] = mcp.varint.decode(this.#buffer[0]);
      let combined_size = sumBy(this.#buffer, (x) => x.byteLength);
      if (combined_size >= size + offset) {
        let combined = concat(this.#buffer);
        controller.enqueue(combined.subarray(0, offset + size));

        if (combined.byteLength === size + offset) {
          this.#buffer = [];
          continue;
        } else if (combined.byteLength > size + offset) {
          this.#buffer = [combined.subarray(offset + size)];
          continue;
        } else {
          throw new Error("Defensive programming I guess");
        }
      } else {
        break;
      }
    }
  }
  flush(controller: TransformStreamDefaultController<Uint8Array>) {
    // controller.enqueue(encode_combined(this.#buffer));
    if (this.#buffer.length > 0) {
      console.log(`this.#buffer:`, this.#buffer);
      throw new Error("Packet not complete");
    }
  }
}

export let WithVarintLengthTransformStream = () => {
  return new TransformStream<Uint8Array, Uint8Array>(
    new WithVarintLengthTransformer()
  );
};
