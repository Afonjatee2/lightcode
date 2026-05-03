import type { AgentCapability } from "@/shared/contracts";
import { deriveSubProvider, listSubProviderOrder } from "./deriveSubProvider";
import type { ProviderModelItem } from "./types";

export interface ProviderModelMenuProvider {
  kind: string;
  label: string;
  capabilities: AgentCapability;
}

export interface ModelRef {
  agentKind: string;
  modelId: string;
}

export interface BuildProviderModelItemsInput {
  providers: ProviderModelMenuProvider[];
  search: string;
  lockedAgentKind?: string;
  /** Current selection — surfaced even if absent from `providers[*].capabilities.models`. */
  currentAgentKind?: string;
  currentModel?: string;
  /** Persisted favorites (provider/model pairs). Surfaced as a sticky section. */
  favorites?: readonly ModelRef[];
  /** Favorite state used for row stars without affecting section ordering. */
  favoriteStateRefs?: readonly ModelRef[];
  /** Persisted recents (provider/model pairs). Capped to `recentsLimit` and de-duped against favorites. */
  recents?: readonly ModelRef[];
  /** Display cap for recents (default 5). */
  recentsLimit?: number;
}

const DEFAULT_LABEL = (id: string) =>
  id
    .split(/[-_/]/g)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

/** Display order for provider sections. Unknown kinds fall to the end. */
const PROVIDER_ORDER: readonly string[] = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "copilot",
];

function providerSortKey(kind: string): number {
  const idx = PROVIDER_ORDER.indexOf(kind);
  return idx < 0 ? PROVIDER_ORDER.length : idx;
}

interface ModelEntry {
  id: string;
  label: string;
  subId?: string;
  subLabel?: string;
  searchText: string;
}

interface ProviderModelCache {
  models: ModelEntry[];
  modelById: Map<string, ModelEntry>;
}

const providerModelCache = new WeakMap<AgentCapability, ProviderModelCache>();

/**
 * Build a flat list of header + model rows for the virtualized listbox.
 *
 * Browse mode (no search): provider header + optional sub-provider headers + models.
 * Search mode: provider header + flat models matching the query, with sub-provider
 * label promoted to a per-row right-rail hint.
 *
 * When `lockedAgentKind` is set, only that provider's rows appear and the provider
 * header is omitted (there is no other provider to disambiguate against).
 */
function refKey(ref: ModelRef): string {
  return `${ref.agentKind}:${ref.modelId}`;
}

interface ResolvedModelRef {
  ref: ModelRef;
  label: string;
  providerLabel: string;
  subProviderLabel?: string;
  searchText: string;
  providerSearchText: string;
}

function makeModelEntry(id: string, label: string, capability: AgentCapability): ModelEntry {
  const sub = deriveSubProvider(id, capability);
  const searchParts = [id, label];
  const entry: ModelEntry = { id, label, searchText: "" };
  if (sub) {
    entry.subId = sub.id;
    entry.subLabel = sub.label;
    searchParts.push(sub.id, sub.label);
  }
  entry.searchText = searchParts.join("\n").toLowerCase();
  return entry;
}

function getProviderModelCache(capability: AgentCapability): ProviderModelCache {
  const cached = providerModelCache.get(capability);
  if (cached) return cached;

  const models: ModelEntry[] = [];
  const modelById = new Map<string, ModelEntry>();
  for (const model of capability.models) {
    const entry = makeModelEntry(model.id, model.label, capability);
    models.push(entry);
    modelById.set(entry.id, entry);
  }

  const next: ProviderModelCache = { models, modelById };
  providerModelCache.set(capability, next);
  return next;
}

interface VisibleProvider {
  provider: ProviderModelMenuProvider;
  cache: ProviderModelCache;
  searchText: string;
}

function resolveModelRef(
  ref: ModelRef,
  providersByKind: ReadonlyMap<string, VisibleProvider>,
): ResolvedModelRef | undefined {
  const visibleProvider = providersByKind.get(ref.agentKind);
  if (!visibleProvider) return undefined;
  const { provider, cache } = visibleProvider;
  const model =
    cache.modelById.get(ref.modelId) ??
    makeModelEntry(ref.modelId, DEFAULT_LABEL(ref.modelId), provider.capabilities);
  const resolved: ResolvedModelRef = {
    ref,
    label: model.label,
    providerLabel: provider.label,
    searchText: model.searchText,
    providerSearchText: visibleProvider.searchText,
  };
  if (model.subLabel) resolved.subProviderLabel = model.subLabel;
  return resolved;
}

