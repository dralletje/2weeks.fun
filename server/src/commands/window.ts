import { registries } from "@2weeks/minecraft-data";
import { type CommandNode, type CommandParser } from "../protocol/brigadier.ts";
import { isEmpty } from "lodash-es";
import {
  Command,
  p,
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../Plugins/Plugin_v1.ts";
import { chat } from "../chat.ts";
import { NumberCounter } from "../Unique.ts";
import { PlayPackets } from "../minecraft-protocol.ts";

let MENUS = registries["minecraft:menu"].entries;

let window_id_counter = new NumberCounter();

// let _1 = p.command`/window open ${p.resource("Window name", "minecraft:menu")}`;
// let _2 = p.command`/window open ${p.resource("Window name", "minecraft:menu")} ${p.rest("Title")}`;
// let command = `/window open anvil:thing WOOOOOO`;

export default function window_plugin({
  send_packet,
}: Plugin_v1_Args): Plugin_v1 {
  return {
    commands: [
      Command({
        command: p.command`/window open ${p.resource("Window name", "minecraft:menu")}`,
        handle: async ([resource_name], { player }) => {
          let menu_id = MENUS[resource_name]?.protocol_id;
          if (menu_id == null) {
            // prettier-ignore
            player.send(chat`${chat.dark_purple("* Menu not found:")} ${resource_name}`);
            return;
          }

          let window_id = window_id_counter.get_id();

          send_packet(
            PlayPackets.clientbound.open_screen.write({
              window_id: window_id,
              screen: menu_id,
              title: "Untitled Window",
            })
          );
        },
      }),
      Command({
        command: p.command`/window open ${p.resource("Window name", "minecraft:menu")} ${p.rest("Title")}`,
        handle: async ([resource_name, title], { player }) => {
          let menu_id = MENUS[resource_name]?.protocol_id;
          if (menu_id == null) {
            // prettier-ignore
            player.send(chat`${chat.dark_purple("* Menu not found:")} ${resource_name}`);
            return;
          }

          let window_id = window_id_counter.get_id();

          send_packet(
            PlayPackets.clientbound.open_screen.write({
              window_id: window_id,
              screen: menu_id,
              title: title,
            })
          );
        },
      }),
    ],
  };
}
