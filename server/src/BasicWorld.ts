import { SingleEventEmitter } from "./packages/single-event-emitter.ts";
import { type TextComponent } from "./protocol/text-component.ts";
import { type AnySignal } from "./signals.ts";

type BasicWorldContext = {};

export class BasicMutableWorld {
  context: BasicWorldContext;
  constructor(context: BasicWorldContext) {
    this.context = context;
  }

  transaction() {}
}
