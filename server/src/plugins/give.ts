//   inventory$.set(
//     inventory$.get().toSpliced(1, 1, {
//       item: "minecraft:diamond_sword",
//       count: 1,
//       rarity: "epic",
//       lore: ["Excalibur"],
//     }) as any
//   );

import { registries } from "@2weeks/minecraft-data";
import { type Slot } from "../PluginInfrastructure/BasicPlayer.ts";
import { chat } from "../utils/chat.ts";
import { c, command } from "../PluginInfrastructure/Commands_v1.ts";
import { type Plugin_v1 } from "../PluginInfrastructure/Plugin_v1.ts";

export default function give_plugin(): Plugin_v1 {
  return {
    commands: [
      command({
        command: c.command`/give ${c.resource("item", "minecraft:item")}`,
        handle: ([item], { player }) => {
          if (!registries["minecraft:item"].entries[item]) {
            player.send(
              chat`${chat.light_purple(`* Unknown item`)} ${chat.red(item)}`
            );
          } else {
            player.inventory.set_hotbar_slot(0, { item, count: 1 });
            player.send(chat.green(`* Gave you ${item}`));
          }
        },
      }),
    ],
  };
}
