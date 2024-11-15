import { sumBy } from "lodash-es";
import { decode_varint } from "./varint.ts";
import { encode_combined } from "./Protocol.ts";

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
      let [size, offset] = decode_varint(this.#buffer[0]);
      let combined_size = sumBy(this.#buffer, (x) => x.byteLength);
      if (combined_size >= size + offset) {
        let combined = encode_combined(this.#buffer);
        controller.enqueue(combined.subarray(offset, offset + size));

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
