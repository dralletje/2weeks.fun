//   inventory$.set(
//     inventory$.get().toSpliced(1, 1, {
//       item: "minecraft:diamond_sword",
//       count: 1,
//       rarity: "epic",
//       lore: ["Excalibur"],
//     }) as any
//   );

import { chat } from "../../utils/chat.ts";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../../PluginInfrastructure/Plugin_v1.ts";
import { NumberCounter } from "../../utils/Unique.ts";
import { PlayPackets } from "../../protocol/minecraft-protocol.ts";
import { parse_png } from "./png.ts";
import { to_minecraft_map } from "./to_minecraft_map.ts";
import { c, command } from "../../PluginInfrastructure/Commands_v1.ts";

let map_id_counter = new NumberCounter();

let fetch_map = async (url: string) => {
  let response = await fetch(url);
  let header = await parse_png(response.body!);

  if (header.metadata.width !== 128 || header.metadata.height !== 128) {
    throw new Error("Invalid map size");
  }

  let data = await header.resume();
  return to_minecraft_map(data);
};

export default function map_plugin({ send_packet }: Plugin_v1_Args): Plugin_v1 {
  return {
    commands: [
      command({
        command: c.command`/map ${c.word("Url")}`,
        handle: async ([url], { player }) => {
          let data = await fetch_map(url);

          let map_id = map_id_counter.get_id();
          send_packet(
            PlayPackets.clientbound.map_item_data.write({
              map_id: map_id,
              scale: 4,
              locked: true,
              icons: [],
              columns: 128,
              rows: 128,
              x: 0,
              z: 0,
              data: data,
            })
          );

          player.inventory.set_hotbar_slot(0, {
            item: "minecraft:filled_map",
            count: 1,
            properties: {
              map_id: map_id,
            },
          });

          player.send(chat.green(`* Enjoy your map!`));
        },
      }),
    ],
  };
}
