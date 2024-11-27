import { type MinecraftPlaySocket } from "../protocol/MinecraftPlaySocket.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import { type TextComponent } from "../protocol/text-component.ts";
import { PlayPackets } from "../protocol/minecraft-protocol.ts";

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
}): Driver_v1<Array<Serverlink>, void> => {
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
