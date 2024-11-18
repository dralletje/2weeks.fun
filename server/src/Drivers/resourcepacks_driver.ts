import chalk from "chalk";
import { PlayPackets } from "../minecraft-protocol.ts";
import { type MinecraftPlaySocket } from "../MinecraftPlaySocket.ts";
import { map_difference } from "../packages/immappable.ts";
import { type AnySignal, effectWithSignal } from "../signals.ts";

export type ResourcepackRequest = {
  // uuid: bigint;
  url: string;
  hash: string;
  forced: boolean;
  prompt: string;
  /// TODO way to communicate?
  //status$: Signal.State<"pending" | "accepted" | "declined">;
};

export let resourcepacks_driver = ({
  resourcepacks$,
  minecraft_socket,
  signal,
}: {
  resourcepacks$: AnySignal<Map<bigint, ResourcepackRequest>>;
  minecraft_socket: MinecraftPlaySocket;
  signal: AbortSignal;
}) => {
  let _current_packs = new Map<bigint, ResourcepackRequest>();

  effectWithSignal(signal, async () => {
    let { added, stayed, removed } = map_difference(
      _current_packs,
      resourcepacks$.get()
    );
    _current_packs = resourcepacks$.get();
    // let current_packs = resourcepacks$.get();
    // let new_packs = differenceBy(current_packs, _current_packs, "uuid");
    // let removed_packs = differenceBy(_current_packs, current_packs, "uuid");

    for (let [uuid, pack] of removed) {
      await minecraft_socket.send(
        PlayPackets.clientbound.resource_pack_pop.write({
          uuid: uuid,
        })
      );
    }
    for (let [uuid, pack] of added) {
      minecraft_socket.send(
        PlayPackets.clientbound.resource_pack_push.write({
          uuid: uuid,
          url: pack.url,
          hash: pack.hash,
          forced: pack.forced,
          prompt: pack.prompt,
        })
      );
    }
  });

  minecraft_socket.on_packet["minecraft:resource_pack"].on(
    (packet) => {
      let { uuid, status } =
        PlayPackets.serverbound.resource_pack_response.read(packet);
      console.log(`${chalk.blue("[PLAY]")} Resource pack response: ${status}`);
    },
    { signal: signal }
  );
};
