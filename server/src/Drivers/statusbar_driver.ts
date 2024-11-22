import { floor } from "lodash-es";
import { MinecraftPlaySocket } from "../MinecraftPlaySocket.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import { PlayPackets } from "../minecraft-protocol.ts";
import { type TextComponent } from "../protocol/text-component.ts";

export function makeStatusbarDriver({
  minecraft_socket,
}: {
  minecraft_socket: MinecraftPlaySocket;
}): Driver_v1<TextComponent | string | null | void> {
  return ({ effect, input$ }) => {
    effect(async () => {
      let statusbar_text = input$.get().filter((x) => x != null);
      if (statusbar_text.length === 0) {
        /// Nothing
      } else if (statusbar_text.length === 1) {
        minecraft_socket.send(
          PlayPackets.clientbound.set_action_bar_text.write({
            text: statusbar_text[0],
          })
        );
      } else {
        throw new Error("Expected at most one statusbar text");
      }
    });
  };
}
