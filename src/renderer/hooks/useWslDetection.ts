import { startTransition, useEffect, useState } from "react";
import { readBridge } from "@/renderer/bridge";

export function useWslDetection(storeHydrated: boolean) {
  const [wslAvailable, setWslAvailable] = useState(false);

  useEffect(() => {
    if (!storeHydrated) {
      return;
    }

    let isActive = true;
    void readBridge()
      .listWslDistros()
      .then((distros) => {
        if (!isActive) {
          return;
        }
        startTransition(() => {
          setWslAvailable(distros.length > 0);
        });
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
        startTransition(() => {
          setWslAvailable(false);
        });
      });

    return () => {
      isActive = false;
    };
  }, [storeHydrated]);

  return { wslAvailable };
}
