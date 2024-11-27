import { find_packet_name, packets } from "@2weeks/minecraft-data";
import { mapValues } from "lodash-es";
import { LockableEventEmitter } from "../packages/lockable-event-emitter.ts";
import { mcp } from "./mcp.ts";
import { combined, native } from "./protocol.ts";

type PacketsToListeners<
  Packets extends { [key: string]: { protocol_id: number } },
> = {
  [K in keyof Packets]: LockableEventEmitter<Uint8Array>;
};

export type DuplexStream<Read = Uint8Array, Write = Uint8Array> = {
  readable: ReadableStream<Read>;
  writable: WritableStream<Write>;
};

let packet_id_protocol = native.with_byte_length(
  mcp.varint,
  combined([
    { name: "packet_id", protocol: mcp.varint },
    { name: "payload", protocol: native.uint8array },
  ])
);

export class MinecraftPlaySocket {
  on_packet: PacketsToListeners<typeof packets.play.serverbound> = mapValues(
    packets.play.serverbound,
    () => new LockableEventEmitter<Uint8Array>()
  );

  send(packet: Uint8Array) {
    // try {
    //   let [{ packet_id }] = packet_id_protocol.decode(packet);
    //   let packet_name = find_packet_name({
    //     id: packet_id,
    //     state: "play",
    //     direction: "clientbound",
    //   });

    //   console.log(`SENDING packet_name:`, packet_name);
    // } catch {}

    this.#writer.write(packet);
  }

  #writer: WritableStreamDefaultWriter<Uint8Array>;
  constructor({ writer }: { writer: WritableStreamDefaultWriter<Uint8Array> }) {
    // let { readable, writable } = socket;
    // let reader = readable.pipeThrough(WithVarintLengthTransformStream()).getReader();
    // let writer = writable.getWriter();
    this.#writer = writer;
  }
}
