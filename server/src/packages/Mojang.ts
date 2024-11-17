export class MojangError extends Error {
  name = "MojangError";
}

export class Mojang {
  static get_uuid = async (name: string): Promise<string | null> => {
    try {
      let response = await fetch(
        `https://api.mojang.com/users/profiles/minecraft/${name}`
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

  static get_texture = async (uuid: string): Promise<string | null> => {
    try {
      let response = await fetch(
        `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`
      );
      if (!response.ok) {
        throw new MojangError("Mojang API error");
      }
      let json = await response.json();
      // @ts-ignore
      return json.properties.find((x) => x.name === "textures").value;
    } catch (error) {
      return null;
    }
  };
}
