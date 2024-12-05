import { Signal } from "signal-polyfill";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { type Entity } from "../Drivers/entities_driver.ts";
import { TickSignal } from "../utils/TimeSignal.ts";
import {
  HeadrotationComponent,
  PositionComponent,
  RenderComponent,
  RotationComponent,
} from "../System/System_v1.ts";
import { OptionalComponent } from "../System/ECS.ts";

export default function render_system_plugin({
  livingworld,
  signal,
}: Plugin_v1_Args): Plugin_v1 {
  let ticks$ = new TickSignal(50, { signal });

  let entities$ = new Signal.Computed((): Map<bigint, Entity> => {
    ticks$.get();

    let entities = livingworld.query([
      PositionComponent,
      RotationComponent,
      new OptionalComponent(HeadrotationComponent),
      RenderComponent,
    ]);

    return new Map(
      entities.map(([id, position, rotation, head_rotation, entity_type]) => {
        // console.log(`rotation:`, rotation);
        // console.log(`head_rotation:`, head_rotation);
        return [
          id,
          {
            type: entity_type.data.type,
            position: position.data,
            pitch: rotation.data.pitch,
            yaw: rotation.data.yaw,
            head_yaw:
              head_rotation ? head_rotation.data.yaw : rotation.data.yaw,
          } as Entity,
        ];
      })
    );
  });

  return {
    sinks: {
      entities$: entities$,
    },
  };
}
