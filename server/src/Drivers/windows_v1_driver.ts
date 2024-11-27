import { type MinecraftPlaySocket } from "../protocol/MinecraftPlaySocket.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import { PlayPackets } from "../protocol/minecraft-protocol.ts";
import {
  type Slot,
  type Position,
} from "../PluginInfrastructure/MinecraftTypes.ts";
import {
  registries,
  type RegistryResourceKey,
} from "@2weeks/minecraft-data/registries";
import { NumberCounter } from "../utils/Unique.ts";
import {
  type AnySignal,
  effectWithSignal,
  NotificationSignal,
} from "../utils/signals.ts";
import { range } from "lodash-es";
import {
  slot_data_to_slot,
  slot_to_packetable,
} from "../PluginInfrastructure/BasicPlayer.ts";
import { Signal } from "signal-polyfill";
import { SingleEventEmitter } from "../packages/single-event-emitter.ts";
import { MutableSurvivalInventory } from "../play.ts";

type WindowClickAction =
  | "left_click"
  | "right_click"
  | "left_click_shift"
  | "right_click_shift"
  | "off_hand_swap"
  | "numeric_button_press"
  | "left_click_outside_inventory"
  | "right_click_outside_inventory"
  | "middle_click"
  | "drop"
  | "ctrl_drop"
  | "start_left_mouse_drag"
  | "add_slot_left_mouse_drag"
  | "end_left_mouse_drag"
  | "start_right_mouse_drag"
  | "add_slot_right_mouse_drag"
  | "end_right_mouse_drag"
  | "start_middle_mouse_drag"
  | "add_slot_middle_mouse_drag"
  | "end_middle_mouse_drag"
  | "double_click"
  | "unknown";

type WindowClickEvent = {
  action: WindowClickAction;
  changed_slots: Array<{
    slot: number;
    item: Slot | null;
  }>;
  slot: number;
  carried_item: Slot | null;
  button: number;
  mode: number;
};

/// TODO Make this more react like?
type OpenWindowAppInputDriverSide = {
  abortcontroller: AbortController;
  click_event: SingleEventEmitter<WindowClickEvent>;
  name_change_event: SingleEventEmitter<string>;
};
type OpenWindowAppInput = {
  signal: AbortSignal;
  on_action: SingleEventEmitter<WindowClickEvent>;
  on_name_change: SingleEventEmitter<string>;
};
type WindowDescription = {
  type: RegistryResourceKey<"minecraft:menu">;
  title: string;
  inventory: Array<Slot | null>;
  survival_inventory?: Array<Slot | null>;
  carried_item: Slot | null;

  properties_raw?: Map<number, number>;
};
export type OpenWindowApp = (
  input: OpenWindowAppInput
) => AnySignal<WindowDescription>;

export type WindowsV1DriverOuput = {
  open(app: OpenWindowApp): void;
};

let window_id_counter = new NumberCounter();

type WindowInformation = {
  size: number;
};
let WINDOWS: Partial<{
  [key in RegistryResourceKey<"minecraft:menu">]: WindowInformation;
}> = {
  "minecraft:generic_9x6": {
    size: 9 * 6,
  },
  "minecraft:anvil": {
    size: 3,
  },
};

