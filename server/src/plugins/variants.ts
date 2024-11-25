import { Signal } from "signal-polyfill";
import {
  c,
  command,
  CommandError,
} from "../PluginInfrastructure/Commands_v1.ts";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { chat } from "../utils/chat.ts";
import { type BlockDefinition, blocks } from "@2weeks/minecraft-data";
import { type Slot } from "../BasicPlayer.ts";
import { error } from "../utils/error.ts";

let create_variants = (block: BlockDefinition) => {
  let variants: Array<{ [key: string]: string }> = [{}];

  if (block.properties == null) {
    throw new Error("Block does not have properties");
  }

  for (let [key, values] of Object.entries(block.properties)) {
    variants = variants.flatMap((variant) => {
      return values.map((value) => {
        return { ...variant, [key]: value };
      });
    });
  }

  return variants;
};

export default function variants_plugin({
  windows_v1,
  player,
}: Plugin_v1_Args): Plugin_v1 {
  return {
    commands: [
      command({
        command: c.command`/variants`,
        handle: ([]) => {
          let current_item =
            player.inventory.item_holding ??
            error(new CommandError("No item in hand"));
          let block =
            blocks[current_item.item] ??
            error(new CommandError("Item in hand is not a block"));
          if (block.properties == null) {
            throw new CommandError("Block does not have any variants");
          }

          let default_variant =
            block.states.find((state) => state.default) ??
            error(new CommandError("Block does not have a default state"));
          let default_variant_properties = default_variant.properties ?? {};
          // let default_variant_properties = {};

          let variants = create_variants(block);

          windows_v1.open(({ signal, on_action }) => {
            let state$ = new Signal.State<{
              inventory: Slot[];
              carried_item: Slot | null;
            }>({ inventory: [], carried_item: null });

            on_action.on(
              (event) => {
                state$.set({
                  inventory: state$.get().inventory,
                  carried_item: event.carried_item,
                });
              },
              { signal: signal }
            );

            let x = current_item.item.split(":").at(-1);

            let variants_as_items = variants.map((variant) => {
              let differences_from_default = Object.entries(variant).filter(
                ([key, value]) => {
                  return default_variant_properties[key] !== value;
                }
              );
              let title =
                differences_from_default.length === 0
                  ? ""
                  : chat.gray`[${differences_from_default.map(
                      ([key, value], index, array) => {
                        return chat.gray`${chat.white(key)}=${chat.red(value)}${index === array.length - 1 ? "" : ","}`;
                      }
                    )}]`;

              return {
                item: current_item.item,
                count: 1,
                properties: {
                  lore: Object.entries(variant).map(([key, value]) => {
                    if (variant[key] === default_variant_properties[key]) {
                      return chat`${key}: ${chat.yellow(value)}`;
                    } else {
                      return chat`${key}: ${chat.red(value)}`;
                    }
                  }),
                  custom_name: chat`${{ translate: `block.minecraft.${x}` }} ${title}`,
                  custom_data: {
                    block_properties: variant,
                  },
                },
              } as Slot;
            });

            return new Signal.Computed(() => {
              return {
                title: "Variants",
                type: "minecraft:generic_9x6",
                inventory: variants_as_items,
                carried_item: state$.get().carried_item,
              };
            });
          });
        },
      }),
    ],
  };
}
