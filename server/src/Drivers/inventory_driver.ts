import { type MinecraftPlaySocket } from "../MinecraftPlaySocket.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import {
  PlayPackets,
  type SlotProtocolResult,
} from "../protocol/minecraft-protocol.ts";
import {
  slot_data_to_slot,
  slot_to_packetable,
  type Slot,
} from "../BasicPlayer.ts";
import { Signal } from "signal-polyfill";
import { type AnySignal } from "../signals.ts";
import chalk from "chalk";
import { uint8array_as_hex } from "../utils/hex-x-uint8array.ts";
import { MutableSurvivalInventory } from "../play.ts";

type SlotContent = Slot | null;
export type PlayerInventory = [
  /// 0-4: Crafting area (can a player store stuff here?)
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,

  /// 5-8: Armor slots
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,

  /// 9-35: Main inventory
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,

  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,

  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,

  /// 36-44: Hotbar
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,
  SlotContent,

  /// 45: Offhand
  SlotContent,
];

export type InventoryDriverData = {
  player_inventory: Array<SlotContent>;
  selected_slot: number;
};

// export type InventoryDriverOuput = {
//   hotbar$: AnySignal<HotbarInventory>;
//   selected_hotbar_slot$: AnySignal<number>;

//   set_hotbar_slot: (slot: number, item: SlotContent) => void;
//   set_selected_hotbar_slot: (slot: number) => void;
// };
export type InventoryDriverOuput = void;

let EMPTY_INVENTORY = Object.freeze({
  player_inventory: Array(46).fill(null) as PlayerInventory,
  selected_slot: 0,
}) as InventoryDriverData;

export let makeInventoryDriver = ({
  minecraft_socket,
  inventory: server_inventory,
}: {
  minecraft_socket: MinecraftPlaySocket;
  inventory: MutableSurvivalInventory;
}): Driver_v1<void, InventoryDriverOuput> => {
  return ({ input$, signal, effect }) => {
    let server_inventory$ = new Signal.Computed(() => {
      return {
        player_inventory: server_inventory?.inventory$.get().slots,
        selected_slot: server_inventory?.inventory$.get().selected_slot,
      };
    });
    let _client_inventory = EMPTY_INVENTORY;

    minecraft_socket.on_packet["minecraft:set_carried_item"].on(
      async (packet) => {
        let { slot } = PlayPackets.serverbound.set_carried_item.read(packet);
        server_inventory.on_set_carried_item(slot);
      },
      { signal: signal }
    );

    minecraft_socket.on_packet["minecraft:set_creative_mode_slot"].on(
      (packet) => {
        console.log(
          `${chalk.blue(`[PLAY]`)} ${chalk.magenta(`minecraft:set_creative_mode_slot`)}`
        );
        console.log(chalk.gray(uint8array_as_hex(packet)));

        let { slot, clicked_item } =
          PlayPackets.serverbound["set_create_mode_slot"].read(packet);

        let slot_data = slot_data_to_slot(clicked_item);

        /// Thought I could assume the client remembered what it'd sent,
        /// but in some cases it doesn't... so we resend every time
        // _client_inventory = {
        //   ..._client_inventory,
        //   player_inventory: _client_inventory.player_inventory.toSpliced(
        //     slot,
        //     1,
        //     slot_data
        //   ) as PlayerInventory,
        // };
        server_inventory.on_set_create_mode_slot(slot, slot_data);
      },
      { signal: signal }
    );

    effect(() => {
      let server_inventory = server_inventory$.get();

      if (_client_inventory.selected_slot !== server_inventory.selected_slot) {
        minecraft_socket.send(
          PlayPackets.clientbound.set_carried_item.write({
            slot: server_inventory.selected_slot,
          })
        );
      }

      for (let i = 0; i < 46; i++) {
        if (
          _client_inventory.player_inventory[i] !==
          server_inventory.player_inventory[i]
        ) {
          minecraft_socket.send(
            PlayPackets.clientbound.container_set_slot.write({
              window_id: 0,
              slot: i,
              state_id: 20,
              slot_data: slot_to_packetable(
                server_inventory.player_inventory[i]
              ),
            })
          );
        }
      }

      _client_inventory = {
        player_inventory: server_inventory.player_inventory,
        selected_slot: server_inventory.selected_slot,
      };
    });
  };
};
