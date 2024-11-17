//   inventory$.set(
//     inventory$.get().toSpliced(1, 1, {
//       item: "minecraft:diamond_sword",
//       count: 1,
//       rarity: "epic",
//       lore: ["Excalibur"],
//     }) as any
//   );

import { registries } from "@2weeks/minecraft-data";
import { type Slot } from "../BasicPlayer.ts";
import { chat } from "../chat.ts";
import { Command, p, type Plugin_v1 } from "../Plugins/Plugin_v1.ts";

export default function give_plugin(): Plugin_v1 {
  return {
    commands: [
      Command({
        command: p.command`/give ${p.resource("item", "minecraft:item")}`,
        handle: ([item], { player }) => {
          if (!registries["minecraft:item"].entries[item]) {
            player.send(
              chat`${chat.light_purple(`* Unknown item`)} ${chat.red(item)}`
            );
          } else {
            player.hotbar$.set([
              { item, count: 1 },
              ...(player.hotbar$.get().slice(1) as [
                Slot,
                Slot,
                Slot,
                Slot,
                Slot,
                Slot,
                Slot,
                Slot,
              ]),
            ]);
            player.send(chat.green(`* Gave you ${item}`));
          }
        },
      }),
    ],
  };
}
