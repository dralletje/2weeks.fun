import chalk from "chalk";
import { minecraft_ping } from "./minecraft-ping.ts";

type Droplet = {
  id: number;
  name: string;
  status: "new" | "active";
  created_at: string;
  networks: { v4: Array<{ ip_address: string; type: "private" | "public" }> };
  tags: string[];
};

type DropletAction = {
  id: number;
  status: "in-progress" | "completed" | "errored";
  type: "shutdown";
};

let get_minecraft_droplets = async (KEY: string) => {
  let response = await fetch(
    "https://api.digitalocean.com/v2/droplets?tag_name=ephemeral:minecraft",
    {
      headers: {
        Authorization: `Bearer ${KEY}`,
      },
    }
  );

  if (!response.ok) {
    // prettier-ignore
    throw new Error(`Failed to fetch droplets (${response.status}): ${await response.text()}`);
  }

  let droplets = (await response.json()) as { droplets: Droplet[] };
  return droplets.droplets;
};

let boot_minecraft_droplet = async (KEY: string) => {
  let response = await fetch("https://api.digitalocean.com/v2/droplets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "minecraft.dral.eu",
      region: "ams3",
      size: "s-2vcpu-8gb-amd",
      image: "170091525",
      ssh_keys: ["3a:e5:11:44:ac:c0:ce:1c:7d:7e:cf:60:87:f3:f3:51"],
      backups: true,
      ipv6: true,
      monitoring: true,
      tags: ["ephemeral:minecraft"],
      user_data: "#cloud-config\\nruncmd:\\n  - touch /test.txt",
      volumes: ["b61c9119-9f94-11ef-9051-0a58ac1481a4"],
    }),
  });
  let create_result = (await response.json()) as { droplet: Droplet };
  let droplet = create_result.droplet;

  while (true) {
    let get_response = await fetch(
      `https://api.digitalocean.com/v2/droplets/${droplet.id}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${KEY}`,
        },
      }
    );
    let get_result = (await get_response.json()) as { droplet: Droplet };

    if (get_result.droplet.status === "new") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    } else if (get_result.droplet.status === "active") {
      let ip_address = get_result.droplet.networks.v4.find(
        (network) => network.type === "public"
      )?.ip_address;

      if (ip_address == null) {
        throw new Error("No public ip address found");
      }

      return {
        id: droplet.id,
        ip: ip_address,
      };
    } else {
      throw new Error(`Unexpected status ${get_result.droplet.status}`);
    }
  }
};

let async = async (async) => async();

let PORT = 25565;

type MinecraftPingResult = {
  version: { name: string; protocol: number };
  players: {
    max: number;
    online: number;
    sample?: Array<{ id: string; name: string }>;
  };
  description: string;
  favicon?: string;
};

let error = (message: string) => {
  throw new Error(message);
};
let droplet_ip = (droplet: Droplet) =>
  droplet.networks.v4.find((network) => network.type === "public")
    ?.ip_address ??
  error(`No public ip address found for droplet ${droplet.id}`);

/**
 * This should someway be implemented a Durable Object kind of thing
 */
export class MinecraftDroplet {
  #boot: Promise<{ hostname: string; port: number }> | null = null;
  #DIGITAL_OCEAN_TOKEN: string;

  constructor(DIGITAL_OCEAN_TOKEN: string) {
    this.#DIGITAL_OCEAN_TOKEN = DIGITAL_OCEAN_TOKEN;
  }

  async ping(): Promise<
    | {
        status: "online";
        ping: MinecraftPingResult;
        hostname: string;
        port: number;
      }
    | { status: "offline" }
    | { status: "booting"; droplet_id: number }
  > {
    let existing_droplets = await get_minecraft_droplets(
      this.#DIGITAL_OCEAN_TOKEN
    );

    if (existing_droplets.length === 0) {
      return { status: "offline" };
    } else if (existing_droplets.length === 1) {
      let droplet = existing_droplets[0];

      if (droplet.status === "new") {
        return { status: "booting", droplet_id: droplet.id };
      } else if (droplet.status === "active") {
        try {
          let result = await minecraft_ping({
            hostname: droplet_ip(droplet),
            port: PORT,
          });
          return {
            status: "online",
            ping: result,
            hostname: droplet_ip(droplet),
            port: PORT,
          };
        } catch {
          return { status: "booting", droplet_id: droplet.id };
        }
      } else if (droplet.status === "off") {
        // prettier-ignore
        throw new Error("Droplet is off - need to make it restart in this case");
      } else {
        throw new Error(`Unexpected status ${droplet.status}`);
      }
    } else {
      throw new Error("Multiple droplets found");
    }
  }