export function buildProviderModelItems(input: BuildProviderModelItemsInput): ProviderModelItem[] {
  const {
    providers,
    search,
    lockedAgentKind,
    currentAgentKind,
    currentModel,
    favorites,
    favoriteStateRefs,
    recents,
    recentsLimit = 5,
  } = input;
  const visibleProviders = (
    lockedAgentKind ? providers.filter((p) => p.kind === lockedAgentKind) : providers
  )
    .slice()
    .sort((a, b) => providerSortKey(a.kind) - providerSortKey(b.kind));
  const visibleProviderEntries: VisibleProvider[] = visibleProviders.map((provider) => ({
    provider,
    cache: getProviderModelCache(provider.capabilities),
    searchText: `${provider.kind}\n${provider.label}`.toLowerCase(),
  }));
  const visibleProvidersByKind = new Map(
    visibleProviderEntries.map((entry) => [entry.provider.kind, entry]),
  );
  const query = search.trim().toLowerCase();
  const isSearching = query.length > 0;
  const out: ProviderModelItem[] = [];
  const showProviderHeaders = visibleProviders.length > 1;
  const visibleKinds = new Set(visibleProviders.map((p) => p.kind));
  const sectionFavoriteSet = new Set((favorites ?? []).map(refKey));
  const favoriteStateSet = new Set((favoriteStateRefs ?? favorites ?? []).map(refKey));

  function pushShortcutSection(
    sectionId: string,
    headerLabel: string,
    refs: readonly ModelRef[],
  ): void {
    const items = refs
      .filter((ref) => visibleKinds.has(ref.agentKind))
      .map((ref) => resolveModelRef(ref, visibleProvidersByKind))
      .filter((m): m is ResolvedModelRef => m !== undefined)
      .filter((m) => {
        if (!isSearching) return true;
        return m.searchText.includes(query) || m.providerSearchText.includes(query);
      });
    if (items.length === 0) return;
    out.push({ type: "header-plain", id: `header:${sectionId}`, label: headerLabel });
    for (const m of items) {
      out.push({
        type: "model",
        id: `${sectionId}:${m.ref.agentKind}:${m.ref.modelId}`,
        providerKind: m.ref.agentKind,
        modelId: m.ref.modelId,
        label: m.label,
        ...(m.subProviderLabel ? { subProviderLabel: m.subProviderLabel } : {}),
        showProviderIcon: true,
        isFavorite: favoriteStateSet.has(refKey(m.ref)),
      });
    }
  }

  if (favorites?.length) {
    pushShortcutSection("fav", "Favorites", favorites);
  }
  if (recents?.length) {
    const filteredRecents = recents
      .filter((r) => !sectionFavoriteSet.has(refKey(r)))
      .slice(0, recentsLimit);
    if (filteredRecents.length > 0) {
      pushShortcutSection("recent", "Recent", filteredRecents);
    }
  }

  for (const { provider, cache, searchText } of visibleProviderEntries) {
    const cap = provider.capabilities;
    const providerHit = isSearching && searchText.includes(query);
    const currentEntry =
      currentAgentKind === provider.kind && currentModel && !cache.modelById.has(currentModel)
        ? makeModelEntry(currentModel, DEFAULT_LABEL(currentModel), cap)
        : undefined;
    const sourceModelCount = cache.models.length + (currentEntry ? 1 : 0);

    const filtered: ModelEntry[] = [];
    for (let index = 0; index < sourceModelCount; index += 1) {
      const model = index < cache.models.length ? cache.models[index]! : currentEntry!;
      if (!isSearching || providerHit || model.searchText.includes(query)) {
        filtered.push(model);
      }
    }

    if (filtered.length === 0) continue;

    if (showProviderHeaders) {
      out.push({
        type: "header-provider",
        id: `provider:${provider.kind}`,
        providerKind: provider.kind,
        label: provider.label,
      });
    }

    if (isSearching) {
      // Flat under the provider; sub-provider promoted to right-rail label.
      for (const m of filtered) {
        out.push({
          type: "model",
          id: `model:${provider.kind}:${m.id}`,
          providerKind: provider.kind,
          modelId: m.id,
          label: m.label,
          ...(m.subLabel ? { subProviderLabel: m.subLabel } : {}),
          showProviderIcon: true,
          isFavorite: favoriteStateSet.has(`${provider.kind}:${m.id}`),
        });
      }
      continue;
    }

    const grouped = new Map<string, ModelEntry[]>();
    const ungrouped: ModelEntry[] = [];
    for (const m of filtered) {
      if (m.subId) {
        let bucket = grouped.get(m.subId);
        if (!bucket) {
          bucket = [];
          grouped.set(m.subId, bucket);
        }
        bucket.push(m);
      } else {
        ungrouped.push(m);
      }
    }

    for (const m of ungrouped) {
      out.push({
        type: "model",
        id: `model:${provider.kind}:${m.id}`,
        providerKind: provider.kind,
        modelId: m.id,
        label: m.label,
        isFavorite: favoriteStateSet.has(`${provider.kind}:${m.id}`),
      });
    }

    if (grouped.size === 0) continue;

    for (const sp of listSubProviderOrder(cap, grouped.keys())) {
      const models = grouped.get(sp.id);
      if (!models?.length) continue;
      out.push({
        type: "header-sub",
        id: `sub:${provider.kind}:${sp.id}`,
        providerKind: provider.kind,
        subId: sp.id,
        label: sp.label,
      });
      for (const m of models) {
        out.push({
          type: "model",
          id: `model:${provider.kind}:${m.id}`,
          providerKind: provider.kind,
          modelId: m.id,
          label: m.label,
          isFavorite: favoriteStateSet.has(`${provider.kind}:${m.id}`),
        });
      }
    }
  }

  return out;
}
