import mineflayer from "mineflayer";
import walk_around_plugin from "./bots/walk-around.ts";

let run = () => {
  const bot = mineflayer.createBot({
    host: "localhost",
    username: "Notch",
    auth: "offline",
    port: 25562,
    // port: 25561,
    version: "1.21.1",
  });

  walk_around_plugin({ bot });

  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    bot.chat(message);
  });

  // Log errors and kick reasons:
  bot.on("kicked", console.log);
  bot.on("error", (error) => {
    console.log("Bot error:");
    console.log(error);
  });

  bot.on("login", () => {
    console.log("LOGIN");
  });
  bot.on("end", () => {
    console.log("END");
    setTimeout(() => {
      console.log("TRYING TO RECONNECT");
      run();
    }, 2000);
  });
};

run();
