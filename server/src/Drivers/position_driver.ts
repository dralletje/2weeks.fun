import { Signal } from "signal-polyfill";
import { PlayPackets } from "../protocol/minecraft-protocol.ts";
import { MinecraftPlaySocket } from "../MinecraftPlaySocket.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import { NumberCounter } from "../utils/Unique.ts";
import { isEqual } from "lodash-es";
import { type EntityPosition } from "../PluginInfrastructure/MinecraftTypes.ts";
import {
  HookableEvent,
  HookableEventController,
} from "../packages/hookable-event.ts";
import { modulo_cycle } from "../utils/modulo_cycle.ts";
import { type AnySignal } from "../signals.ts";

let teleport_ids = new NumberCounter();

export type PositionDriverOutput = {
  teleport: (to: EntityPosition) => void;
  position$: AnySignal<EntityPosition>;
  on_move: HookableEvent<{
    from: EntityPosition;
    to: EntityPosition;
  }>;
};

export function makePositionDriver({
  minecraft_socket,
  initial_position,
}: {
  minecraft_socket: MinecraftPlaySocket;
  initial_position: EntityPosition;
}): Driver_v1<void, PositionDriverOutput> {
  return ({ signal, effect }) => {
    let position$ = new Signal.State(
      {
        ...initial_position,
        /// Move player up 1 when joining
        y: initial_position.y + 1,
      },
      { equals: isEqual }
    );

    let movement$ = new Signal.State(0);

    let on_move = new HookableEventController<{
      from: EntityPosition;
      to: EntityPosition;
    }>();

    let teleport_in_progress = {
      id: 0,
      is_in_progress: false,
      to: initial_position,
    };

    minecraft_socket.on_packet["minecraft:accept_teleportation"].on(
      (packet) => {
        let { teleport_id } =
          PlayPackets.serverbound.accept_teleportation.read(packet);
        if (teleport_in_progress.id === teleport_id) {
          teleport_in_progress.is_in_progress = false;
          _position_client_thinks_they_are = teleport_in_progress.to;
        }
      },
      { signal: signal }
    );

    let _position_client_thinks_they_are = initial_position;
    minecraft_socket.on_packet["minecraft:move_player_pos"].on(
      (packet) => {
        let { x, y, z, ground } =
          PlayPackets.serverbound.move_player_pos.read(packet);
        let position = position$.get();

        if (teleport_in_progress.is_in_progress) {
          return;
        }

        _position_client_thinks_they_are = {
          ..._position_client_thinks_they_are,
          x: x,
          y: y,
          z: z,
        };

        let move_after_event = on_move.run({
          from: position,
          to: { x, y, z, yaw: position.yaw, pitch: position.pitch },
        });

        position$.set(move_after_event.to);

        movement$.set(
          movement$.get() +
            Math.abs(move_after_event.to.x - position.x) +
            Math.abs(move_after_event.to.z - position.z) +
            Math.abs(move_after_event.to.y - position.y)
        );
      },
      { signal: signal }
    );
    minecraft_socket.on_packet["minecraft:move_player_pos_rot"].on(
      (packet) => {
        let { x, feet_y, z, yaw, pitch, ground } =
          PlayPackets.serverbound.move_player_pos_rot.read(packet);
        let position = position$.get();

        if (teleport_in_progress.is_in_progress) {
          return;
        }

        _position_client_thinks_they_are = {
          ..._position_client_thinks_they_are,
          x: x,
          y: feet_y,
          z: z,
          yaw: yaw,
          pitch: pitch,
        };

        let move_after_event = on_move.run({
          from: position,
          to: { x, y: feet_y, z, yaw: yaw, pitch: pitch },
        });

        position$.set(move_after_event.to);

        movement$.set(
          movement$.get() +
            Math.abs(move_after_event.to.x - position.x) +
            Math.abs(move_after_event.to.z - position.z) +
            Math.abs(move_after_event.to.y - position.y)
        );
      },
      { signal: signal }
    );
    minecraft_socket.on_packet["minecraft:move_player_rot"].on(
      (packet) => {
        let { yaw, pitch, ground } =
          PlayPackets.serverbound.move_player_rot.read(packet);

        if (teleport_in_progress.is_in_progress) {
          return;
        }

        _position_client_thinks_they_are = {
          ..._position_client_thinks_they_are,
          yaw: yaw,
          pitch: pitch,
        };

        let move_after_event = on_move.run({
          from: position$.get(),
          to: { ...position$.get(), yaw, pitch },
        });

        position$.set(move_after_event.to);
      },
      { signal: signal }
    );
    minecraft_socket.on_packet["minecraft:move_player_status_only"].on(
      (packet) => {
        let { on_ground } =
          PlayPackets.serverbound.move_player_status_only.read(packet);
        // console.log(`on_ground:`, on_ground);
      },
      { signal: signal }
    );

    effect(() => {
      let position = position$.get();

      if (isEqual(position, _position_client_thinks_they_are)) {
        return;
      }

      teleport_in_progress = {
        id: teleport_ids.get_id(),
        is_in_progress: true,
        to: position,
      };

      _position_client_thinks_they_are = position;
      minecraft_socket.send(
        PlayPackets.clientbound.player_position.write({
          x: position.x,
          y: position.y,
          z: position.z,
          yaw: position.yaw,
          pitch: position.pitch,
          teleport_id: teleport_in_progress.id,
        })
      );
    });

    return {
      position$: new Signal.Computed(() => {
        let position = position$.get();
        return {
          ...position,
          yaw: modulo_cycle(position.yaw, 360),
        };
      }),
      movement$: movement$,
      on_move: on_move.listener(),
      teleport: (to: EntityPosition) => {
        position$.set(to);
      },
    };
  };
}
