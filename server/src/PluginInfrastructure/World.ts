import { BasicPlayer } from "../BasicPlayer.ts";
import { MapStateSignal } from "../packages/MapStateSignal.ts";

export class World {
  players = new MapStateSignal<bigint, BasicPlayer>();
}
