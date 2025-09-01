export class MojangError extends Error {
  name = "MojangError";
}

export class Mojang {
  static get_uuid = async (name: string): Promise<string | null> => {
    try {
      let response = await fetch(
        `https://api.minecraftservices.com/minecraft/profile/lookup/name/${name}`
      );
      if (!response.ok) {
        throw new MojangError("Mojang API error");
      }
      let json = await response.json();
      // @ts-ignore
      return json.id;
    } catch (error) {
      return null;
    }
  };

  static get_texture = async (
    uuid: string
  ): Promise<{
    value: string;
    signature: string;
  } | null> => {
    try {
      let response = await fetch(
        `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}?unsigned=false`
      );
      if (!response.ok) {
        throw new MojangError("Mojang API error");
      }
      let json = await response.json();
      // @ts-ignore
      return json.properties.find((x) => x.name === "textures");
    } catch (error) {
      return null;
    }
  };
}
