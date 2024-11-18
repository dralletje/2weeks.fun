import { PNG, type Metadata } from "pngjs";
import { Readable } from "stream";
import { ReadableStream } from "stream/web";

export let parse_png = async (
  stream: ReadableStream,
  {
    signal,
    options,
  }: ConstructorParameters<typeof PNG>[0] & {
    signal?: AbortSignal;
  } = {}
) => {
  let node_stream = Readable.fromWeb(stream, {
    signal: signal,
  });
  let png = node_stream.pipe(new PNG(options));

  let metadata = await new Promise<Metadata>((resolve, reject) => {
    png.on("metadata", function (metadata) {
      resolve(metadata);
    });
    png.on("error", (error) => {
      reject(error);
    });
  });

  node_stream.pause();

  let destroyed = false;

  return {
    metadata,
    get destroyed() {
      return destroyed;
    },
    async destroy() {
      destroyed = true;
      node_stream.destroy();
    },
    async resume() {
      if (destroyed) {
        throw new Error("Already disposed this png stream");
      }

      node_stream.resume();
      return await new Promise<Uint8Array>((resolve, reject) => {
        png.on("parsed", () => {
          resolve(new Uint8Array(png.data.buffer));
        });
        png.on("error", (error) => {
          reject(error);
        });
      });
    },
  };
};
