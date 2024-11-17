import net from "node:net";
import { register } from "node:module";
import chalk from "chalk";
import { type App, Socket } from "./types.ts";
import { range } from "lodash-es";
import fs from "node:fs/promises";
import dotenv from "dotenv";

import { AsyncLocalStorage } from "node:async_hooks";

register("./binary-loader/binary-loader.ts", import.meta.url);
register("./text-loader/text-loader.ts", import.meta.url);

/// Load .vars file from cwd
// let vars = await fs.readFile(".vars", "utf8");
let vars = {};
try {
  let vars_file = await fs.readFile(".vars", "utf8");
  try {
    vars = dotenv.parse(vars_file);
  } catch (error: any) {
    console.error(chalk.bgRed(" Error parsing .vars file "));
    console.error(chalk.red(error.stack));
    process.exit();
  }
} catch (error) {}
/// TODO Eventually should load .vars.dev or .vars.prod based on NODE_ENV or something?

/// TODO Service bindings??
let env = { ...vars };

let argv = process.argv.slice(2);
let app = (await import(argv[0])).default as App;
// import app from "./app.ts";

class Storage {
  #map = new Map<string, any>();

  async get(key: string): Promise<string | null> {
    return this.#map.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.#map.set(key, structuredClone(value));
  }
}

process.on("unhandledRejection", (reason, promise) => {
  if (reason instanceof Error) {
    console.log(chalk.bgRed(" Unhandled Promise Rejection "));
    console.log(chalk.red(reason.stack));
  } else {
    console.log(chalk.bgRed(" Unhandled Promise Rejection "));
    console.log(chalk.red(reason));
  }
});

let storage = new Storage();

if ("ports" in app) {
  for (let port of app.ports) {
    if (app.connect == null) {
      // prettier-ignore
      console.log(chalk.bgRed(" Connect handler is required when ports are specified "));
      process.exit(1);
    }

    /// Going to listen to some ports
    let server = net.createServer(async (node_socket) => {
      let socket = new Socket(node_socket);
      try {
        await app.connect!(
          { port: node_socket.localPort!, socket: socket },
          env
        );
      } catch (error: any) {
        console.error(chalk.bgRed(" Error in connect handler "));
        console.error(chalk.red(error.stack));
      } finally {
        socket.close();
      }
    });

    /// Give port 5 seconds to get free
    for (let i of range(0, 5)) {
      try {
        server.listen(port);
        await new Promise<void>((resolve, reject) => {
          server.on("listening", () => {
            resolve();
          });
          server.on("error", (error) => {
            reject(error);
          });
        });
        console.log(chalk.gray(`server listening on port ${chalk.blue(port)}`));
        break;
      } catch (error: any) {
        if (error.code === "EADDRINUSE") {
          // console.log(`port ${port} is in use, trying again in 1 second`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          throw error;
        }
      }

      console.log(chalk.bgRed(` Failed to listen on port ${port} `));
      process.exit(1);
    }
  }

  // process.on("SIGINT", () => {
  //   console.log(chalk.bgRed(" SIGINT "));
  //   server.close();
  // });

  // process.on("SIGTERM", () => {
  //   console.log(chalk.bgRed(" SIGTERM "));
  //   server.close();
  // });

  // process.on("SIGKILL", () => {
  //   console.log(chalk.bgRed(" SIGKILL "));
  //   server.close();
  // });
}

if ("crons" in app) {
  if (app.scheduled == null) {
    // prettier-ignore
    console.log(chalk.bgRed(" Scheduled handler is required when crons are specified "));
    process.exit(1);
  }

  for (let cron of app.crons) {
    if (cron !== "* * * * *") {
      throw new Error("Only support * * * * * cron format");
    }

    let run = async () => {
      try {
        console.log(chalk.bgBlue(" Running cron job "));
        await app.scheduled!(
          { cron, type: "scheduled", scheduledTime: Date.now() },
          env,
          { storage }
        );
        console.log(chalk.bgGreen(" Cron job ran successfully "));
      } catch (error: any) {
        console.error(chalk.bgRed(" Error in scheduled handler "));
        console.error(chalk.red(error.stack));
      }
    };

    run();
    // setInterval(run, 60 * 1000);
    // setInterval(run, 5 * 1000);

    let recursive_run = () => {
      setTimeout(async () => {
        try {
          await run();
        } finally {
          recursive_run();
        }
      }, 60 * 1000);
    };
    recursive_run();
  }
}
