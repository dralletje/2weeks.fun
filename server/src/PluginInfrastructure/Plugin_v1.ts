import { BasicPlayer } from "../PluginInfrastructure/BasicPlayer.ts";
import { type Bossbar } from "../Drivers/bossbars_driver.ts";
import { type ChatDriverOutput } from "../Drivers/chat_driver.ts";
import {
  type EntityDriverOutput,
  type Entity,
} from "../Drivers/entities_driver.ts";
import { type PlayerState } from "../Drivers/playerstate_driver.ts";
import { type PositionDriverOutput } from "../Drivers/position_driver.ts";
import { type ResourcepackRequest } from "../Drivers/resourcepacks_driver.ts";
import { type Serverlink } from "../Drivers/serverlinks_driver.ts";
import { type SignuiDriverOutput } from "../Drivers/signui_driver.ts";
import { type WindowsV1DriverOuput } from "../Drivers/windows_v1_driver.ts";
import { type TextComponent } from "../protocol/text-component.ts";
import { type AnySignal } from "../utils/signals.ts";
import { type Command_v1 } from "./Commands_v1.ts";
import { type Driver_v1 } from "./Driver_v1.ts";
import { type ScoreboardObjective } from "../Drivers/scoreboard_driver.ts";
import { World } from "./World.ts";
import { EntityRegistry } from "../System/ECS.ts";

export type Plugin_v1_Args = {
  player: BasicPlayer;
  send_packet: (packet: Uint8Array) => void;
  world: World;
  send_broadcast: (message: { message: TextComponent | string }) => void;
  send_chat: (message: {
    message: TextComponent | string;
    sender: { uuid: bigint; name: string };
  }) => void;
  signal: AbortSignal;

  signui: SignuiDriverOutput;
  windows_v1: WindowsV1DriverOuput;
  position: PositionDriverOutput;
  chat: ChatDriverOutput;
  entities: EntityDriverOutput;

  livingworld: EntityRegistry;
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
  entities$?: Driver_v1<Map<bigint, Entity>, EntityDriverOutput>;
  playerlist$?: Driver_v1<Map<bigint, ListedPlayer>>;
  bossbars$?: Driver_v1<Map<bigint, Bossbar>>;
  serverlinks$?: Driver_v1<Array<Serverlink>>;
  compass$?: Driver_v1<{ x: number; y: number; z: number }>;
  commands$?: Driver_v1<Array<Command_v1<any>>>;
  time$?: Driver_v1<{ time: number; locked: boolean }>;
  resourcepacks$?: Driver_v1<Map<bigint, ResourcepackRequest>>;
  playerstate$?: Driver_v1<PlayerState>;
  scoreboard$?: Driver_v1<Map<WeakKey, ScoreboardObjective>>;
};

type InputFromDriver<Driver> = Driver extends Driver_v1<infer T> ? T : never;

export type Plugin_v1 = {
  sinks?: {
    [key in keyof Drivers_v1]?: AnySignal<InputFromDriver<Drivers_v1[key]>>;
  };
  commands?: Array<Command_v1<any>>;
};
