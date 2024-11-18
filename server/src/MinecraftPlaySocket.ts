import { mapValues } from "lodash-es";
import { LockableEventEmitter } from "./packages/lockable-event-emitter.ts";
import { packets } from "@2weeks/minecraft-data";

type PacketsToListeners<
  Packets extends { [key: string]: { protocol_id: number } },
> = {
  [K in keyof Packets]: LockableEventEmitter<Uint8Array>;
};

export type DuplexStream<Read = Uint8Array, Write = Uint8Array> = {
  readable: ReadableStream<Read>;
  writable: WritableStream<Write>;
};

export class MinecraftPlaySocket {
  on_packet: PacketsToListeners<typeof packets.play.serverbound> = mapValues(
    packets.play.serverbound,
    () => new LockableEventEmitter<Uint8Array>()
  );

  send(packet: Uint8Array) {
    this.writer.write(packet);
  }

  /** @deprecated idk looks ugly, use `.send(packet)` */
  write(packet: Uint8Array) {
    this.writer.write(packet);
  }

  writer: WritableStreamDefaultWriter<Uint8Array>;
  constructor({ writer }: { writer: WritableStreamDefaultWriter<Uint8Array> }) {
    // let { readable, writable } = socket;
    // let reader = readable.pipeThrough(WithVarintLengthTransformStream()).getReader();
    // let writer = writable.getWriter();
    this.writer = writer;
  }
}
