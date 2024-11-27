import chalk from "chalk";
import { PlayPackets } from "../protocol/minecraft-protocol.ts";
import { type MinecraftPlaySocket } from "../protocol/MinecraftPlaySocket.ts";
import { map_difference } from "../packages/immappable.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";

export type ResourcepackRequest = {
  // uuid: bigint;
  url: string;
  hash: string;
  forced: boolean;
  prompt: string;
  /// TODO way to communicate?
  //status$: Signal.State<"pending" | "accepted" | "declined">;
};

export let makeResourcepacksDriver = ({
  minecraft_socket,
}: {
  minecraft_socket: MinecraftPlaySocket;
}): Driver_v1<Map<bigint, ResourcepackRequest>> => {
  return ({ input$, signal, effect }) => {
    let _current_packs = new Map<bigint, ResourcepackRequest>();

    effect(async () => {
      let resourcepacks = new Map(
        input$.get().flatMap((x) => Array.from(x.entries()))
      );

      // if (_current_packs.size === 0) {
      //   minecraft_socket.send(
      //     PlayPackets.clientbound.resource_pack_pop.write({
      //       uuid: null,
      //     })
      //   );
      // }

      let { added, stayed, removed } = map_difference(
        _current_packs,
        resourcepacks
      );
      _current_packs = resourcepacks;
      // let current_packs = resourcepacks$.get();
      // let new_packs = differenceBy(current_packs, _current_packs, "uuid");
      // let removed_packs = differenceBy(_current_packs, current_packs, "uuid");

      for (let [uuid, pack] of removed) {
        minecraft_socket.send(
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
        console.log(
          `${chalk.blue("[PLAY]")} Resource pack response: ${uuid} ${status}`
        );
      },
      { signal: signal }
    );
  };
};
