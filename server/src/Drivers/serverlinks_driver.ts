import { type MinecraftPlaySocket } from "../MinecraftPlaySocket.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import { type TextComponent } from "../protocol/text-component.ts";
import { type AnySignal, effectWithSignal } from "../signals.ts";
import { PlayPackets } from "../minecraft-protocol.ts";
import { modulo_cycle } from "../utils/modulo_cycle.ts";

export type Serverlink = {
  label:
    | {
        true:
          | "Bug Report"
          | "Community Guidelines"
          | "Support"
          | "Status"
          | "Feedback"
          | "Community"
          | "Website"
          | "Forums"
          | "News"
          | "Announcements";
      }
    | { false: TextComponent | string };
  url: string;
};

export let serverlinks_driver = ({
  minecraft_socket,
}: {
  minecraft_socket: MinecraftPlaySocket;
}): Driver_v1<Array<Serverlink>> => {
  return ({ input$, signal, effect }) => {
    effect(async () => {
      let links = input$.get().flat();
      minecraft_socket.send(
        PlayPackets.clientbound.server_links.write({
          links: links,
        })
      );
    });
  };
};