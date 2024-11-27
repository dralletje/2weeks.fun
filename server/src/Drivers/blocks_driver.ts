import { Signal } from "signal-polyfill";
import { type MinecraftPlaySocket } from "../protocol/MinecraftPlaySocket.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import { type World } from "../PluginInfrastructure/World.ts";
import { type AnySignal, NotificationSignal } from "../utils/signals.ts";
import {
  type ChunkPosition,
  type EntityPosition,
} from "../PluginInfrastructure/MinecraftTypes.ts";
import { chunkposition, chunks_around_chunk } from "../utils/chunkposition.ts";
import { Record } from "@dral/records-and-tuples";
import { sortBy } from "lodash-es";
import { PlayPackets } from "../protocol/minecraft-protocol.ts";

export let makeBlocksDriver = ({
  minecraft_socket,
  world,
  position$,
  view_distance$,
  player_entity_id,
}: {
  minecraft_socket: MinecraftPlaySocket;
  world: World;
  position$: AnySignal<EntityPosition>;
  view_distance$: AnySignal<number>;
  player_entity_id: number;
}): Driver_v1<void, void> => {
  return ({ input$, signal, effect }) => {
    let chunk$ = new Signal.Computed(() => {
      return chunkposition.from_position(position$.get());
    });
    let loaded_chunks$ = new Signal.Computed(() => {
      return chunks_around_chunk(chunk$.get(), view_distance$.get() + 2);
    });

    let _chunk_currently_generating = false;
    let _chunks_currently_loaded = new Set<Record<ChunkPosition>>();

    let resync$ = new NotificationSignal();

    effect(() => {
      resync$.get();

      let chunk_player_is_in = chunk$.get();
      let expected_chunks = loaded_chunks$.get();

      /// Until we have proper Set methods...
      let chunks_to_unload = new Set(_chunks_currently_loaded);
      for (let chunk of expected_chunks) {
        chunks_to_unload.delete(chunk);
      }
      let chunks_to_load = new Set(expected_chunks);
      for (let chunk of _chunks_currently_loaded) {
        chunks_to_load.delete(chunk);
      }

      let chunks_to_load_sorted = sortBy(Array.from(chunks_to_load), (x) =>
        chunkposition.length2(x)
      );

      // _chunks_currently_loaded = new Set(expected_chunks);

      minecraft_socket.send(
        PlayPackets.clientbound.set_chunk_cache_center.write(chunk_player_is_in)
      );

      for (let chunk of chunks_to_load_sorted) {
        let packet = world.load(chunk);
        if (packet) {
          console.log(`Loading:`, chunk);
          minecraft_socket.send(packet);
          _chunks_currently_loaded.add(chunk);
        } else {
          if (!_chunk_currently_generating) {
            _chunk_currently_generating = true;
            setTimeout(() => {
              this.generate_and_save(chunk)
                .catch((error) => {
                  console.error(
                    `Error generating chunk (${chunk.chunk_x}, ${chunk.chunk_z}):`,
                    error
                  );
                })
                .finally(() => {
                  _chunk_currently_generating = false;
                  resync$.notify();
                });
            });
          }
        }

        // for (let block_entity of block_entities) {
        //   minecraft_socket.send(
        //     PlayPackets.clientbound.block_entity_data.write({
        //       location: {
        //         x: block_entity.x + x * 16,
        //         y: block_entity.y,
        //         z: block_entity.z + z * 16,
        //       },
        //       type: find_inside_registry(
        //         "minecraft:block_entity_type",
        //         block_entity.type as any
        //       ).protocol_id,
        //       nbt: JSON.parse(block_entity.data) as NBT,
        //     })
        //   );
        // }
      }
      for (let chunk_position of chunks_to_unload) {
        console.log("Unloading:", chunk_position);
        minecraft_socket.send(
          PlayPackets.clientbound.forget_level_chunk.write(chunk_position)
        );
        _chunks_currently_loaded.delete(chunk_position);
      }
      console.log(`_chunks_currently_loaded:`, _chunks_currently_loaded);
    });
  };
};
