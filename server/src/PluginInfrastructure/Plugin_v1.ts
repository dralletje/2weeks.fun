import { BasicPlayer } from "../BasicPlayer.ts";
import { type Bossbar } from "../Drivers/bossbars_driver.ts";
import { type Entity } from "../Drivers/entities_driver.ts";
import { type Serverlink } from "../Drivers/serverlinks_driver.ts";
import { type SignuiDriverOutput } from "../Drivers/signui_driver.ts";
import { type TextComponent } from "../protocol/text-component.ts";
import { type AnySignal } from "../signals.ts";
import { type Command_v1 } from "./Commands_v1.ts";
import { type Driver_v1 } from "./Driver_v1.ts";
import { World } from "./World.ts";

export type Plugin_v1_Args = {
  player: BasicPlayer;
  send_packet: (packet: Uint8Array) => void;
  world: World;
  signal: AbortSignal;
  signui: SignuiDriverOutput;
};

export type ListedPlayer = {
  name: string;
  properties: Array<{
    name: string;
    value: string;
    signature: string | null;
  }>;
  game_mode: "creative" | "survival" | "adventure" | "spectator";
  ping: number;
  display_name: TextComponent | string | null;
  listed: boolean;
};

export type Drivers_v1 = {
  entities$?: Driver_v1<Map<bigint, Entity>>;
  playerlist$?: Driver_v1<Map<bigint, ListedPlayer>>;
  bossbars$?: Driver_v1<Map<bigint, Bossbar>>;
  serverlinks$?: Driver_v1<Array<Serverlink>>;
  compass$?: Driver_v1<{ x: number; y: number; z: number }>;
  commands$?: Driver_v1<Array<Command_v1<any>>>;
  time$?: Driver_v1<{ time: number; locked: boolean }>;
};

export type Plugin_v1 = {
  sinks?: {
    entities$?: AnySignal<Map<bigint, Entity>>;
    playerlist$?: AnySignal<Map<bigint, ListedPlayer>>;
    bossbars$?: AnySignal<Map<bigint, Bossbar>>;
    serverlinks$?: AnySignal<Array<Serverlink>>;
    compass$?: AnySignal<{ x: number; y: number; z: number }>;
    statusbar$?: AnySignal<TextComponent | string | null | void>;
  };
  commands?: Array<Command_v1<any>>;
};
