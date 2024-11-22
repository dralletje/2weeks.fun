import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";

export default function empty_plugin({}: Plugin_v1_Args): Plugin_v1 {
  return {};
}
