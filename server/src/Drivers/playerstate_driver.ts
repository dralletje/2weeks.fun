import { Signal } from "signal-polyfill";
import { type MinecraftPlaySocket } from "../protocol/MinecraftPlaySocket.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import {
  type Gamemode,
  type Position,
} from "../PluginInfrastructure/MinecraftTypes.ts";
import { PlayPackets } from "../protocol/minecraft-protocol.ts";
import { type TextComponent } from "../protocol/text-component.ts";
import { NotificationSignal, type AnySignal } from "../utils/signals.ts";
import { modulo_cycle } from "../utils/modulo_cycle.ts";

export type PlayerState = {
  field_of_view_modifier?: number;
  flying_speed?: number;

  /// "Player abilities"
  creative?: boolean;
  flying?: boolean;
  allow_flying?: boolean;
  invulnerable?: boolean;

  health?: number;
  food?: number;

  experiencebar?: number;
  level?: number;

  tablist_header?: TextComponent | string;
  tablist_footer?: TextComponent | string;

  raining?: boolean;
  rain_level?: number;
  thunder_level?: number;
  doImmediateRespawn?: boolean;
  doLimitedCrafting?: boolean;

  compass?: Position;

  gamemode?: Gamemode;

  time?: { time: bigint; locked: boolean };

  reduced_debug_info?: boolean;
  op?: 0 | 1 | 2 | 3 | 4;
};

let signal_use_one = <Input, Output>(
  signal: AnySignal<Array<Input>>,
  fn: (input: Input) => Output
): AnySignal<Output | undefined> => {
  return new Signal.Computed(() => {
    let possibilities = signal
      .get()
      .map((x) => fn(x))
      .filter((x) => x != null);

    if (possibilities.length === 0) {
      return undefined;
    } else if (possibilities.length === 1) {
      return possibilities[0];
    } else {
      throw new Error("Multiple possibilities");
    }
  });
};

