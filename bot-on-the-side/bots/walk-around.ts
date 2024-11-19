import mineflayer from "mineflayer";

export default function walk_around_plugin({ bot }: { bot: mineflayer.Bot }) {
  let target: mineflayer.Player["entity"] | null = null;

  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    target = bot.players[username]?.entity;

    if (target) {
      bot.lookAt(target.position.offset(0, target.height, 0));
    }

    switch (message) {
      case "forward":
        bot.setControlState("forward", true);
        break;
      case "back":
        bot.setControlState("back", true);
        break;
      case "left":
        bot.setControlState("left", true);
        break;
      case "right":
        bot.setControlState("right", true);
        break;
      case "sprint":
        bot.setControlState("sprint", true);
        break;
      case "stop":
        bot.clearControlStates();
        break;
      case "jump":
        bot.setControlState("jump", true);
        bot.setControlState("jump", false);
        break;
      case "jump a lot":
        bot.setControlState("jump", true);
        break;
      case "stop jumping":
        bot.setControlState("jump", false);
        break;
      case "attack": {
        let entity = bot.nearestEntity();
        if (entity) {
          bot.attack(entity);
        } else {
          bot.chat("No nearby entities!");
        }
        break;
      }
      case "mount": {
        let entity = bot.nearestEntity((entity) => {
          return entity.name === "minecart";
        });
        if (entity) {
          bot.mount(entity);
        } else {
          bot.chat("no nearby objects");
        }
        break;
      }
      case "dismount":
        bot.dismount();
        break;
      case "move vehicle forward":
        bot.moveVehicle(0.0, 1.0);
        break;
      case "move vehicle backward":
        bot.moveVehicle(0.0, -1.0);
        break;
      case "move vehicle left":
        bot.moveVehicle(1.0, 0.0);
        break;
      case "move vehicle right":
        bot.moveVehicle(-1.0, 0.0);
        break;
      case "tp":
        bot.entity.position.y += 10;
        break;
      case "pos":
        bot.chat(bot.entity.position.toString());
        break;
      case "yp":
        bot.chat(`Yaw ${bot.entity.yaw}, pitch: ${bot.entity.pitch}`);
        break;
    }

    if (message.startsWith("do ")) {
      const command = message.slice("do ".length);
      bot.chat(command);
    }
  });

  bot.once("spawn", () => {
    console.log("Spawned!!");
    // keep your eyes on the target, so creepy!
    setInterval(watchTarget, 50);

    function watchTarget() {
      if (!target) return;
      console.log("watching target");
      bot.lookAt(target.position.offset(0, target.height, 0));
    }
  });

  bot.on("mount", () => {
    bot.chat(`mounted ${bot.vehicle.displayName}`);
  });

  bot.on("dismount", (vehicle) => {
    bot.chat(`dismounted ${vehicle.displayName}`);
  });
}
