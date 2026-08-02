export type ChannelAction = "browse" | "create" | "dm" | "search";

export const CHANNEL_ACTION_EVENT = "buzz-web:channel-action";

export function isChannelAction(value: unknown): value is ChannelAction {
  return ["browse", "create", "dm", "search"].includes(String(value));
}