export let makePlayerstateDriver = ({
  minecraft_socket,
  player_entity_id,
}: {
  minecraft_socket: MinecraftPlaySocket;
  player_entity_id: number;
}): Driver_v1<PlayerState, void> => {
  return ({ input$, signal, effect }) => {
    let field_of_view_modifier$ = signal_use_one(
      input$,
      (x) => x.field_of_view_modifier
    );
    let flying_speed$ = signal_use_one(input$, (x) => x.flying_speed);
    let creative$ = signal_use_one(input$, (x) => x.creative);
    let flying$ = signal_use_one(input$, (x) => x.flying);
    let allow_flying$ = signal_use_one(input$, (x) => x.allow_flying);
    let invulnerable$ = signal_use_one(input$, (x) => x.invulnerable);

    let sync$ = new NotificationSignal();

    /// This one should be before the player abilities effect,
    /// as the client will fill in the abilities it assumes after this packet
    let gamemode$ = signal_use_one(input$, (x) => x.gamemode);
    let _client_thinks_our_gamemode: Gamemode = "spectator";
    effect(() => {
      let gamemode = gamemode$?.get() ?? "creative";
      if (gamemode != _client_thinks_our_gamemode) {
        minecraft_socket.send(
          PlayPackets.clientbound.game_event.write({
            event: {
              type: "change_game_mode",
              value: gamemode,
            },
          })
        );
        _client_thinks_our_gamemode = gamemode;
      }
    });

    let _client_thinks_were_flying = false;
    effect(() => {
      gamemode$.get();

      let field_of_view_modifier = field_of_view_modifier$.get();
      let flying_speed = flying_speed$.get();
      let creative_mode = creative$.get();
      let flying = flying$.get();
      let allow_flying = allow_flying$.get();
      let invulnerable = invulnerable$.get();

      minecraft_socket.send(
        PlayPackets.clientbound.player_abilities.write({
          flags: new Set(
            [
              /// If we don't get anything from a plugin, follow what the client told us
              (
                flying == null ? _client_thinks_were_flying : flying
              ) ?
                ("flying" as const)
              : undefined,

              creative_mode ? ("creative_mode" as const) : undefined,
              allow_flying ? ("allow_flying" as const) : undefined,
              invulnerable ? ("invulnerable" as const) : undefined,
            ].filter((x) => x != null)
          ),
          flying_speed: flying_speed ?? 0.05,
          field_of_view_modifier: field_of_view_modifier ?? 0.1,
        })
      );

      _client_thinks_were_flying = flying ?? _client_thinks_were_flying;
    });
    minecraft_socket.on_packet["minecraft:player_abilities"].on(
      (packet) => {
        let { flags } = PlayPackets.serverbound.player_abilities.read(packet);

        /// TODO Event or something to prevent flying
        let is_flying = flags.has("flying");
        _client_thinks_were_flying = is_flying;
      },
      { signal: signal }
    );

    let health$ = signal_use_one(input$, (x) => x.health);
    let food$ = signal_use_one(input$, (x) => x.food);
    effect(() => {
      sync$.get();
      minecraft_socket.send(
        PlayPackets.clientbound.set_health.write({
          health: health$?.get() ?? 20,
          food: food$?.get() ?? 20,
          saturation: 0,
        })
      );
    });

    let tablist_header$ = signal_use_one(input$, (x) => x.tablist_header);
    let tablist_footer$ = signal_use_one(input$, (x) => x.tablist_footer);
    effect(() => {
      minecraft_socket.send(
        PlayPackets.clientbound.tab_list.write({
          header: tablist_header$?.get() ?? "",
          footer: tablist_footer$?.get() ?? "",
        })
      );
    });

    let compass$ = signal_use_one(input$, (x) => x.compass);
    effect(() => {
      let compass = compass$?.get() ?? { x: 0, y: 0, z: 0 };
      minecraft_socket.send(
        PlayPackets.clientbound.set_default_spawn_position.write({
          location: compass,
          angle: 0,
        })
      );
    });

    let experiencebar$ = signal_use_one(input$, (x) => x.experiencebar);
    let level$ = signal_use_one(input$, (x) => x.level);
    effect(() => {
      minecraft_socket.send(
        PlayPackets.clientbound.set_experience.write({
          experience_bar: experiencebar$?.get() ?? 0,
          level: level$?.get() ?? 0,
          total_experience: 0,
        })
      );
    });

    let raining$ = signal_use_one(input$, (x) => x.raining);
    let _client_thinks_its_raining = false;
    effect(() => {
      let raining = raining$?.get() ?? false;

      if (raining != _client_thinks_its_raining) {
        if (raining) {
          minecraft_socket.send(
            PlayPackets.clientbound.game_event.write({
              event: { type: "start_raining" },
            })
          );
        } else {
          minecraft_socket.send(
            PlayPackets.clientbound.game_event.write({
              event: { type: "end_raining" },
            })
          );
        }
        _client_thinks_its_raining = raining;
      }
    });

    let rain_level$ = signal_use_one(input$, (x) => x.rain_level);
    let _client_thinks_rain_level = 0;
    effect(() => {
      let rain_level = rain_level$?.get() ?? 0;
      if (rain_level != _client_thinks_rain_level) {
        minecraft_socket.send(
          PlayPackets.clientbound.game_event.write({
            event: { type: "rain_level_change", value: rain_level },
          })
        );
        _client_thinks_rain_level = rain_level;
      }
    });

    let thunder_level$ = signal_use_one(input$, (x) => x.thunder_level);
    let _client_thinks_thunder_level = 0;
    effect(() => {
      let thunder_level = thunder_level$?.get() ?? 0;
      if (thunder_level != _client_thinks_thunder_level) {
        minecraft_socket.send(
          PlayPackets.clientbound.game_event.write({
            event: { type: "thunder_level_change", value: thunder_level },
          })
        );
        _client_thinks_thunder_level = thunder_level;
      }
    });

    let time$ = signal_use_one(input$, (x) => x.time);
    effect(() => {
      let { time, locked } = time$.get() ?? { time: 1n, locked: true };
      minecraft_socket.send(
        PlayPackets.clientbound.set_time.write({
          world_age: 0n,
          time: modulo_cycle(time, 24000n) * (locked ? -1n : 1n),
        })
      );
    });

    let doImmediateRespawn$ = signal_use_one(
      input$,
      (x) => x.doImmediateRespawn
    );
    effect(() => {
      let doImmediateRespawn = doImmediateRespawn$?.get() ?? false;
      minecraft_socket.send(
        PlayPackets.clientbound.game_event.write({
          event: { type: "enable_respawn_screen", value: doImmediateRespawn },
        })
      );
    });

    let doLimitedCrafting$ = signal_use_one(input$, (x) => x.doLimitedCrafting);
    effect(() => {
      let doLimitedCrafting = doLimitedCrafting$?.get() ?? false;
      minecraft_socket.send(
        PlayPackets.clientbound.game_event.write({
          event: { type: "limited_crafting", value: doLimitedCrafting },
        })
      );
    });

    let reduced_debug_info$ = signal_use_one(
      input$,
      (x) => x.reduced_debug_info
    );
    effect(() => {
      let reduced_debug_info = reduced_debug_info$?.get() ?? false;
      minecraft_socket.send(
        PlayPackets.clientbound.entity_event.write({
          entity_id: player_entity_id,
          event: reduced_debug_info ? 22 : 23,
        })
      );
    });

    let op$ = signal_use_one(input$, (x) => x.op);
    effect(() => {
      let op = op$?.get() ?? 0;
      minecraft_socket.send(
        PlayPackets.clientbound.entity_event.write({
          entity_id: player_entity_id,
          event:
            op === 0 ? 24
            : op === 1 ? 25
            : op === 2 ? 26
            : op === 3 ? 27
            : 28,
        })
      );
    });

    return {
      /// TODO?
      // play_pufferfish_sting: game_event({ type: "pufferfish_sting" }),
      // play_elder_guardian_curse: game_event({ type: "elder_guardian_curse" }),
      // play_hurt_animation: game_event({ type: "arrow_hit_player" }),
      // no_respawn_block_available: game_event({ type: "no_respawn_block_available" }),
      // win_game: game_event({ type: "win_game" }),
    };
  };
};
