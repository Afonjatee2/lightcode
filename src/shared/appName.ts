import { type LightcodeChannel, productNameFor } from "./channel";

export function getAppName(channel: LightcodeChannel, isDev: boolean): string {
  const base = productNameFor(channel);
  return isDev ? `${base} (dev)` : base;
}
