import { registries } from "./data/registries.ts";

export { registries };

type Registries = typeof registries;

export type RegistryName = keyof Registries;

export type RegistryResourceKey<RegistryName extends keyof Registries> =
  keyof Registries[RegistryName]["entries"] & string;

export let find_inside_registry = <
  RegistryName extends keyof Registries,
  ResourceKey extends RegistryResourceKey<RegistryName>,
>(
  registry: RegistryName,
  key: ResourceKey
) => {
  // @ts-expect-error
  let entry = registries[registry].entries[key];
  if (entry == null) {
    throw new Error(`No registry entry with key ${key}`);
  }
  return entry;
};