  async boot(): Promise<{ hostname: string; port: number }> {
    if (this.#boot != null) {
      return this.#boot;
    }

    this.#boot = async(async () => {
      try {
        let existing_droplets = await get_minecraft_droplets(
          this.#DIGITAL_OCEAN_TOKEN
        );

        if (existing_droplets.length === 0) {
          let droplet = await boot_minecraft_droplet(this.#DIGITAL_OCEAN_TOKEN);

          while (true) {
            try {
              await minecraft_ping({ hostname: droplet.ip, port: PORT });
              return { hostname: droplet.ip, port: PORT };
            } catch (error) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }
        } else if (existing_droplets.length === 1) {
          let droplet = existing_droplets[0];

          if (droplet.status !== "active") {
            throw new Error("Not active droplet found");
          }
          while (true) {
            try {
              await minecraft_ping({
                hostname: droplet_ip(droplet),
                port: PORT,
              });
              return {
                hostname: droplet_ip(droplet),
                port: PORT,
              };
            } catch (error) {
              await new Promise((resolve) => setTimeout(resolve, 2_000));
            }
          }
        } else {
          throw new Error("Multiple droplets found");
        }
      } finally {
        this.#boot = null;
      }
    });

    return await this.#boot;
  }

  async shutdown_and_destroy() {
    let droplets = await get_minecraft_droplets(this.#DIGITAL_OCEAN_TOKEN);

    if (droplets.length === 0) {
      return;
    } else if (droplets.length === 1) {
      let droplet = droplets[0];

      try {
        let shutdown_response = await fetch(
          `https://api.digitalocean.com/v2/droplets/${droplet.id}/actions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.#DIGITAL_OCEAN_TOKEN}`,
            },
            body: JSON.stringify({
              type: "shutdown",
            }),
          }
        );
        if (!shutdown_response.ok) {
          console.log(`shutdown_response.status:`, shutdown_response.status);
          console.log(
            `shutdown_response.text():`,
            await shutdown_response.text()
          );
          throw new Error("Failed to shutdown droplet");
        }
        let shutdown_result = (await shutdown_response.json()) as {
          action: DropletAction;
        };

        while (true) {
          let get_response = await fetch(
            `https://api.digitalocean.com/v2/droplets/${droplet.id}/actions/${shutdown_result.action.id}`,
            {
              headers: {
                Authorization: `Bearer ${this.#DIGITAL_OCEAN_TOKEN}`,
              },
            }
          );
          let get_result = (await get_response.json()) as {
            action: DropletAction;
          };

          if (get_result.action.status === "in-progress") {
            console.log(chalk.gray("Waiting for droplet to shutdown..."));
            await new Promise((resolve) => setTimeout(resolve, 2000));
            continue;
          } else if (get_result.action.status === "completed") {
            console.log(chalk.green("Droplet shutdown!"));
            break;
          } else {
            throw new Error(`Unexpected status ${get_result.action.status}`);
          }
        }
      } catch (error) {
        console.error(
          chalk.yellow(`Failed to shutdown droplet: ${error}, destroying...`)
        );
      }

      let destroy_response = await fetch(
        `https://api.digitalocean.com/v2/droplets/${droplet.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${this.#DIGITAL_OCEAN_TOKEN}`,
          },
        }
      );

      if (!destroy_response.ok) {
        throw new Error("Failed to destroy droplet");
      }

      return;
    } else {
      throw new Error("Multiple droplets found");
    }
  }
}

// export let minecraft_droplet = new MinecraftDroplet();
