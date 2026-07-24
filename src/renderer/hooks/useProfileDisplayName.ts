import { useEffect, useState } from "react";
import { readBridge } from "@/renderer/bridge";

/** Profile display name for personalized greetings; empty when unset. */
export function useProfileDisplayName(): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const bridge = readBridge();
    if (!("getProfileIdentity" in bridge) || typeof bridge.getProfileIdentity !== "function") {
      return () => {
        active = false;
      };
    }
    void bridge
      .getProfileIdentity()
      .then((response) => {
        if (!active) return;
        const trimmed = response.identity.name.trim();
        setName(trimmed.length > 0 ? trimmed : null);
      })
      .catch(() => {
        if (active) setName(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return name;
}
