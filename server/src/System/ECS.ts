import { error } from "../utils/error.ts";

export abstract class Component<T> {
  data: T;
  constructor(data: T) {
    this.data = data;
  }
}

export class OptionalComponent<T extends typeof Component<any>> {
  component: T;
  constructor(component: T) {
    this.component = component;
  }
}

type ComponentQuery<
  T extends typeof Component<any> | OptionalComponent<typeof Component<any>>,
> =
  T extends OptionalComponent<infer Inside> ? InstanceType<Inside> | null
  : T extends typeof Component<any> ? InstanceType<T>
  : never;

export class EntityRegistry {
  #entities: Map<bigint, Array<Component<any>>> = new Map();

  addEntity(id: bigint, components: Array<Component<any>>) {
    this.#entities.set(id, components);
  }

  updateComponents(id: bigint, components: Array<Component<any>>) {
    let oldComponents =
      this.#entities.get(id) ?? error(`Entity ${id} does not exist`);

    let newComponents = oldComponents.map((oldComponent) => {
      let newComponent = components.find(
        (c) => c instanceof oldComponent.constructor
      );
      if (newComponent) {
        return newComponent;
      }
      return oldComponent;
    });

    this.#entities.set(id, newComponents);
  }

  removeEntity(id: bigint) {
    this.#entities.delete(id);
  }

  query<
    const Query extends Array<
      typeof Component<any> | OptionalComponent<typeof Component<any>>
    >,
  >(
    query: Query
  ): Array<[bigint, ...{ [K in keyof Query]: ComponentQuery<Query[K]> }]> {
    const results: Array<
      [bigint, ...{ [K in keyof Query]: ComponentQuery<Query[K]> }]
    > = [];
    for (const [id, components] of this.#entities) {
      let result = query.map((component) => {
        if (component instanceof OptionalComponent) {
          return (
            components.find((c) => c instanceof component.component) ?? null
          );
        }
        return components.find((c) => c instanceof component);
      });
      if (result.every((r) => r !== undefined)) {
        // @ts-ignore
        results.push([id, ...(result as any)]);
      }
    }
    return results;
  }
}
