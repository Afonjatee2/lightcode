import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  type ReactNode,
} from "react";
import { Toast } from "@heroui/react";
import { Copy } from "lucide-react";
import { resolveThemeMode } from "@/shared/themeMode";
import { readBridge } from "@/renderer/bridge";
import { captureRendererException } from "@/renderer/diagnostics/sentry";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { getToastActionLabel, normalizeToastContent } from "./toastContent";

const AppearanceContext = createContext<"light" | "dark">("dark");
const toastContentClassName = "min-w-0 p-0 pr-1";
const toastDescriptionClassName =
  "max-h-[min(22rem,calc(100vh-12rem))] overflow-y-auto overscroll-contain whitespace-pre-wrap pr-1";
const toastTitleClassName = "lc-toast__title";

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
      .catch((error: unknown) => {
        captureRendererException(error, { featureArea: "window-chrome" });
        // Keep renderer boot resilient if Electron rejects a color value.
      });
  }, [appearance]);

  return (
    <AppearanceContext.Provider value={appearance}>
      <Toast.Provider placement="bottom end" maxVisibleToasts={5}>
        {({ toast: toastItem }) => {
          const content = toastItem.content;
          const isObject = typeof content === "object" && content !== null;
          const rawTitle = isObject ? (content as any).title : content;
          const rawDescription = isObject ? (content as any).description : undefined;
          const variant = isObject ? (content as any).variant : "default";
          const { title, description } = normalizeToastContent(variant, rawTitle, rawDescription);
          const onPress = isObject ? (content as any).onPress : undefined;
          const hasOnPress = typeof onPress === "function";
          const actionProps = isObject ? (content as any).actionProps : undefined;
          const isToastPressable = hasOnPress && !actionProps;
          const actionLabel = getToastActionLabel(actionProps);
          const isCopyAction = actionLabel?.toLowerCase().startsWith("copy") ?? false;

          return (
            <Toast
              toast={toastItem}
              variant={variant}
              className={`lc-toast relative min-w-80 max-w-[min(42rem,calc(100vw-2rem))] border border-border/40 ${isToastPressable ? "cursor-pointer" : ""}`}
            >
              {isToastPressable ? (
                <div
                  className="flex w-full items-start gap-3 p-3"
                  onClick={onPress}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onPress();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Toast.Indicator variant={variant} />
                    <Toast.Content className={`${toastContentClassName} pr-8`}>
                      {title && <Toast.Title className={toastTitleClassName}>{title}</Toast.Title>}
                      {description && (
                        <Toast.Description className={toastDescriptionClassName}>
                          {description}
                        </Toast.Description>
                      )}
                    </Toast.Content>
                  </div>
                </div>
              ) : (
                <div className="flex w-full flex-col gap-3 p-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Toast.Indicator variant={variant} />
                    <Toast.Content
                      className={`${toastContentClassName} pr-8 ${isCopyAction ? "pb-8" : ""}`}
                    >
                      {title && <Toast.Title className={toastTitleClassName}>{title}</Toast.Title>}
                      {description && (
                        <Toast.Description className={toastDescriptionClassName}>
                          {description}
                        </Toast.Description>
                      )}
                    </Toast.Content>
                  </div>
                  {isCopyAction ? (
                    <Toast.ActionButton
                      {...actionProps}
                      aria-label={actionLabel}
                      isIconOnly
                      size="sm"
                      title={actionLabel}
                      variant="ghost"
                      className={`absolute right-3 bottom-3 size-7 min-w-7 ${actionProps.className ?? ""}`}
                    >
                      <Copy className="size-3.5" />
                    </Toast.ActionButton>
                  ) : actionProps ? (
                    <Toast.ActionButton
                      size="sm"
                      variant="ghost"
                      fullWidth
                      {...actionProps}
                      className={`w-full justify-center ${actionProps.className ?? ""}`}
                    />
                  ) : null}
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
