import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  type ReactNode,
} from "react";
import { Toast } from "@heroui/react";
import { resolveThemeMode } from "@/shared/themeMode";
import { readBridge } from "@/renderer/bridge";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

const AppearanceContext = createContext<"light" | "dark">("dark");

export function useResolvedAppearance(): "light" | "dark" {
  return useContext(AppearanceContext);
}

function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function AppProvider(props: { children: ReactNode }) {
  const { children } = props;
  const themeMode = useSharedSettings((state) => state.themeMode);
  const [prefersDark, setPrefersDark] = useState(getSystemPrefersDark);
  const syncSystemPreference = useEffectEvent((matches: boolean) => {
    setPrefersDark(matches);
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      syncSystemPreference(event.matches);
    };

    syncSystemPreference(media.matches);
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  const appearance = resolveThemeMode(themeMode, prefersDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(appearance);
    root.dataset.theme = appearance;
  }, [appearance]);

  useEffect(() => {
    if (typeof window === "undefined" || !("lightcode" in window)) {
      return;
    }

    const root = document.documentElement;
    const styles = window.getComputedStyle(root);

    void readBridge()
      .setWindowChrome({
        backgroundColor:
          styles.getPropertyValue("--window-overlay-background").trim() || "rgba(0, 0, 0, 0)",
        symbolColor: appearance === "dark" ? "#fafafa" : "#1f2937",
      })
      .catch(() => {
        // Keep renderer boot resilient if Electron rejects a color value.
      });
  }, [appearance]);

  return (
    <AppearanceContext.Provider value={appearance}>
      <Toast.Provider placement="bottom end" maxVisibleToasts={5}>
        {({ toast: toastItem }) => {
          const content = toastItem.content;
          const isObject = typeof content === "object" && content !== null;
          const title = isObject ? (content as any).title : content;
          const description = isObject ? (content as any).description : undefined;
          const variant = isObject ? (content as any).variant : "default";
          const onPress = isObject ? (content as any).onPress : undefined;
          const hasOnPress = typeof onPress === "function";

          return (
            <Toast
              toast={toastItem}
              variant={variant}
              className={`lc-toast min-w-80 border border-border/40 ${hasOnPress ? "cursor-pointer" : ""}`}
            >
              {hasOnPress ? (
                <button
                  type="button"
                  onClick={onPress}
                  className="flex w-full items-start gap-3 p-3 text-left"
                >
                  <Toast.Indicator variant={variant} />
                  <Toast.Content className="p-0">
                    {title && <Toast.Title>{title}</Toast.Title>}
                    {description && (
                      <Toast.Description className="whitespace-pre-wrap">
                        {description}
                      </Toast.Description>
                    )}
                  </Toast.Content>
                </button>
              ) : (
                <div className="flex w-full items-start gap-3 p-3">
                  <Toast.Indicator variant={variant} />
                  <Toast.Content className="p-0">
                    {title && <Toast.Title>{title}</Toast.Title>}
                    {description && (
                      <Toast.Description className="whitespace-pre-wrap">
                        {description}
                      </Toast.Description>
                    )}
                  </Toast.Content>
                </div>
              )}
              <Toast.CloseButton className="absolute top-3 right-3" />
            </Toast>
          );
        }}
      </Toast.Provider>
      {children}
    </AppearanceContext.Provider>
  );
}
