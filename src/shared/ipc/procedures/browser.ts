import { z } from "zod";
import { definePayloadProcedure, defineNoArgProcedure } from "../core";

export const browserRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BrowserRect = z.infer<typeof browserRectSchema>;

export const browserTabSchema = z.object({
  tabId: z.string(),
  url: z.string(),
  title: z.string(),
  faviconUrl: z.string().optional(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  devToolsOpen: z.boolean().optional(),
});
export type BrowserTabInfo = z.infer<typeof browserTabSchema>;

export const browserStateSchema = z.object({
  tabs: z.array(browserTabSchema),
  activeTabId: z.string().nullable(),
});
export type BrowserState = z.infer<typeof browserStateSchema>;

export const browserCreateTabPayloadSchema = z.object({
  url: z.string().optional(),
  activate: z.boolean().optional(),
});

export const browserTabIdPayloadSchema = z.object({
  tabId: z.string().min(1),
});

export const browserNavigatePayloadSchema = z.object({
  tabId: z.string().min(1),
  url: z.string().min(1),
});

export const browserMoveTabPayloadSchema = z.object({
  tabId: z.string().min(1),
  targetTabId: z.string().min(1),
  position: z.enum(["before", "after"]),
});

export const browserAttachWebContentsPayloadSchema = z.object({
  tabId: z.string().min(1),
  webContentsId: z.number().int().nonnegative(),
});

export const browserCapturePreviewResultSchema = z.object({
  dataUrl: z.string().nullable(),
});
export type BrowserCapturePreviewResult = z.infer<typeof browserCapturePreviewResultSchema>;

export const browserPickResultSchema = z.object({
  tabId: z.string(),
  selector: z.string(),
  rect: browserRectSchema,
  dpr: z.number(),
  url: z.string(),
  title: z.string(),
});
export type BrowserPickResult = z.infer<typeof browserPickResultSchema>;

export const browserStartPickerPayloadSchema = z.object({
  threadId: z.string().min(1),
  tabId: z.string().min(1),
});

export const browserStartPickerResultSchema = z.object({
  ok: z.boolean(),
  cancelled: z.boolean().optional(),
  attachmentPath: z.string().optional(),
  attachmentName: z.string().optional(),
  mimeType: z.string().optional(),
  selector: z.string().optional(),
  sourceUrl: z.string().optional(),
  rect: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  error: z.string().optional(),
});
export type BrowserStartPickerResult = z.infer<typeof browserStartPickerResultSchema>;

export const browserProcedures = {
  browserGetState: defineNoArgProcedure<BrowserState, "main-local">(
    "browserGetState",
    "main-local",
  ),
  browserCreateTab: definePayloadProcedure<
    z.infer<typeof browserCreateTabPayloadSchema>,
    BrowserTabInfo,
    "main-local"
  >("browserCreateTab", "main-local", browserCreateTabPayloadSchema),
  browserCloseTab: definePayloadProcedure<
    z.infer<typeof browserTabIdPayloadSchema>,
    void,
    "main-local"
  >("browserCloseTab", "main-local", browserTabIdPayloadSchema),
  browserActivateTab: definePayloadProcedure<
    z.infer<typeof browserTabIdPayloadSchema>,
    void,
    "main-local"
  >("browserActivateTab", "main-local", browserTabIdPayloadSchema),
  browserMoveTab: definePayloadProcedure<
    z.infer<typeof browserMoveTabPayloadSchema>,
    void,
    "main-local"
  >("browserMoveTab", "main-local", browserMoveTabPayloadSchema),
  browserNavigate: definePayloadProcedure<
    z.infer<typeof browserNavigatePayloadSchema>,
    void,
    "main-local"
  >("browserNavigate", "main-local", browserNavigatePayloadSchema),
  browserBack: definePayloadProcedure<
    z.infer<typeof browserTabIdPayloadSchema>,
    void,
    "main-local"
  >("browserBack", "main-local", browserTabIdPayloadSchema),
  browserForward: definePayloadProcedure<
    z.infer<typeof browserTabIdPayloadSchema>,
    void,
    "main-local"
  >("browserForward", "main-local", browserTabIdPayloadSchema),
  browserReload: definePayloadProcedure<
    z.infer<typeof browserTabIdPayloadSchema>,
    void,
    "main-local"
  >("browserReload", "main-local", browserTabIdPayloadSchema),
  browserHardReload: definePayloadProcedure<
    z.infer<typeof browserTabIdPayloadSchema>,
    void,
    "main-local"
  >("browserHardReload", "main-local", browserTabIdPayloadSchema),
  browserToggleDevTools: definePayloadProcedure<
    z.infer<typeof browserTabIdPayloadSchema>,
    void,
    "main-local"
  >("browserToggleDevTools", "main-local", browserTabIdPayloadSchema),
  browserClearHistory: definePayloadProcedure<
    z.infer<typeof browserTabIdPayloadSchema>,
    void,
    "main-local"
  >("browserClearHistory", "main-local", browserTabIdPayloadSchema),
  browserClearCookies: definePayloadProcedure<
    z.infer<typeof browserTabIdPayloadSchema>,
    void,
    "main-local"
  >("browserClearCookies", "main-local", browserTabIdPayloadSchema),
  browserClearCache: definePayloadProcedure<
    z.infer<typeof browserTabIdPayloadSchema>,
    void,
    "main-local"
  >("browserClearCache", "main-local", browserTabIdPayloadSchema),
  browserCopyScreenshot: definePayloadProcedure<
    z.infer<typeof browserTabIdPayloadSchema>,
    void,
    "main-local"
  >("browserCopyScreenshot", "main-local", browserTabIdPayloadSchema),
  browserCapturePreview: definePayloadProcedure<
    z.infer<typeof browserTabIdPayloadSchema>,
    BrowserCapturePreviewResult,
    "main-local"
  >("browserCapturePreview", "main-local", browserTabIdPayloadSchema),
  browserAttachWebContents: definePayloadProcedure<
    z.infer<typeof browserAttachWebContentsPayloadSchema>,
    void,
    "main-local"
  >("browserAttachWebContents", "main-local", browserAttachWebContentsPayloadSchema),
  browserStartPicker: definePayloadProcedure<
    z.infer<typeof browserStartPickerPayloadSchema>,
    BrowserStartPickerResult,
    "main-local"
  >("browserStartPicker", "main-local", browserStartPickerPayloadSchema),
  browserCancelPicker: defineNoArgProcedure<void, "main-local">(
    "browserCancelPicker",
    "main-local",
  ),
} as const;