export let makeWindowsV1Driver = ({
  minecraft_socket,
  inventory: survival_inventory,
}: {
  minecraft_socket: MinecraftPlaySocket;
  inventory: MutableSurvivalInventory;
}): Driver_v1<void, WindowsV1DriverOuput> => {
  return ({ input$, signal, effect }) => {
    let current_app: {
      window_id: number;
      window_info: WindowInformation;
      last_action: number;
      notification_signal: NotificationSignal;
      input: OpenWindowAppInputDriverSide;
      output: ReturnType<OpenWindowApp>;
    } | null = null;

    let _current_window = null as WindowDescription | null;

    /// TODO Should be able to ignore the close packet if you want the user not to leave
    minecraft_socket.on_packet["minecraft:container_close"].on(
      (packet) => {
        let { container_id } =
          PlayPackets.serverbound.container_close.read(packet);

        if (container_id === 0) {
          /// Closed survival inventory...
          /// Need to handle this somehow?
          return;
        }

        if (current_app == null) {
          throw new Error(`No current app`);
        }

        if (container_id !== current_app.window_id) {
          throw new Error(`Window id mismatch`);
        }

        current_app.input.abortcontroller.abort();
        window_id_counter.return(current_app.window_id);
        current_app = null;
        _current_window = null;
      },
      { signal }
    );

    minecraft_socket.on_packet["minecraft:rename_item"].on(
      (packet) => {
        let { item_name } = PlayPackets.serverbound.rename_item.read(packet);

        if (current_app == null) {
          throw new Error(`No current app`);
        }

        current_app.input.name_change_event.emit(item_name);
      },
      { signal }
    );

    minecraft_socket.on_packet["minecraft:container_click"].on(
      (packet) => {
        let x = PlayPackets.serverbound.container_click.read(packet);
        // console.log(`current_app:`, current_app);

        if (current_app == null) {
          console.log(`x:`, x);
          throw new Error(`No current app`);
        }

        let carried = slot_data_to_slot(x.carried);

        let action: WindowClickAction =
          x.mode === 0 && x.button === 0 && x.slot === -999 ?
            "left_click_outside_inventory"
          : x.mode === 0 && x.button === 1 && x.slot === -999 ?
            "right_click_outside_inventory"
          : x.mode === 0 && x.button === 0 ? "left_click"
          : x.mode === 0 && x.button === 1 ? "right_click"
          : x.mode === 1 && x.button === 0 ? "left_click_shift"
          : x.mode === 1 && x.button === 1 ? "right_click_shift"
          : x.mode === 2 && x.button === 40 ? "off_hand_swap"
          : x.mode === 2 ? "numeric_button_press"
          : x.mode === 3 ? "middle_click"
          : x.mode === 4 && x.button === 0 ? "drop"
          : x.mode === 4 && x.button === 1 ? "ctrl_drop"
          : x.mode === 5 && x.button === 0 ? "start_left_mouse_drag"
          : x.mode === 5 && x.button === 1 ? "add_slot_left_mouse_drag"
          : x.mode === 5 && x.button === 2 ? "end_left_mouse_drag"
          : x.mode === 5 && x.button === 4 ? "start_right_mouse_drag"
          : x.mode === 5 && x.button === 5 ? "add_slot_right_mouse_drag"
          : x.mode === 5 && x.button === 6 ? "end_right_mouse_drag"
          : x.mode === 5 && x.button === 8 ? "start_middle_mouse_drag"
          : x.mode === 5 && x.button === 9 ? "add_slot_middle_mouse_drag"
          : x.mode === 5 && x.button === 10 ? "end_middle_mouse_drag"
          : x.mode === 6 && x.button === 1 ? "double_click"
          : "unknown";

        let current_inventory = range(0, current_app.window_info.size).map(
          (i) => {
            return current_app!.output.get().inventory[i];
          }
        );

        for (let changed_slot of x.changed_slots) {
          if (changed_slot.slot < current_app.window_info.size) {
            current_inventory[changed_slot.slot] = slot_data_to_slot(
              changed_slot.item
            );
          } else {
            let slot = changed_slot.slot - current_app.window_info.size + 9;
            survival_inventory.set_slot(
              slot,
              slot_data_to_slot(changed_slot.item)
            );
          }
        }

        _current_window = {
          ..._current_window!,
          carried_item: carried,
          inventory: current_inventory,
        };

        current_app.input.click_event.emit({
          action: action,
          carried_item: carried,
          changed_slots: x.changed_slots.map((x) => ({
            slot: x.slot,
            item: slot_data_to_slot(x.item),
          })),
          slot: x.slot,
          button: x.button,
          mode: x.mode,
        });

        current_app.notification_signal.notify();

        // console.log(`action:`, action);
        // console.log(`current_app.window_info:`, current_app.window_info);
        // console.log(`Container Click:`, x);
      },
      { signal }
    );

    return {
      open: (app: OpenWindowApp) => {
        let window_id = window_id_counter.get_id();
        let abortcontroller = new AbortController();
        let notification_signal = new NotificationSignal();

        let click_event = new SingleEventEmitter<WindowClickEvent>();
        let name_change_event = new SingleEventEmitter<string>();

        let driver_side = {
          abortcontroller: abortcontroller,
          click_event: click_event,
          name_change_event: name_change_event,
        };

        signal.addEventListener("abort", () => {
          abortcontroller.abort();
        });

        let app_signal$ = app({
          signal: abortcontroller.signal,
          on_action: click_event,
          on_name_change: name_change_event,
        });

        /// TODO Make this use the `effect` passed to the driver
        effectWithSignal(abortcontroller.signal, () => {
          notification_signal.get();

          let result = app_signal$.get();

          if (result.type in WINDOWS === false) {
            /// TODO Stop the whole window process?
            throw new Error(`Unknown window type: ${result.type}`);
          }
          let window_info = WINDOWS[result.type]!;

          if (
            _current_window?.type !== result.type ||
            _current_window?.title !== result.title
          ) {
            if (_current_window != null) {
              throw new Error(
                `Window type or title changed (not yet implemented)`
              );
            }

            minecraft_socket.send(
              PlayPackets.clientbound.open_screen.write({
                window_id: window_id,
                screen:
                  registries["minecraft:menu"].entries[result.type].protocol_id,
                title: result.title,
              })
            );
          }

          /// Currently we are just sending the whole inventory every time
          let inventory = range(0, window_info.size).map((i) => {
            return result.inventory[i] ?? null;
          });

          let result_survival_inventory =
            result.survival_inventory?.slice(0, 3 * 9) ??
            survival_inventory.inventory$.get().slots.slice(9, 35);

          minecraft_socket.send(
            PlayPackets.clientbound.container_set_content.write({
              state_id: 0,
              window_id: window_id,
              slots: [
                ...inventory.map((slot) => slot_to_packetable(slot)),
                ...[
                  ...result_survival_inventory.map(slot_to_packetable),
                  ...range(0, 3 * 9 - result_survival_inventory.length).map(
                    () => slot_to_packetable(null)
                  ),
                ],
                ...survival_inventory.inventory$
                  .get()
                  .slots.slice(36, 44)
                  .map((slot) => slot_to_packetable(slot)),
              ],
              carried_item: slot_to_packetable(result.carried_item),
              // carried_item: slot_to_packetable(null),
            })
          );

          let all_properties = new Set([
            ...(result.properties_raw?.keys() ?? []),
            ...(_current_window?.properties_raw?.keys() ?? []),
          ]);
          for (let property of all_properties) {
            let expected = result.properties_raw?.get(property) ?? 0;
            let current = _current_window?.properties_raw?.get(property) ?? 0;

            if (expected !== current) {
              minecraft_socket.send(
                PlayPackets.clientbound.container_set_data.write({
                  window_id: window_id,
                  property: property,
                  value: expected,
                })
              );
            }
          }

          _current_window = result;
        });

        // abortcontroller.signal.addEventListener("abort", () => {
        //   window_id_counter.return(window_id);
        //   current_app = null;
        // })

        /// Initial to set window info
        let result = app_signal$.get();
        if (result.type in WINDOWS === false) {
          /// TODO Stop the whole window process?
          throw new Error(`Unknown window type: ${result.type}`);
        }
        let window_info = WINDOWS[result.type]!;

        current_app = {
          last_action: 0,
          window_info: window_info,
          notification_signal: notification_signal,
          window_id: window_id,
          input: driver_side,
          output: app_signal$,
        };
      },
    };
  };
};
