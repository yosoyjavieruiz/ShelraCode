import {
  type KeyEvent,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from "@opentui/core";
import path from "node:path";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import type {
  AgentCapabilityClass,
  PermissionMode,
  RepositoryPrivacy,
  RouteDecision,
  RoutingMode,
  TaskAnalysis,
} from "../shared/types.js";
import type { HardwareInspection } from "../hardware/types.js";
import type { ProviderStatus } from "../providers/registry.js";
import type { SessionSummary } from "../storage/database.js";
import type { ToolApprovalRequest } from "../tools/types.js";
import {
  addPermissionGrant,
  createPermissionGrant,
  isPermissionGrantPersistable,
  matchesPermissionGrant,
  permissionGrantFamily,
  permissionGrantScopeDescription,
  removePermissionGrant,
  type ApprovalDecision,
  type PermissionGrant,
} from "../tools/permission-grants.js";
import { verifyStructuralCodingCriteria } from "../agent/verification-criteria.js";
import type { AgentTask } from "../agent/types.js";
import type { AgentTaskLedger } from "../agent/task-state.js";
import {
  createSubagentDelegationTool,
  createParallelSubagentDelegationTool,
  ForegroundSubagentCoordinator,
} from "../agent/subagents/coordinator.js";
import {
  createTaskRuntimeSnapshot,
  type TaskInFlightMarker,
  type TaskRuntimeRehydration,
  type TaskRuntimeSnapshot,
} from "../agent/task-runtime-state.js";
import { reviewWorkspaceChange } from "../agent/workspace-review.js";
import { runCodeReview } from "../agent/code-review-agent.js";
import {
  extractObjectivePaths,
  reviewCodingObjective,
} from "../agent/objective-review.js";
import { isGreenfieldObjective } from "../agent/task-contract.js";
import {
  hasVerifiedCodingScope,
  inspectVerifiedPreparationTargets,
  selectProgressiveTargets,
} from "../agent/progressive-plan.js";
import { recommendedAgentContextChars } from "../agent/context-budget.js";
import {
  requiresModelPlan,
  selectExecutionProfile,
} from "../agent/execution-profile.js";
import { repositorySnapshotMemoryFacts } from "../context/repository-snapshot.js";
import { createTaskEpisodeMemoryFact } from "../shared/memory.js";
import { AppEventBus } from "../shared/events.js";
import { CircuitBreaker } from "../providers/circuit-breaker.js";
import { persistRepositorySettings } from "../config/settings.js";
import {
  createUICommands,
  rankUICommands,
  type UICommand,
} from "./commands/registry.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { SlashCommandMenu } from "./components/SlashCommandMenu.js";
import { Composer } from "./components/Composer.js";
import { ApprovalDialog } from "./components/ApprovalDialog.js";
import { ContextPicker } from "./components/ContextPicker.js";
import { ModelPicker } from "./components/ModelPicker.js";
import { Inspector, Sidebar } from "./components/Navigation.js";
import { StatusBar } from "./components/StatusBar.js";
import { TopBar } from "./components/TopBar.js";
import {
  legacyTranscriptItems,
  Transcript,
  type TranscriptMessage,
} from "./components/Transcript.js";
import {
  beginTranscriptTurn,
  createTranscriptPresentation,
  presentAppEvent,
  type TranscriptPresentation,
} from "./presentation/adapter.js";
import { createPresentationEventBuffer } from "./presentation/event-buffer.js";
import type { TranscriptItem } from "./presentation/types.js";
import { themeColor, getTheme, type ThemeTokens } from "./theme/tokens.js";
import {
  getCoreContentGeometry,
  getCoreVerticalLayout,
  getLayoutProfile,
} from "./state/layout.js";
import { resolveEscapeAction } from "./state/navigation.js";
import { addPromptToHistory, navigatePromptHistory } from "./state/history.js";
import { orderModelsForPicker } from "./state/search.js";
import { moveSettingIndex } from "./state/settings.js";
import { APPROVAL_OPTIONS, approvalDecisionForKey } from "./state/approval.js";
import {
  createUIFixture,
  readUIFixture,
  type UIFixtureKind,
} from "./state/fixtures.js";
import {
  ChangesView,
  GenericCenterView,
  ModelsView,
  PermissionsView,
  PrivacyView,
  ProvidersView,
  QuotaView,
  RoutingView,
  SetupView,
  SettingsView,
  SessionsView,
  type CenterScreen,
  type ModelCenterData,
} from "./views/Centers.js";
import {
  HomeView,
  homeSuggestions,
  moveHomeSuggestionIndex,
} from "./views/HomeView.js";

type AppScreen = "conversation" | "setup" | CenterScreen;
type Overlay =
  "none" | "palette" | "slash" | "context-picker" | "model-picker" | "approval";
type RouteExecutionStrategy = "direct" | "progressive" | "discovery";

interface ActiveApproval {
  description: string;
  impact: string;
  scopeDescription?: string;
  request?: ToolApprovalRequest;
  resolve?: (allowed: boolean) => void;
}
type WithoutTranscriptIdentity<T> = T extends unknown
  ? Omit<T, "id" | "turnId">
  : never;
type NewTranscriptItem = WithoutTranscriptIdentity<TranscriptItem>;

const NON_FILE_AT_RULES = new Set([
  "charset",
  "container",
  "counter-style",
  "document",
  "font-face",
  "import",
  "keyframes",
  "layer",
  "media",
  "namespace",
  "page",
  "property",
  "scope",
  "starting-style",
  "supports",
]);

function isActiveFileReference(value: string): boolean {
  const atIndex = value.lastIndexOf("@");
  if (atIndex < 0) return false;
  if (atIndex > 0 && !/\s/.test(value[atIndex - 1] ?? "")) return false;

  const query = value.slice(atIndex + 1);
  if (query.length === 0) return true;
  if (/\s|[()[\]{};,]/.test(query)) return false;
  return !NON_FILE_AT_RULES.has(query.toLowerCase());
}

function presentationFromLegacy(
  messages: readonly TranscriptMessage[],
  streamingText = "",
): TranscriptPresentation {
  const items = legacyTranscriptItems(messages);
  const activeTurnId = items.at(-1)?.turnId;
  if (streamingText) {
    const turnId = activeTurnId ?? "fixture-turn";
    items.push({
      kind: "assistant-text",
      id: `${turnId}-streaming`,
      turnId,
      text: streamingText,
      streaming: true,
    });
  }
  return { items, ...(activeTurnId ? { activeTurnId } : {}) };
}

function routeLines(decision: RouteDecision): string[] {
  const selected = decision.selected;
  const lines = selected
    ? [
        `Task      ${decision.task?.class ?? "unknown"} · ${decision.task?.opportunityCost ?? "unknown"}`,
        `Policy    ${decision.repositoryPolicy ?? "unknown"} · ${decision.routingMode ?? "unknown"}`,
        `Selected  ${selected.candidate.providerId} / ${selected.candidate.displayName}`,
        `Score     ${selected.score.toFixed(2)}`,
        `Why       ${decision.explanation}`,
      ]
    : [
        `Task      ${decision.task?.class ?? "unknown"}`,
        `Policy    ${decision.repositoryPolicy ?? "unknown"} · ${decision.routingMode ?? "unknown"}`,
        "Selected  STOP · ASK USER",
        `Why       ${decision.explanation}`,
      ];
  if (decision.rejections.length > 0) {
    lines.push("Rejected");
    for (const rejection of decision.rejections) {
      lines.push(`  ${rejection.providerId} · ${rejection.reasons.join("; ")}`);
    }
  }
  return lines;
}

function fitLine(value: string, width: number): string {
  const maxWidth = Math.max(16, width - 4);
  if (value.length <= maxWidth) return value;
  if (maxWidth <= 3) return value.slice(0, maxWidth);
  return `${value.slice(0, maxWidth - 3)}...`;
}

function modelLines(result: ModelCenterData, width: number): string[] {
  const lines = ["Recommended for this machine"];
  if (result.recommendations.length === 0) {
    lines.push("  No llmfit recommendations; fallback detection is active.");
  }
  for (const [index, recommendation] of result.recommendations
    .slice(0, 3)
    .entries()) {
    lines.push(
      `  ${index === 0 ? "BEST FIT" : index === 1 ? "FAST" : "STRETCH"}  ${recommendation.displayName}`,
    );
  }
  lines.push("Local and free cloud catalog");
  for (const model of result.models.slice(0, width < 100 ? 8 : 20)) {
    lines.push(
      `  ${model.source === "local" ? "LOCAL" : "FREE"}  ${model.providerId} / ${fitLine(model.displayName, width)}`,
    );
  }
  if (result.models.length > 20) {
    lines.push(`  ... ${result.models.length - 20} more models`);
  }
  return lines;
}

function privacyLabel(policy: RepositoryPrivacy): string {
  switch (policy) {
    case "local_only":
      return "LOCAL ONLY";
    case "private_zdr_only":
      return "PRIVATE · ZDR";
    case "trusted_cloud":
      return "TRUSTED CLOUD";
    case "public_free":
      return "PUBLIC FREE";
    case "private":
    default:
      return "PRIVATE";
  }
}

function LandingView(props: {
  theme: ThemeTokens;
  width: number;
  hardware?: HardwareInspection;
  providers: ProviderStatus[];
  model?: string;
  workspace?: string;
  branch?: string;
}) {
  const colors = props.theme.colors;
  const profile = props.hardware?.profile;
  const connected = props.providers.filter(
    (provider) => provider.configured,
  ).length;
  const compact = props.width < 110;
  const hardwareLine = `HARDWARE ${profile?.cpuModel ?? "Detecting machine…"}${profile ? ` · ${profile.memoryGb} GB · ${profile.accelerator}` : ""}`;
  const pathLine = compact
    ? `PATH  Local → Free → Ask · ${connected} free provider${connected === 1 ? "" : "s"}`
    : `Paid auto-routing disabled · ${connected} free provider${connected === 1 ? "" : "s"} connected`;
  const detail = compact
    ? `PROJECT  ${props.workspace ?? "workspace"} · ${props.branch ?? "main"}\n${hardwareLine}\n\n${pathLine}\n\nCtrl+P commands · / slash actions`
    : `PROJECT  ${props.workspace ?? "workspace"} · ${props.branch ?? "main"}\n${hardwareLine}\n\nREADY PATH\nLocal → Verified free cloud → Stop & ask\n${pathLine}${props.model ? `\nActive local model · ${props.model}` : ""}\n\nTRY\n› Explain this repository\n› Find failing tests\n› Review uncommitted changes\n\nPress Ctrl+P for commands · type / to browse`;
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      gap={1}
      paddingX={2}
      paddingY={1}
      justifyContent={props.width >= 110 ? "center" : "flex-start"}
    >
      <text fg={themeColor(props.theme, colors.purple[300])}>
        <strong>◈</strong>
      </text>
      <text fg={themeColor(props.theme, colors.text.primary)}>
        <strong>Intelligence that runs your way.</strong>
      </text>
      <text fg={themeColor(props.theme, colors.text.secondary)}>
        Local · Free · Private
      </text>
      <text
        width="100%"
        wrapMode="word"
        fg={themeColor(props.theme, colors.text.secondary)}
      >
        {detail}
      </text>
    </box>
  );
}

export function AppShell(
  props: {
    onExit?: () => void;
    onActionReady?: (run: (id: string) => void) => void;
    onActivityToggle?: (id: string) => void;
    initialScreen?: "conversation" | "setup";
    fixture?: UIFixtureKind;
  } = {},
) {
  const theme = getTheme();
  const dimensions = useTerminalDimensions();
  const initialFixture = props.fixture ?? readUIFixture();
  const initialAppScreen: AppScreen =
    props.initialScreen ??
    (initialFixture === "models"
      ? "models"
      : initialFixture === "settings"
        ? "settings"
        : initialFixture === "diff" ||
            initialFixture === "provider-error" ||
            initialFixture === "providers"
          ? initialFixture === "diff"
            ? "diff"
            : "providers"
          : initialFixture === "usage"
            ? "quota"
            : initialFixture === "routing"
              ? "routing"
              : initialFixture === "sessions"
                ? "sessions"
                : "conversation");
  const initialOverlay: Overlay =
    initialFixture === "palette"
      ? "palette"
      : initialFixture === "model-picker"
        ? "model-picker"
        : initialFixture === "context-picker"
          ? "context-picker"
          : initialFixture === "approval"
            ? "approval"
            : "none";
  const initialFixtureState: ReturnType<typeof createUIFixture> = initialFixture
    ? createUIFixture(initialFixture)
    : {};
  const [screen, setScreen] = createSignal<AppScreen>(initialAppScreen);
  const [composerValue, setComposerValue] = createSignal("");
  const [promptHistory, setPromptHistory] = createSignal<string[]>([]);
  let promptHistoryIndex = -1;
  let promptHistoryDraft = "";
  const [paletteQuery, setPaletteQuery] = createSignal("");
  const [paletteDraft, setPaletteDraft] = createSignal<string | undefined>();
  const [modelPickerDraft, setModelPickerDraft] = createSignal<
    string | undefined
  >();
  const [paletteIndex, setPaletteIndex] = createSignal(0);
  const [recentCommandIds, setRecentCommandIds] = createSignal<string[]>([]);
  const [modelQuery, setModelQuery] = createSignal("");
  const [modelIndex, setModelIndex] = createSignal(0);
  const [contextQuery, setContextQuery] = createSignal("");
  const [contextIndex, setContextIndex] = createSignal(0);
  const [contextCandidates, setContextCandidates] = createSignal<string[]>(
    initialFixtureState.contextCandidates ?? [],
  );
  const [activeModelId, setActiveModelId] = createSignal<string>();
  const [overlay, setOverlay] = createSignal<Overlay>(initialOverlay);
  const [activeApproval, setActiveApproval] = createSignal<
    ActiveApproval | undefined
  >(
    initialFixture === "approval"
      ? {
          description: "npm publish",
          impact: "This creates an external side effect.",
        }
      : undefined,
  );
  const [lines, setLines] = createSignal<string[]>(
    initialFixtureState.lines ?? [],
  );
  const [notice, setNotice] = createSignal(
    initialFixtureState.busy ? "Working" : "Ready · local-first · strict-zero",
  );
  const [taskBusy, setTaskBusy] = createSignal(
    initialFixtureState.busy ?? false,
  );
  // Drives the status-bar spinner and elapsed-time readout while a task
  // runs. `spinnerTick` itself is never read for its value — it exists so a
  // reactive computation that reads it recomputes every tick.
  const [spinnerTick, setSpinnerTick] = createSignal(0);
  // A fixture can freeze this at a fixed elapsed time for deterministic
  // captures (docs/ui-chat-v2) instead of a live Date.now() clock.
  const [taskStartedAt, setTaskStartedAt] = createSignal<number | undefined>(
    initialFixtureState.busy
      ? Date.now() - (initialFixtureState.elapsedSeconds ?? 0) * 1_000
      : undefined,
  );
  let busyClockInterval: ReturnType<typeof setInterval> | undefined;
  const beginBusyClock = (): void => {
    setTaskStartedAt(Date.now());
    setSpinnerTick(0);
    if (busyClockInterval) clearInterval(busyClockInterval);
    busyClockInterval = setInterval(() => setSpinnerTick((n) => n + 1), 120);
  };
  const endBusyClock = (): void => {
    if (busyClockInterval) clearInterval(busyClockInterval);
    busyClockInterval = undefined;
    setTaskStartedAt(undefined);
  };
  const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const spinnerFrame = () =>
    SPINNER_FRAMES[spinnerTick() % SPINNER_FRAMES.length] ?? "⠋";
  const elapsedSeconds = () => {
    void spinnerTick(); // establish the tracked dependency
    const startedAt = taskStartedAt();
    return startedAt
      ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
      : 0;
  };
  const [lastDecision, setLastDecision] = createSignal<
    RouteDecision | undefined
  >(initialFixtureState.decision);
  const [activeObjective, setActiveObjective] = createSignal(
    initialFixtureState.objective ?? "",
  );
  const [expandedTools, setExpandedTools] = createSignal(
    initialFixtureState.expandTools ?? false,
  );
  // Information-density mode (docs/ui-chat-v2 §29), distinct from the
  // spacing-only `density` signal below. Focus hides route-change noise
  // and keeps tool activity collapsed to one-line summaries + diffstats;
  // Verbose force-expands every tool's technical detail; Default is
  // today's existing behavior (manual per-activity expand/collapse).
  const [presentationDensity, setPresentationDensity] = createSignal<
    "focus" | "default" | "verbose"
  >("default");
  const cycleDensity = (): void => {
    const order = ["default", "focus", "verbose"] as const;
    const next =
      order[(order.indexOf(presentationDensity()) + 1) % order.length]!;
    setPresentationDensity(next);
    setNotice(
      next === "focus"
        ? "Focus · essentials only"
        : next === "verbose"
          ? "Verbose · full technical detail"
          : "Default detail",
    );
  };
  const [presentation, setPresentation] = createSignal<TranscriptPresentation>(
    initialFixtureState.presentation ??
      presentationFromLegacy(
        initialFixtureState.messages ?? [],
        initialFixtureState.streamingText,
      ),
  );
  // Whichever abstract phase AgentMatrixPulse is currently showing for this
  // turn (undefined once a concrete tool starts, or once idle) — the single
  // source of truth both the transcript and the status bar read to avoid
  // ever showing two busy indicators ("Testing" + a second "Working"
  // spinner) at once (docs/ui-chat-v2, "no duplication").
  const agentMatrixPhase = () =>
    taskBusy() ? presentation().agentPhase : undefined;
  const hasConcreteActiveWork = () =>
    Boolean(presentation().runningVerification) ||
    presentation().items.some(
      (item) =>
        item.kind === "activity-group" &&
        item.activities.some((activity) => activity.state === "running"),
    );
  const [modelData, setModelData] = createSignal<ModelCenterData | undefined>(
    initialFixtureState.modelData,
  );
  const [providers, setProviders] = createSignal<ProviderStatus[]>(
    initialFixtureState.providers ?? [],
  );
  const [quotas, setQuotas] = createSignal<
    Record<string, import("../shared/types.js").QuotaSnapshot>
  >(initialFixtureState.quotas ?? {});
  const [hardware, setHardware] = createSignal<HardwareInspection>();
  const [contextFiles, setContextFiles] = createSignal<string[]>([]);
  const [privacy, setPrivacy] = createSignal<RepositoryPrivacy>("private");
  const [routingMode, setRoutingMode] =
    createSignal<RoutingMode>("strict-zero");
  const [permissionMode, setPermissionMode] =
    createSignal<PermissionMode>("ASK");
  const [permissionRules, setPermissionRules] = createSignal<PermissionGrant[]>(
    [],
  );
  const [sessionPermissionGrants, setSessionPermissionGrants] = createSignal<
    PermissionGrant[]
  >([]);
  const [permissionRuleIndex, setPermissionRuleIndex] = createSignal(0);
  const [approvalIndex, setApprovalIndex] = createSignal(0);
  const [approvalBusy, setApprovalBusy] = createSignal(false);
  let approvalResolutionInFlight = false;
  const [density, setDensity] = createSignal<"comfortable" | "compact">(
    "comfortable",
  );
  const [reducedMotion, setReducedMotion] = createSignal(false);
  const [settingsIndex, setSettingsIndex] = createSignal(0);
  const [settingsQuery, setSettingsQuery] = createSignal("");
  const [providerActionIndex, setProviderActionIndex] = createSignal(0);
  const [sessions, setSessions] = createSignal<SessionSummary[]>(
    initialFixtureState.sessions ?? [],
  );
  const [sessionIndex, setSessionIndex] = createSignal(0);
  const [branch, setBranch] = createSignal("main");
  const [gitDirty, setGitDirty] = createSignal(Boolean(initialFixture));
  const [homeSuggestionIndex, setHomeSuggestionIndex] = createSignal(-1);
  const [focusedActivityId, setFocusedActivityId] = createSignal<string>();
  const [expandedActivityIds, setExpandedActivityIds] = createSignal<
    ReadonlySet<string>
  >(new Set());
  const [sidebarHidden, setSidebarHidden] = createSignal(false);
  const [setupStage, setSetupStage] = createSignal(
    props.initialScreen === "setup" ? 0 : 6,
  );
  let activeTaskAbort: AbortController | undefined;
  let selectedSessionId: string | undefined;
  let composerEditor: TextareaRenderable | undefined;
  let transcriptViewport: ScrollBoxRenderable | undefined;
  let lastCheckpointId: string | undefined;
  const routeCircuitBreaker = new CircuitBreaker();

  const focusComposer = (): void => {
    setTimeout(() => composerEditor?.focus(), 0);
  };

  const width = () => dimensions().width;
  const height = () => dimensions().height;
  const workspace = path.basename(process.cwd()) || "workspace";
  const layout = createMemo(() => getLayoutProfile(width()));
  const colors = theme.colors;
  let uiCommands: UICommand[] = [];
  const paletteItems = createMemo(() =>
    rankUICommands(uiCommands, paletteQuery(), recentCommandIds()).slice(0, 12),
  );
  // "/model" (and Claude Code's own "/model opus" inline-argument pattern —
  // https://www.datacamp.com/tutorial/claude-code-slash-commands) resolves
  // entirely within the same SlashCommandMenu sheet instead of handing off
  // to a separate full-screen ModelPicker overlay. Direct user feedback:
  // "cuando selecciono modelo me lleva a otro lugar... todo debe manejarse
  // desde ese mismo bottomsheet".
  const slashModelQuery = createMemo(() => {
    const match = /^\/model(?:\s+(.*))?$/i.exec(composerValue());
    return match ? (match[1] ?? "") : undefined;
  });
  const isSlashModelMode = () => slashModelQuery() !== undefined;
  const slashModelCandidates = createMemo(() =>
    isSlashModelMode()
      ? [
          undefined,
          ...orderModelsForPicker(
            modelData()?.models ?? [],
            slashModelQuery() ?? "",
          ),
        ]
      : [],
  );
  // What SlashCommandMenu actually renders — commands or, in model mode,
  // the same candidate list ModelPicker shows, reshaped into generic rows.
  const slashMenuRows = createMemo(() =>
    isSlashModelMode()
      ? slashModelCandidates().map((model) =>
          model
            ? {
                id: model.id,
                primary: `${model.id === activeModelId() ? "* " : "  "}${model.displayName}`,
                secondary:
                  model.source === "local"
                    ? (model.local?.runtime ?? "local")
                    : model.providerId,
              }
            : {
                id: "auto",
                primary: `${activeModelId() ? "  " : "* "}Auto`,
                secondary: "local first",
              },
        )
      : paletteItems().map((command) => ({
          id: command.id,
          primary: command.slash ?? `/${command.id}`,
          secondary: command.description ?? command.label,
        })),
  );
  const selectedRoute = createMemo(() => lastDecision()?.selected?.candidate);
  const routeLabel = createMemo(() =>
    selectedRoute()?.source === "free_cloud" ? "FREE" : "LOCAL",
  );
  const modelLabel = createMemo(
    () =>
      selectedRoute()?.displayName ??
      modelData()?.models.find((model) => model.id === activeModelId())
        ?.displayName ??
      modelData()?.models.find((model) => model.source === "local")
        ?.displayName,
  );
  const privacyText = createMemo(() => privacyLabel(privacy()));

  const show = (next: AppScreen, nextLines: string[] = []): void => {
    setScreen(next);
    setLines(nextLines);
  };

  const appendTranscriptItem = (item: NewTranscriptItem): void => {
    setPresentation((current) => {
      const turnId = current.activeTurnId ?? "system";
      return {
        ...current,
        items: [
          ...current.items,
          {
            ...item,
            id: `${turnId}-${item.kind}-${current.items.length + 1}`,
            turnId,
          } as TranscriptItem,
        ],
      };
    });
  };

  const appendError = (title: string, detail?: string): void => {
    appendTranscriptItem({
      kind: "error-notice",
      title,
      detail,
      recoverable: true,
    });
  };

  const refreshModelData = async (): Promise<void> => {
    const { openControlPlane } = await import("../cli/control-plane.js");
    const controlPlane = await openControlPlane(process.cwd());
    try {
      const [result, inspection] = await Promise.all([
        controlPlane.discoverModels(AbortSignal.timeout(2_000)),
        controlPlane.inspectHardware(),
      ]);
      setModelData(result);
      setQuotas(result.quotas);
      setProviders(controlPlane.providers.statuses);
      setPrivacy(controlPlane.settings.privacy);
      setRoutingMode(controlPlane.settings.routingMode);
      setPermissionMode(controlPlane.settings.permissionMode);
      setPermissionRules(controlPlane.settings.permissionRules);
      setHardware(inspection);
    } finally {
      controlPlane.close();
    }
  };

  createEffect(() => {
    if (isSlashModelMode() && !modelData())
      void refreshModelData().catch(() => undefined);
  });

  const openModelPicker = (): void => {
    setModelPickerDraft(composerValue());
    setOverlay("model-picker");
    setModelQuery("");
    setModelIndex(0);
    setNotice("Choose a model · Auto keeps local-first routing");
    if (!modelData()) void refreshModelData().catch(() => undefined);
  };

  const modelPickerItems = createMemo(() => [
    undefined,
    ...orderModelsForPicker(modelData()?.models ?? [], modelQuery()),
  ]);

  const contextPickerItems = createMemo(() => {
    const query = contextQuery().trim().toLowerCase();
    return query
      ? contextCandidates().filter((file) => file.toLowerCase().includes(query))
      : contextCandidates();
  });

  const openContextPicker = (query = ""): void => {
    setOverlay("context-picker");
    setContextQuery(query);
    setContextIndex(0);
    setNotice("Choose repository context");
    if (contextCandidates().length === 0) {
      void import("../context/repository.js")
        .then(({ listRepositoryFiles }) =>
          listRepositoryFiles(process.cwd(), AbortSignal.timeout(5_000)),
        )
        .then(setContextCandidates)
        .catch((error: unknown) => {
          setNotice(
            error instanceof Error
              ? `Context discovery failed · ${error.message}`
              : "Context discovery failed",
          );
        });
    }
  };

  const closeContextPicker = (): void => {
    setOverlay("none");
    setContextQuery("");
    setContextIndex(0);
    setNotice(
      contextFiles().length > 0
        ? `${contextFiles().length} context file${contextFiles().length === 1 ? "" : "s"} selected`
        : "Automatic context selection",
    );
    focusComposer();
  };

  const toggleContextFile = (file: string): void => {
    setContextFiles((current) =>
      current.includes(file)
        ? current.filter((candidate) => candidate !== file)
        : [...current, file],
    );
  };

  const resolveApproval = async (decision: ApprovalDecision): Promise<void> => {
    if (approvalResolutionInFlight) return;
    const approval = activeApproval();
    const initialMessage =
      decision === "session"
        ? "Approval granted for this session"
        : decision === "project"
          ? "Approval saved for this project"
          : decision === "once"
            ? "Approval granted once"
            : decision === "cancel"
              ? "Turn cancelled"
              : "Approval denied";
    if (!approval) {
      batch(() => {
        setOverlay("none");
        setNotice(initialMessage);
      });
      focusComposer();
      return;
    }

    approvalResolutionInFlight = true;
    setApprovalBusy(true);
    let allowed =
      decision === "once" || decision === "session" || decision === "project";
    let message = initialMessage;
    try {
      // Keep the approval surface mounted until a project rule is actually
      // persisted. Closing it first made a slow filesystem write look like a
      // second agent freeze and allowed duplicate key events to race the
      // unresolved tool request.
      if (decision === "project" && approval.request)
        setNotice("Saving project permission rule…");

      if (allowed && approval.request && decision !== "once") {
        const grant = createPermissionGrant(
          decision === "project" ? "project" : "session",
          approval.request,
        );
        if (decision === "session") {
          setSessionPermissionGrants((current) =>
            addPermissionGrant(current, grant),
          );
        } else if (!isPermissionGrantPersistable(grant)) {
          allowed = false;
          message =
            "Project permission rule was not saved because the command contains secret-shaped data";
        } else {
          const nextRules = addPermissionGrant(permissionRules(), grant);
          try {
            await persistRepositorySettings(process.cwd(), {
              permissionRules: nextRules,
            });
            setPermissionRules(nextRules);
          } catch (error) {
            allowed = false;
            message =
              error instanceof Error
                ? `Permission rule could not be saved · ${error.message}`
                : "Permission rule could not be saved";
          }
        }
      }

      if (decision === "cancel") activeTaskAbort?.abort();
      batch(() => {
        setActiveApproval(undefined);
        setOverlay("none");
        setApprovalBusy(false);
      });
      // Keep this final status update outside the overlay batch. The custom
      // terminal renderer flushes its last visible update from this setter;
      // otherwise the resolved approval can remain painted until another
      // event arrives even though the request has already been answered.
      setNotice(message);
      approval.resolve?.(allowed);
      focusComposer();
    } finally {
      approvalResolutionInFlight = false;
      setApprovalBusy(false);
    }
  };

  const chooseModel = (
    selected?: import("../shared/types.js").ModelCandidate,
  ): void => {
    const choice = selected ?? modelPickerItems()[modelIndex()];
    // Same reasoning as handleComposerInput's batch(): several signals
    // here (overlay in particular) would otherwise flush separately,
    // letting anything reading them mid-function see a state this
    // function never actually settles on.
    batch(() => {
      setActiveModelId(choice?.id);
      setOverlay("none");
      setModelQuery("");
      setModelIndex(0);
      setModelPickerDraft(undefined);
      setNotice(
        choice
          ? `Model selected · ${choice.displayName}`
          : "Model selection reset · Auto",
      );
    });
    focusComposer();
  };

  const loadCenter = async (target: CenterScreen): Promise<void> => {
    setNotice(`Opening ${target.replace("-", " ")}…`);
    try {
      if (target === "routing" || target === "explain-route") {
        show(
          target === "explain-route" ? "explain-route" : "routing",
          lastDecision()
            ? routeLines(lastDecision() as RouteDecision)
            : [
                "Task → Sensitivity → Capabilities → Eligible routes → Score",
                "Privacy and cost gates run before quality scoring.",
                "Submit a task to create a live route explanation.",
              ],
        );
        setNotice("Routing center");
        return;
      }
      if (target === "plan") {
        const { analyzeTask } = await import("../router/task-analysis.js");
        const objective = activeObjective();
        const analysis: TaskAnalysis = analyzeTask(
          objective || "inspect this repository",
        );
        show("plan", [
          `Objective   ${objective || "inspect this repository"}`,
          `Class       ${analysis.class}`,
          `Complexity  ${analysis.complexity.toFixed(2)}`,
          `Context     ${analysis.contextNeed} tokens`,
          `Tool need   ${analysis.toolNeed ? "yes" : "no"}`,
          `Risk        ${analysis.risk.toFixed(2)}`,
          `Quota use   ${analysis.opportunityCost}`,
        ]);
        setNotice("Task plan");
        return;
      }
      if (target === "checkpoint" || target === "rollback") {
        if (target === "rollback" && activeTaskAbort) {
          show("rollback", [
            "Finish or cancel the active task before rollback.",
          ]);
          setNotice("Rollback paused while a task is active");
          return;
        }
        if (target === "rollback" && !lastCheckpointId) {
          show("rollback", [
            "No LocalCode checkpoint is available for rollback.",
          ]);
          setNotice("Nothing to roll back");
          return;
        }
        if (target === "checkpoint") {
          show("checkpoint", [
            lastCheckpointId
              ? `Last checkpoint  ${lastCheckpointId}`
              : "No LocalCode checkpoint has been created yet.",
            "Created automatically before the first mutation.",
            "Rollback refuses to overwrite an external change.",
          ]);
          setNotice("Checkpoint center");
          return;
        }
        const { openControlPlane } = await import("../cli/control-plane.js");
        const { CheckpointService } =
          await import("../checkpoint/checkpoint.js");
        const controlPlane = await openControlPlane(process.cwd());
        try {
          const result = await new CheckpointService(
            controlPlane.db,
            process.cwd(),
          ).rollback(lastCheckpointId as string);
          show("rollback", [
            `Checkpoint  ${lastCheckpointId}`,
            `Restored    ${result.restored.join(", ") || "none"}`,
            `Conflicts   ${result.conflicts.map((conflict) => `${conflict.path} (${conflict.reason})`).join(", ") || "none"}`,
            result.conflicts.length === 0
              ? "LocalCode-owned changes were restored."
              : "Rollback stopped for conflicting external changes.",
          ]);
          setNotice(
            result.conflicts.length === 0
              ? "Rollback complete"
              : "Rollback stopped on conflict",
          );
        } finally {
          controlPlane.close();
        }
        return;
      }
      if (
        target === "settings" ||
        target === "permissions" ||
        target === "sessions" ||
        target === "help"
      ) {
        if (target === "help") {
          show(
            "help",
            uiCommands
              .filter((command) => command.visible?.() !== false)
              .map(
                (command) =>
                  `${command.slash ?? `/${command.id}`}  ${command.description ?? command.label}`,
              ),
          );
          setNotice("Help · Ctrl+P to search");
        } else if (target === "permissions") {
          const { openControlPlane } = await import("../cli/control-plane.js");
          const controlPlane = await openControlPlane(process.cwd());
          try {
            setPermissionMode(controlPlane.settings.permissionMode);
            setPermissionRules(controlPlane.settings.permissionRules);
          } finally {
            controlPlane.close();
          }
          setPermissionRuleIndex(0);
          show("permissions");
          setNotice("Permissions · saved rules");
        } else if (target === "sessions") {
          const { openControlPlane } = await import("../cli/control-plane.js");
          const controlPlane = await openControlPlane(process.cwd());
          try {
            const records = controlPlane.db.listSessions();
            setSessions(records);
            setSessionIndex(0);
            show(
              "sessions",
              records.length > 0
                ? records.map(
                    (session) =>
                      `${session.objective} · ${session.updatedAt.slice(0, 10)}`,
                  )
                : [
                    "No saved sessions yet.",
                    "Submit a task to create a local timeline.",
                  ],
            );
          } finally {
            controlPlane.close();
          }
          setNotice("Sessions");
        } else {
          setSettingsIndex(0);
          setSettingsQuery("");
          show("settings");
          setNotice("Settings · Obsidian Violet");
        }
        return;
      }

      const { openControlPlane } = await import("../cli/control-plane.js");
      const controlPlane = await openControlPlane(process.cwd());
      setNotice("Loading local providers…");
      try {
        if (target === "models") {
          const result = await controlPlane.discoverModels(
            AbortSignal.timeout(2_000),
          );
          setModelData(result);
          setQuotas(result.quotas);
          setProviders(controlPlane.providers.statuses);
          show("models", modelLines(result, width()));
        } else if (target === "providers") {
          setProviders(controlPlane.providers.statuses);
          show(
            "providers",
            controlPlane.providers.statuses.flatMap((provider) => [
              `${provider.configured ? "connected" : "not configured"} · ${provider.displayName}`,
              `  endpoint  ${provider.endpoint}`,
              `  free      ${provider.freeStatus}`,
              `  privacy   ${provider.privacy}`,
              `  ${provider.note}`,
            ]),
          );
        } else if (target === "doctor") {
          const [inspection, runtimes] = await Promise.all([
            controlPlane.inspectHardware(),
            controlPlane.discoverRuntimes(AbortSignal.timeout(1_500)),
          ]);
          setHardware(inspection);
          show("doctor", [
            `OS          ${inspection.profile.os}`,
            `CPU         ${inspection.profile.cpuModel} (${inspection.profile.cpuCores} cores)`,
            `Memory      ${inspection.profile.memoryGb} GB`,
            `Accelerator ${inspection.profile.accelerator}`,
            `llmfit      ${inspection.llmfitAvailable ? "available" : "fallback detection"}`,
            "Runtimes",
            ...runtimes.detections.map(
              (runtime) =>
                `  ${runtime.installed ? "ready" : "not found"} · ${runtime.displayName}${runtime.endpoint ? ` · ${runtime.endpoint}` : ""}`,
            ),
          ]);
        } else if (target === "quota") {
          const nextQuotas: Record<
            string,
            import("../shared/types.js").QuotaSnapshot
          > = {};
          const quotaLines = ["Provider quota snapshots"];
          for (const provider of controlPlane.providers.adapters) {
            const quota = await provider.quota(AbortSignal.timeout(1_500));
            controlPlane.db.recordQuota(quota);
            nextQuotas[provider.id] = quota;
            quotaLines.push(`  ${provider.displayName} · ${quota.confidence}`);
          }
          setQuotas(nextQuotas);
          show("quota", quotaLines);
        } else if (target === "privacy") {
          setPrivacy(controlPlane.settings.privacy);
          setRoutingMode(controlPlane.settings.routingMode);
          show("privacy", [
            `Repository policy  ${controlPlane.settings.privacy}`,
            `Routing mode       ${controlPlane.settings.routingMode}`,
            "Never remote       .env* credentials* secrets* *.pem *.key id_rsa*",
            "Cloud behavior      high-confidence secrets block the route",
            "Unknown retention   blocked for private policies",
          ]);
        } else if (target === "context") {
          const { buildRepositoryContext } =
            await import("../context/repository.js");
          const repository = process.cwd();
          const context = await buildRepositoryContext({
            root: repository,
            objective: activeObjective() || "inspect this repository",
            memoryFacts: controlPlane.db.listMemoryFacts(
              repository,
              "semantic",
            ),
            logger: controlPlane.logger,
          });
          if (context.snapshot) {
            for (const fact of repositorySnapshotMemoryFacts(
              context.snapshot,
              repository,
            )) {
              controlPlane.db.saveMemoryFact(fact);
            }
          }
          setContextFiles(context.files);
          show("context", [
            `Files discovered  ${context.files.length}`,
            `Files included    ${context.files.join(", ") || "none"}`,
            `Secret paths      ${context.secretPaths.join(", ") || "none"}`,
            `Cloud context     ${context.containsHighConfidenceSecret ? "blocked" : "eligible subject to route policy"}`,
          ]);
        } else if (target === "diff") {
          const { runCommand } = await import("../shared/process.js");
          const result = await runCommand("git", ["diff", "--"], {
            intent: "read",
            cwd: process.cwd(),
            timeoutMs: 5_000,
            logger: controlPlane.logger,
          });
          setDiffText(result.stdout.trim());
          setDiffHunkIndex(0);
          setDiffView("unified");
          show(
            "diff",
            (result.stdout || "No unstaged changes.")
              .trim()
              .split(/\r?\n/)
              .slice(0, 5),
          );
        }
        setNotice(`${target.replace("-", " ")} center`);
      } finally {
        controlPlane.close();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${target} failed`);
    }
  };

  const retryProviderHealth = async (): Promise<void> => {
    setNotice("Checking provider health...");
    try {
      const { openControlPlane } = await import("../cli/control-plane.js");
      const controlPlane = await openControlPlane(process.cwd());
      try {
        const result = await controlPlane.discoverModels(
          AbortSignal.timeout(2_000),
        );
        setModelData(result);
        setQuotas(result.quotas);
        setProviders(controlPlane.providers.statuses);
        show("providers");
      } finally {
        controlPlane.close();
      }
      setNotice("Provider health refreshed");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Health check failed · ${error.message}`
          : "Health check failed",
      );
    }
  };

  const openSelectedSession = async (
    selectedIndex = sessionIndex(),
  ): Promise<void> => {
    const session = sessions()[selectedIndex];
    if (!session) return;
    selectedSessionId = session.id;
    try {
      const { openControlPlane } = await import("../cli/control-plane.js");
      const controlPlane = await openControlPlane(process.cwd());
      try {
        const allowedRoles = new Set<TranscriptMessage["role"]>([
          "user",
          "assistant",
          "tool",
          "event",
          "route",
          "error",
        ]);
        const restored = controlPlane.db
          .listMessages(session.id)
          .flatMap((message) => {
            const role = allowedRoles.has(
              message.role as TranscriptMessage["role"],
            )
              ? (message.role as TranscriptMessage["role"])
              : undefined;
            return role ? [{ role, text: message.content }] : [];
          });
        setPresentation(presentationFromLegacy(restored));
        setActiveObjective(session.objective);
      } finally {
        controlPlane.close();
      }
      show("conversation");
      setNotice(`Session opened · ${session.objective}`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Session could not be opened",
      );
    }
  };

  const [diffText, setDiffText] = createSignal(
    initialFixtureState.diffText ?? "",
  );
  const [diffHunkIndex, setDiffHunkIndex] = createSignal(0);
  const [diffView, setDiffView] = createSignal<"unified" | "split">(
    process.env.LOCALCODE_UI_DIFF_VIEW === "split" ? "split" : "unified",
  );

  const runTask = async (
    objective: string,
    turnId: string,
    sessionId = turnId,
    resumeRuntime?: TaskRuntimeSnapshot,
    repositoryRoot = process.cwd(),
  ): Promise<void> => {
    const taskRoot = path.resolve(repositoryRoot);
    const taskAbort = new AbortController();
    activeTaskAbort = taskAbort;
    setTaskBusy(true);
    beginBusyClock();
    setNotice("Preparing response…");
    try {
      const [
        { openControlPlane },
        { analyzeTask },
        { selectRoute },
        { buildRepositoryContext },
        { discoverProjectCommands },
        { selectVerificationPlan },
        { runAgent },
        { runWithRouteFallback },
        { createAgentTraceRecorder },
        { workspaceTools },
        { CheckpointService },
        {
          requiredCapabilityForTurn,
          resolveTurnMode,
          resolveTurnPolicyForObjective,
        },
      ] = await Promise.all([
        import("../cli/control-plane.js"),
        import("../router/task-analysis.js"),
        import("../router/router.js"),
        import("../context/repository.js"),
        import("../context/project-commands.js"),
        import("../agent/verification-plan.js"),
        import("../agent/loop.js"),
        import("../router/route-fallback.js"),
        import("../agent/trace.js"),
        import("../tools/workspace.js"),
        import("../checkpoint/checkpoint.js"),
        import("../agent/turn-policy.js"),
      ]);
      const controlPlane = await openControlPlane(taskRoot);
      const signal = taskAbort.signal;
      const trace = createAgentTraceRecorder();
      const taskLogger = controlPlane.logger.child({
        component: "tui.task",
        sessionId,
        taskId: turnId,
        turnId,
      });
      taskLogger.info("tui.task.started", {
        objectiveLength: objective.length,
      });
      let unsubscribeEvents: (() => void) | undefined;
      let presentationEventBuffer:
        ReturnType<typeof createPresentationEventBuffer> | undefined;
      if (!controlPlane.db.sessionExists(sessionId))
        controlPlane.db.createSession(sessionId, taskRoot, objective);
      controlPlane.db.appendMessage(sessionId, "user", objective);
      try {
        // Tools follow user intent: classify the turn before deciding
        // whether repository context or workspace tools are needed at all.
        // A greeting or general-knowledge question never reaches the
        // ripgrep-backed repository scan below and never sees a mutation
        // tool, regardless of what the routed model decides to attempt.
        const turnMode = resolveTurnMode(objective, analyzeTask(objective));
        const turnPolicy = resolveTurnPolicyForObjective(turnMode, objective);
        const needsRepositoryContext = turnPolicy.repositoryRead;
        let semanticMemoryFacts = needsRepositoryContext
          ? controlPlane.db.listMemoryFacts(taskRoot, "semantic")
          : [];
        if (needsRepositoryContext) setNotice("Preparing repository context…");
        // Build a bounded routing context first. The selected model is not
        // known until discovery/routing completes, so this snapshot is only
        // for route scoring and deterministic evidence. The execution
        // context is rebuilt below with the selected model's active budget.
        const routingContext = needsRepositoryContext
          ? await buildRepositoryContext({
              root: taskRoot,
              objective,
              maxChars: 12_000,
              signal,
              explicitPaths: contextFiles(),
              memoryFacts: semanticMemoryFacts,
              memoryIds: resumeRuntime?.contextAnchor.memoryIds,
              instructionSources:
                resumeRuntime?.contextAnchor.instructionSources,
              logger: taskLogger,
            })
          : {
              files: [],
              prompt: "",
              instructions: [],
              relevantMatches: [],
              containsHighConfidenceSecret: false,
              secretPaths: [],
              evidenceState: "SUFFICIENT" as const,
              searchBackend: "not_needed" as const,
            };
        if (resumeRuntime) {
          const expectedRoot = path
            .resolve(resumeRuntime.repositoryRoot)
            .toLowerCase();
          const currentRoot = taskRoot.toLowerCase();
          if (expectedRoot !== currentRoot)
            throw new Error(
              "Cannot resume this task from a different repository root.",
            );
          const currentRevision = routingContext.snapshot?.revision;
          if (
            resumeRuntime.repositoryRevision &&
            currentRevision !== resumeRuntime.repositoryRevision
          )
            throw new Error(
              "Cannot resume this task because the repository revision changed.",
            );
          if (
            resumeRuntime.repositoryWorkingTreeRevision &&
            routingContext.snapshot?.workingTreeRevision !==
              resumeRuntime.repositoryWorkingTreeRevision
          )
            throw new Error(
              "Cannot resume this task because the working-tree state changed.",
            );
        }
        if (routingContext.snapshot) {
          for (const fact of repositorySnapshotMemoryFacts(
            routingContext.snapshot,
            taskRoot,
          )) {
            controlPlane.db.saveMemoryFact(fact);
          }
          semanticMemoryFacts = controlPlane.db.listMemoryFacts(
            taskRoot,
            "semantic",
          );
        }
        trace.record({
          taskId: turnId,
          type: "context.built",
          phase: "discover",
          data: {
            files: routingContext.files.length,
            instructions: routingContext.instructions?.length ?? 0,
            objectiveMatches: routingContext.relevantMatches?.length ?? 0,
            evidenceState: routingContext.evidenceState,
            searchBackend: routingContext.searchBackend,
            containsHighConfidenceSecret:
              routingContext.containsHighConfidenceSecret,
          },
        });
        const projectCommands = needsRepositoryContext
          ? await discoverProjectCommands(taskRoot, taskLogger)
          : {};
        const verificationPlan =
          turnMode === "coding" ? selectVerificationPlan(projectCommands) : [];
        const analyzedTask = analyzeTask(objective);
        const repositoryIsEmpty =
          routingContext.files.length === 0 &&
          routingContext.searchBackend !== "unavailable";
        const greenfieldIntent = isGreenfieldObjective(objective);
        const explicitObjectivePaths = extractObjectivePaths(objective);
        const progressiveTargets =
          analyzedTask.complexity >= 0.7
            ? selectProgressiveTargets(
                objective,
                explicitObjectivePaths,
                routingContext.relevantMatches ?? [],
              )
            : explicitObjectivePaths.slice(0, 8);
        const requiredCapability: AgentCapabilityClass =
          requiredCapabilityForTurn(
            turnMode,
            turnPolicy.repositoryRead,
            analyzedTask,
          );
        // A complex parent objective does not require one frontier-class
        // model when the host has already localized a bounded mutation scope.
        // The route remains a coding route, and runAgent enforces one target
        // at a time with checkpoints, verification and the final completion
        // gate. This is the controller-owned decomposition that lets an
        // measured local coding_agent contribute without relabelling it as
        // advanced_coding_agent.
        const verifiedPreparation =
          turnMode === "coding"
            ? await inspectVerifiedPreparationTargets(
                taskRoot,
                objective,
                progressiveTargets,
              )
            : [];
        const verifiedProgressiveTargets = verifiedPreparation.map(
          (target) => target.path,
        );
        const greenfieldCreationPaths =
          greenfieldIntent && explicitObjectivePaths.length > 0
            ? verifiedPreparation
                .filter((target) => !target.exists)
                .map((target) => target.path)
            : [];
        const verifiedCodingScope = hasVerifiedCodingScope({
          evidenceState: routingContext.evidenceState,
          greenfieldIntent,
          explicitPaths: explicitObjectivePaths,
          targets: verifiedPreparation,
        });
        // Any coding task without a host-proven scope must enter a safe local
        // discovery stage. The previous condition only covered the
        // advanced_coding_agent branch, so an ordinary coding_agent task could
        // still fall through to STOP · ASK USER before localization. Discovery
        // never receives mutation tools; its only job is to produce validated
        // scope for the next route selection.
        const probeCapability =
          turnMode === "coding" ? "chat_only" : requiredCapability;
        // Local capability probes execute a complete, disposable tool loop.
        // Thirty seconds is shorter than the observed cold/contended latency
        // of the loaded local models, so a transport timeout was being turned
        // into "no coding route" before the router ever saw behavioral
        // evidence. Keep ordinary discovery fast, but give a coding probe a
        // real budget; the probe itself remains bounded and cancellable.
        setNotice("Checking local model capability…");
        const catalog = await controlPlane.discoverModels(
          AbortSignal.timeout(
            turnPolicy.repositoryRead
              ? turnMode === "coding"
                ? 120_000
                : 30_000
              : 2_000,
          ),
          {
            probeLocalCapabilities: turnPolicy.repositoryRead,
            probeFreeCloudCapabilities:
              turnMode === "coding" &&
              controlPlane.settings.privacy !== "local_only",
            requiredCapability: probeCapability,
            preferredModelId: activeModelId(),
          },
        );
        setModelData(catalog);
        setQuotas(catalog.quotas);
        setProviders(controlPlane.providers.statuses);
        setPrivacy(controlPlane.settings.privacy);
        setRoutingMode(controlPlane.settings.routingMode);
        setNotice("Selecting a safe execution route…");
        const selectedModel = activeModelId()
          ? catalog.models.find((model) => model.id === activeModelId())
          : undefined;
        const providerForCandidate = (
          candidate: import("../shared/types.js").ModelCandidate,
        ) => {
          const runtime = catalog.runtime.adapters.find(
            (adapter) => adapter.id === candidate.providerId,
          );
          return (
            runtime?.provider?.() ??
            controlPlane.providers.adapters.find(
              (adapter) => adapter.id === candidate.providerId,
            )
          );
        };
        // Recommendations remain visible in the catalog, but only adapters
        // that can execute now may enter the route decision. This keeps an
        // advisory llmfit row from becoming a selected-but-unrunnable route.
        // A manually selected model is a preference, not a capability or
        // privacy bypass. Keep the complete executable catalog available so
        // an ineligible chat-only selection cannot suppress an eligible local
        // or verified-free fallback.
        const executableCandidates = catalog.models.filter((candidate) =>
          Boolean(providerForCandidate(candidate)),
        );
        const hasMeasuredCodingRoute = executableCandidates.some(
          (candidate) => {
            const capability = candidate.agentProbe?.agentCapabilityClass;
            return (
              capability === "coding_agent" ||
              capability === "advanced_coding_agent"
            );
          },
        );
        // Capability is a hard admission gate for mutation. If the current
        // local catalog has no measured coding route, keep the task alive in
        // a read-only preparation stage instead of surfacing STOP before the
        // host can gather better evidence.
        const progressiveExecution =
          turnMode === "coding" &&
          requiredCapability === "advanced_coding_agent" &&
          verifiedCodingScope;
        const directCodingExecution =
          turnMode === "coding" &&
          requiredCapability !== "advanced_coding_agent" &&
          verifiedCodingScope &&
          hasMeasuredCodingRoute;
        const emptyGreenfieldExecution =
          turnMode === "coding" &&
          repositoryIsEmpty &&
          greenfieldIntent &&
          hasMeasuredCodingRoute;
        const discoveryExecution =
          turnMode === "coding" &&
          !progressiveExecution &&
          !directCodingExecution &&
          !emptyGreenfieldExecution;
        const routeCapability = progressiveExecution
          ? "coding_agent"
          : discoveryExecution
            ? "chat_only"
            : requiredCapability;
        const task = {
          ...analyzedTask,
          toolNeed: discoveryExecution
            ? false
            : turnPolicy.allowedTools.length > 0,
          requiredCapability,
        };
        // Capability is an admission gate. Progressive execution is the only
        // bounded exception: the parent still requires advanced coding, while
        // the route request explicitly authorizes one host-scoped work unit.
        // A measured coding_agent is preferred, but a local chat_only model is
        // still allowed through the router's host-scaffolded fallback once the
        // controller has proven the scope. This prevents the old
        // chat_only -> STOP path without pretending that the model is advanced.
        const effectiveTask = task;
        const routeRequest = {
          now: new Date(),
          task: effectiveTask,
          repositoryPolicy: controlPlane.settings.privacy,
          routingMode: controlPlane.settings.routingMode,
          contextTokens: Math.max(
            1,
            Math.ceil(routingContext.prompt.length / 4),
          ),
          candidates: executableCandidates,
          preferredCandidateId:
            resumeRuntime?.route?.candidateId ?? selectedModel?.id,
          execution: {
            strategy: (progressiveExecution
              ? "progressive"
              : discoveryExecution
                ? "discovery"
                : "direct") as RouteExecutionStrategy,
            ...(progressiveExecution
              ? { boundedScope: verifiedProgressiveTargets }
              : {}),
          },
          quotas: catalog.quotas,
          circuitBreaker: routeCircuitBreaker,
          containsHighConfidenceSecret:
            routingContext.containsHighConfidenceSecret,
        };
        const decision = selectRoute(routeRequest, taskLogger);
        trace.record({
          taskId: turnId,
          type: "route.selected",
          phase: "frame",
          data: {
            selected: decision.selected?.candidate.id ?? "STOP",
            provider: decision.selected?.candidate.providerId ?? "none",
            requiredCapability: effectiveTask.requiredCapability,
            admissionCapability: routeCapability,
            executionStrategy: discoveryExecution
              ? "discovery"
              : progressiveExecution
                ? "progressive"
                : "direct",
            boundedScopeCount: verifiedProgressiveTargets.length,
            routingMode: controlPlane.settings.routingMode,
          },
        });
        setLastDecision(decision);
        const appEvents = new AppEventBus();
        presentationEventBuffer = createPresentationEventBuffer((event) => {
          setPresentation((current) => presentAppEvent(current, event));
        });
        unsubscribeEvents = appEvents.subscribe((event) => {
          if (event.type === "checkpoint.created") {
            lastCheckpointId = event.id;
          }
          presentationEventBuffer?.push(event);
        });
        appEvents.emit({ type: "route.selected", decision });
        controlPlane.db.recordRoute(
          sessionId,
          decision.selected?.candidate.id ?? "STOP",
          decision,
        );
        if (!decision.selected) {
          setNotice("Stopped by policy or capacity");
          show("routing", routeLines(decision));
          return;
        }
        const checkpoint = new CheckpointService(
          controlPlane.db,
          taskRoot,
          taskLogger,
        );
        const runSelectedAgent = async (
          selected: (typeof executableCandidates)[number],
          strategy: RouteExecutionStrategy = discoveryExecution
            ? "discovery"
            : progressiveExecution
              ? "progressive"
              : "direct",
          boundedScope: readonly string[] = verifiedProgressiveTargets,
        ) => {
          const executionMode = strategy === "discovery" ? "plan" : turnMode;
          const executionPolicy = resolveTurnPolicyForObjective(
            executionMode,
            objective,
          );
          const baseExecutionTools =
            strategy === "discovery" && !selected.capabilities.tools
              ? []
              : workspaceTools.filter((tool) =>
                  executionPolicy.allowedTools.includes(tool.name),
                );
          const runtime = catalog.runtime.adapters.find(
            (adapter) => adapter.id === selected.providerId,
          );
          const provider =
            runtime?.provider?.() ??
            controlPlane.providers.adapters.find(
              (adapter) => adapter.id === selected.providerId,
            );
          if (!provider) {
            appendError(
              "The selected model has no connected execution adapter.",
              "Refresh Models or connect the runtime.",
            );
            setNotice("Route selected · adapter unavailable");
            return;
          }
          const readOnlyChildTools = workspaceTools.filter(
            (tool) => tool.risk === "read",
          );
          setNotice(
            strategy === "discovery"
              ? "Inspecting repository scope…"
              : `Preparing ${selected.providerId} · ${selected.displayName}…`,
          );
          const activeContextBudget = recommendedAgentContextChars(
            selected,
            executionMode,
            analyzedTask.complexity,
          );
          const agentContext = needsRepositoryContext
            ? await buildRepositoryContext({
                root: taskRoot,
                objective,
                // Leave room for the system prompt, tool schemas, ledger
                // state, and future observations. Raw files remain
                // available through ReadFile on demand.
                maxChars: Math.max(
                  4_000,
                  Math.floor(activeContextBudget * 0.65),
                ),
                signal,
                snapshot: routingContext.snapshot,
                explicitPaths: contextFiles(),
                memoryFacts: semanticMemoryFacts,
                memoryIds: resumeRuntime?.contextAnchor.memoryIds,
                instructionSources:
                  resumeRuntime?.contextAnchor.instructionSources,
                logger: taskLogger,
              })
            : routingContext;
          setNotice(
            strategy === "discovery"
              ? "Waiting for the model to inspect the repository…"
              : "Waiting for the model to choose the next action…",
          );
          const adaptiveProfile = selectExecutionProfile({
            mode: executionMode,
            complexity: analyzedTask.complexity,
            // Inferred preparation targets are not user intent. An empty
            // greenfield request still has unresolved semantic scope until
            // the LLM proposes the plan and its deliverables.
            explicitPathCount: explicitObjectivePaths.length,
            deliverableCount: Math.max(1, boundedScope.length),
            risk: analyzedTask.risk,
            uncertaintyCount:
              executionMode === "coding" &&
              (boundedScope.length === 0 ||
                (repositoryIsEmpty &&
                  greenfieldIntent &&
                  explicitObjectivePaths.length === 0))
                ? 1
                : 0,
            contextPressure:
              activeContextBudget > 0
                ? agentContext.prompt.length / activeContextBudget
                : 0,
          });
          const modelPlanning =
            strategy !== "discovery" &&
            (requiresModelPlan(adaptiveProfile) ||
              // Empty greenfield work has no host-localizable target. The
              // semantic plan must come from the LLM; the controller only
              // validates the proposed scope and executes it.
              (executionMode === "coding" &&
                repositoryIsEmpty &&
                greenfieldIntent &&
                explicitObjectivePaths.length === 0));
          trace.record({
            taskId: turnId,
            type: "context.built",
            phase: "discover",
            data: {
              files: agentContext.files.length,
              instructions: agentContext.instructions?.length ?? 0,
              objectiveMatches: agentContext.relevantMatches?.length ?? 0,
              evidenceState: agentContext.evidenceState,
              searchBackend: agentContext.searchBackend,
              activeContextBudget,
              executionContextChars: agentContext.prompt.length,
            },
          });
          const runtimeTaskId = resumeRuntime?.taskId ?? turnId;
          let runtimeRevision = resumeRuntime?.updatedRevision ?? 0;
          const runtimeRoute = {
            candidateId: selected.id,
            providerId: selected.providerId,
            ...(selected.modelId ? { modelId: selected.modelId } : {}),
            ...(selected.local?.runtime
              ? { runtimeId: selected.local.runtime }
              : {}),
            ...(selected.agentProbe?.agentCapabilityClass
              ? { capability: selected.agentProbe.agentCapabilityClass }
              : {}),
          };
          const runtimeContextAnchor = {
            sourceIds: [
              ...new Set([
                ...(resumeRuntime?.contextAnchor.sourceIds ?? []),
                ...(agentContext.intelligenceSources ?? []),
                ...agentContext.files,
              ]),
            ],
            instructionSources: [
              ...new Set([
                ...(resumeRuntime?.contextAnchor.instructionSources ?? []),
                ...(agentContext.snapshot?.instructionFiles ?? []).map(
                  (file) => file.path,
                ),
                ...(agentContext.instructions ?? []),
                ...(agentContext.instructionSources ?? []),
              ]),
            ],
            memoryIds: [
              ...new Set([
                ...(resumeRuntime?.contextAnchor.memoryIds ?? []),
                ...semanticMemoryFacts.map((fact) => fact.id),
              ]),
            ],
            proofGapIds: [...(resumeRuntime?.contextAnchor.proofGapIds ?? [])],
            ...(agentContext.snapshot?.workingTreeRevision
              ? {
                  repositoryWorkingTreeRevision:
                    agentContext.snapshot.workingTreeRevision,
                }
              : {}),
            ...(resumeRuntime?.contextAnchor.summary
              ? { summary: resumeRuntime.contextAnchor.summary }
              : {}),
          };
          const persistRuntime = (
            ledger: AgentTaskLedger,
            inFlight?: TaskInFlightMarker,
            rehydration?: TaskRuntimeRehydration,
          ): void => {
            runtimeRevision += 1;
            controlPlane.db.saveAgentRuntime(
              createTaskRuntimeSnapshot({
                ledger,
                repositoryRoot: taskRoot,
                sessionId,
                ...(agentContext.snapshot?.revision
                  ? { repositoryRevision: agentContext.snapshot.revision }
                  : {}),
                ...(agentContext.snapshot?.workingTreeRevision
                  ? {
                      repositoryWorkingTreeRevision:
                        agentContext.snapshot.workingTreeRevision,
                    }
                  : {}),
                route: runtimeRoute,
                contextAnchor: {
                  ...runtimeContextAnchor,
                  ...(rehydration?.contextAnchor ?? {}),
                  sourceIds: [
                    ...new Set([
                      ...runtimeContextAnchor.sourceIds,
                      ...(rehydration?.contextAnchor.sourceIds ?? []),
                    ]),
                  ],
                  instructionSources: [
                    ...new Set([
                      ...runtimeContextAnchor.instructionSources,
                      ...(rehydration?.contextAnchor.instructionSources ?? []),
                    ]),
                  ],
                  memoryIds: [
                    ...new Set([
                      ...runtimeContextAnchor.memoryIds,
                      ...(rehydration?.contextAnchor.memoryIds ?? []),
                    ]),
                  ],
                  proofGapIds: [
                    ...new Set([
                      ...runtimeContextAnchor.proofGapIds,
                      ...(rehydration?.contextAnchor.proofGapIds ?? []),
                    ]),
                  ],
                },
                ...(ledger.taskGraph?.currentNodeId
                  ? { activeNodeId: ledger.taskGraph.currentNodeId }
                  : {}),
                ...(inFlight ? { inFlight } : {}),
                updatedRevision: runtimeRevision,
              }),
              sessionId,
            );
          };
          const agentTask: AgentTask = {
            id: runtimeTaskId,
            objective,
            root: taskRoot,
            candidate: selected,
            mode: executionMode,
            executionProfile: adaptiveProfile,
            planningMode: modelPlanning ? "model" : "none",
            enforceTaskContract: executionMode === "coding",
            ...(executionMode === "coding" && boundedScope.length > 0
              ? { stagedPaths: [...boundedScope] }
              : {}),
            ...(greenfieldCreationPaths.length > 0
              ? { greenfieldCreationPaths: [...greenfieldCreationPaths] }
              : {}),
            repositoryPolicy: controlPlane.settings.privacy,
            permissionMode: controlPlane.settings.permissionMode,
            context: agentContext.prompt || undefined,
            instructions: agentContext.trustedInstructions?.map(
              (instruction) => ({
                source: instruction.sourceId,
                text: instruction.text,
                trust: instruction.trust,
                precedence: instruction.precedence,
                scope: instruction.scope,
                relevance: 1,
              }),
            ),
            contextEvidenceState: agentContext.evidenceState,
            repositoryState: repositoryIsEmpty ? "empty" : "non_empty",
            greenfieldIntent,
            containsHighConfidenceSecret:
              agentContext.containsHighConfidenceSecret,
            verificationCommand:
              executionMode === "coding"
                ? verificationPlan[0]?.command
                : undefined,
            verificationCommands:
              executionMode === "coding" ? verificationPlan : [],
            verificationPolicy:
              executionMode === "coding"
                ? verificationPlan.length > 0
                  ? "required"
                  : "not_required"
                : "not_required",
            ...(resumeRuntime ? { runtimeSnapshot: resumeRuntime } : {}),
            maxTurns:
              executionMode === "coding"
                ? Math.max(16, Math.ceil(analyzedTask.complexity * 32))
                : 8,
            contextBudgetChars: activeContextBudget,
            systemPromptProfile: executionPolicy.systemPromptProfile,
          };
          const createExecutionContext = async (
            currentTask: AgentTask,
          ): Promise<import("../tools/types.js").ToolExecutionContext> => ({
            root: currentTask.root,
            permissionMode: currentTask.permissionMode,
            signal,
            network: executionPolicy.network,
            osIsolation:
              controlPlane.settings.permissionMode === "AUTO"
                ? "required"
                : "best_effort",
            allowWeakProcessIsolation:
              controlPlane.settings.permissionMode !== "AUTO",
            checkpoint,
            env: process.env,
            requestApproval: async (request) => {
              const knownRules = [
                ...sessionPermissionGrants(),
                ...permissionRules(),
                ...controlPlane.settings.permissionRules,
              ];
              const matchingRule = knownRules.find((grant) =>
                matchesPermissionGrant(grant, request),
              );
              if (matchingRule) {
                const matchingFamily =
                  matchingRule.family ?? permissionGrantFamily(matchingRule);
                taskLogger.debug("tool.permission.approved", {
                  risk: request.risk,
                  tool: request.tool,
                  ruleId: matchingRule.id,
                  ...(matchingFamily ? { family: matchingFamily } : {}),
                  source: matchingFamily
                    ? `saved-${matchingFamily}-rule`
                    : request.tool === "Shell" || request.tool === "RunTests"
                      ? "saved-exact-command-rule"
                      : "saved-tool-rule",
                });
                return true;
              }
              return new Promise<boolean>((resolve) => {
                if (signal.aborted) {
                  resolve(false);
                  return;
                }
                const denyOnAbort = () => {
                  void resolveApproval("cancel");
                };
                signal.addEventListener("abort", denyOnAbort, {
                  once: true,
                });
                batch(() => {
                  setApprovalBusy(false);
                  setApprovalIndex(0);
                  setActiveApproval({
                    description: request.description,
                    impact:
                      request.risk === "destructive"
                        ? "This action can change or remove workspace state."
                        : "This action requires explicit permission.",
                    scopeDescription: permissionGrantScopeDescription(request),
                    request,
                    resolve: (allowed) => {
                      signal.removeEventListener("abort", denyOnAbort);
                      resolve(allowed);
                    },
                  });
                  setOverlay("approval");
                  setNotice("Approval required · waiting for your decision");
                });
                appEvents.emit({
                  type: "approval.requested",
                  description: request.description,
                  risk: request.risk,
                });
              });
            },
          });
          const subagentCoordinator = new ForegroundSubagentCoordinator({
            provider,
            tools: readOnlyChildTools,
            maxTurns: 4,
            maxContextChars: Math.min(12_000, activeContextBudget),
            logger: taskLogger,
          });
          const delegationTool = createSubagentDelegationTool(
            subagentCoordinator,
            {
              task: agentTask,
              signal,
              createExecutionContext,
            },
          );
          const parallelDelegationTool = createParallelSubagentDelegationTool(
            subagentCoordinator,
            {
              task: agentTask,
              signal,
              createExecutionContext,
            },
          );
          const executionTools =
            baseExecutionTools.length > 0
              ? [...baseExecutionTools, delegationTool, parallelDelegationTool]
              : baseExecutionTools;
          let result: Awaited<ReturnType<typeof runAgent>>;
          try {
            setNotice(
              modelPlanning
                ? "Waiting for the model to build the task plan…"
                : strategy === "discovery"
                  ? "Waiting for the model to inspect the repository…"
                  : "Waiting for the model to choose the next action…",
            );
            result = await runAgent(
              agentTask,
              {
                provider,
                tools: executionTools,
                toolChoice:
                  executionTools.length > 0
                    ? executionPolicy.toolChoice
                    : "none",
                trace,
                logger: taskLogger,
                ...(strategy === "discovery"
                  ? {}
                  : {
                      events: appEvents,
                      persistTask: persistRuntime,
                    }),
                checkUserWorkPreserved: (checkpointId) =>
                  checkpointId ? checkpoint.isPreserved(checkpointId) : true,
                async reviewFinalDiff(currentTask, ledger) {
                  return reviewWorkspaceChange({
                    root: currentTask.root,
                    ledger,
                    signal,
                    logger: taskLogger,
                  });
                },
                async verifySuccessCriteria(currentTask, ledger) {
                  return verifyStructuralCodingCriteria(ledger, {
                    verificationState:
                      executionMode === "coding"
                        ? verificationPlan.length > 0
                          ? "available"
                          : "not_required"
                        : "not_required",
                    reviewObjective: () =>
                      reviewCodingObjective(
                        currentTask,
                        ledger,
                        currentTask.root,
                        signal,
                      ),
                    reviewFinalDiff: async () => {
                      return reviewWorkspaceChange({
                        root: currentTask.root,
                        ledger,
                        signal,
                        logger: taskLogger,
                      });
                    },
                    userWorkPreserved: () =>
                      lastCheckpointId
                        ? checkpoint.isPreserved(lastCheckpointId)
                        : true,
                  });
                },
                ...(executionMode === "coding"
                  ? {
                      independentVerifier: async (currentTask, ledger) => {
                        const report = await runCodeReview({
                          root: currentTask.root,
                          objective: currentTask.objective,
                          mode: currentTask.mode ?? "coding",
                          ledger,
                          verificationRequired: verificationPlan.length > 0,
                          verificationCommands: verificationPlan,
                          verificationState:
                            verificationPlan.length > 0
                              ? "available"
                              : "not_required",
                          finalReviewPerformed: true,
                          userWorkPreserved: lastCheckpointId
                            ? await checkpoint.isPreserved(lastCheckpointId)
                            : true,
                          signal,
                          logger: taskLogger,
                        });
                        return report.verification;
                      },
                    }
                  : {}),
                createExecutionContext,
              },
              signal,
            );
          } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError"))
              routeCircuitBreaker.recordFailure(
                selected.providerId,
                selected.id,
              );
            throw error;
          }
          return {
            result,
            status: result.status,
            ...(result.status === "blocked" &&
            result.ledger.filesChanged.length === 0
              ? {
                  failure: {
                    code: "AGENT_INCOMPLETE" as const,
                    message:
                      "The selected model reached a bounded blocked state without changing the workspace.",
                  },
                }
              : {}),
            ...(result.failure ? { failure: result.failure } : {}),
            mutationOccurred: result.ledger.filesChanged.length > 0,
          };
        };
        const routeExecution = await runWithRouteFallback(
          routeRequest,
          async (selected) => {
            const outcome = await runSelectedAgent(selected);
            if (!outcome)
              throw new Error(
                `No execution result was produced for ${selected.id}.`,
              );
            return outcome;
          },
          {
            logger: taskLogger,
            onOutcome(candidate, outcome) {
              if (
                outcome.status === "failed" ||
                (outcome.status === "blocked" && outcome.failure)
              )
                routeCircuitBreaker.recordFailure(
                  candidate.providerId,
                  candidate.id,
                );
              else if (outcome.status !== "cancelled")
                routeCircuitBreaker.recordSuccess(
                  candidate.providerId,
                  candidate.id,
                );
            },
            onRouteChange(nextDecision, previous, failure) {
              const next = nextDecision.selected?.candidate;
              if (!next) return;
              const reason =
                `Route ${previous.displayName} failed with ${failure.code}; ` +
                `trying ${next.displayName}.`;
              setLastDecision(nextDecision);
              trace.record({
                taskId: turnId,
                type: "route.selected",
                phase: "reflect",
                data: {
                  selected: next.id,
                  provider: next.providerId,
                  reason,
                },
              });
              appEvents.emit({
                type: "route.selected",
                decision: nextDecision,
                reason,
              });
              controlPlane.db.recordRoute(sessionId, next.id, nextDecision);
              setNotice(`Route fallback Â· ${next.displayName}`);
            },
          },
        );
        let finalRouteExecution = routeExecution;
        let preparationHadNoScope = false;
        if (discoveryExecution) {
          const preparationResult = routeExecution.outcome?.result;
          const preparationCandidates = [
            ...(preparationResult?.ledger.filesRead ?? []),
            ...(routingContext.relevantMatches ?? []),
            ...explicitObjectivePaths,
            ...extractObjectivePaths(preparationResult?.text ?? ""),
          ];
          const discoveredTargets = (
            await inspectVerifiedPreparationTargets(
              taskRoot,
              objective,
              preparationCandidates,
            )
          ).map((target) => target.path);
          trace.record({
            taskId: turnId,
            type: "context.built",
            phase: "reflect",
            data: {
              preparation: true,
              discoveredTargetCount: discoveredTargets.length,
              discoveredTargets,
            },
          });
          if (discoveredTargets.length > 0) {
            setNotice(`Scope verified Â· selecting a local coding routeâ€¦`);
            const progressiveRouteRequest = {
              ...routeRequest,
              task: { ...routeRequest.task, toolNeed: true },
              execution: {
                strategy: "progressive" as const,
                boundedScope: discoveredTargets,
              },
            };
            const codingDecision = selectRoute(
              progressiveRouteRequest,
              taskLogger,
            );
            setLastDecision(codingDecision);
            appEvents.emit({
              type: "route.selected",
              decision: codingDecision,
            });
            controlPlane.db.recordRoute(
              sessionId,
              codingDecision.selected?.candidate.id ?? "STOP",
              codingDecision,
            );
            const codingExecution = await runWithRouteFallback(
              progressiveRouteRequest,
              async (selected) => {
                const outcome = await runSelectedAgent(
                  selected,
                  "progressive",
                  discoveredTargets,
                );
                if (!outcome)
                  throw new Error(
                    `No execution result was produced for ${selected.id}.`,
                  );
                return outcome;
              },
              {
                logger: taskLogger,
                onOutcome(candidate, outcome) {
                  if (
                    outcome.status === "failed" ||
                    (outcome.status === "blocked" && outcome.failure)
                  )
                    routeCircuitBreaker.recordFailure(
                      candidate.providerId,
                      candidate.id,
                    );
                  else if (outcome.status !== "cancelled")
                    routeCircuitBreaker.recordSuccess(
                      candidate.providerId,
                      candidate.id,
                    );
                },
                onRouteChange(nextDecision, previous, failure) {
                  const next = nextDecision.selected?.candidate;
                  if (!next) return;
                  const reason =
                    `Route ${previous.displayName} failed with ${failure.code}; ` +
                    `trying ${next.displayName}.`;
                  setLastDecision(nextDecision);
                  trace.record({
                    taskId: turnId,
                    type: "route.selected",
                    phase: "reflect",
                    data: {
                      selected: next.id,
                      provider: next.providerId,
                      reason,
                    },
                  });
                  appEvents.emit({
                    type: "route.selected",
                    decision: nextDecision,
                    reason,
                  });
                  controlPlane.db.recordRoute(sessionId, next.id, nextDecision);
                  setNotice(`Route fallback Â· ${next.displayName}`);
                },
              },
            );
            finalRouteExecution = codingExecution;
          } else {
            preparationHadNoScope = true;
          }
        }
        setLastDecision(finalRouteExecution.decision);
        const result = finalRouteExecution.outcome?.result;
        if (!result) {
          appendError(
            "The selected model did not produce an execution result.",
            "Refresh Models or connect the runtime.",
          );
          setNotice("Task stopped Â· no execution result");
          return;
        }
        controlPlane.db.appendMessage(sessionId, "assistant", result.text);
        const reportedStatus = preparationHadNoScope
          ? ("blocked" as const)
          : result.status;
        controlPlane.db.saveMemoryFact(
          createTaskEpisodeMemoryFact({
            repository: taskRoot,
            taskId: result.ledger.id,
            objective: result.ledger.objective,
            status: reportedStatus,
            phase: result.ledger.phase,
            verified: result.verified,
            filesChanged: result.ledger.filesChanged,
            verification: result.ledger.verificationRuns,
          }),
        );
        taskLogger.info("tui.task.result", {
          status: reportedStatus,
          verified: result.verified,
          textLength: result.text.length,
          filesChanged: result.ledger.filesChanged.length,
          verificationRuns: result.ledger.verificationRuns.length,
        });
        if (preparationHadNoScope)
          setNotice(
            "Local preparation paused Â· no verified mutation scope was found",
          );
        else if (result.status === "cancelled") setNotice("Task cancelled");
        else if (result.status === "completed" && result.verified)
          setNotice("Task completed and verified");
        else if (result.status === "blocked")
          setNotice("Task blocked by completion gates");
        else setNotice("Task failed");
      } catch (error) {
        taskLogger.error("tui.task.failed", {
          error: error instanceof Error ? error.name : "unknown",
          cancelled: signal.aborted,
        });
        throw error;
      } finally {
        taskLogger.info("tui.task.finished", {
          cancelled: signal.aborted,
        });
        presentationEventBuffer?.dispose();
        unsubscribeEvents?.();
        if (activeTaskAbort === taskAbort) activeTaskAbort = undefined;
        setTaskBusy(false);
        endBusyClock();
        controlPlane.close();
      }
    } catch (error) {
      if (activeTaskAbort === taskAbort) activeTaskAbort = undefined;
      setTaskBusy(false);
      endBusyClock();
      throw error;
    }
  };

  const resumeSelectedSession = (): void => {
    if (taskBusy()) {
      setNotice("Task already running · cancel it before resuming");
      return;
    }
    const session = selectedSessionId
      ? sessions().find((candidate) => candidate.id === selectedSessionId)
      : sessions()[sessionIndex()];
    if (!session) {
      setNotice("Select a saved session before resuming");
      return;
    }
    const turnId = crypto.randomUUID();
    setActiveObjective(session.objective);
    show("conversation");
    setPresentation((current) =>
      beginTranscriptTurn(current, {
        turnId,
        text: `Resume: ${session.objective}`,
      }),
    );
    setNotice("Resuming task from the current workspace state…");
    void (async () => {
      const { openControlPlane } = await import("../cli/control-plane.js");
      const controlPlane = await openControlPlane(process.cwd());
      let runtimeResult;
      try {
        runtimeResult = controlPlane.db.getLatestAgentRuntime(session.id);
      } finally {
        controlPlane.close();
      }
      if (!runtimeResult) {
        setNotice("No durable task state is available for this session");
        return;
      }
      if (!runtimeResult.ok) {
        appendError(
          `Task resume refused: ${runtimeResult.error.reason}`,
          "The persisted task state was not replaced with a new task.",
        );
        setNotice("Resume blocked - invalid saved task state");
        return;
      }
      if (runtimeResult.snapshot.ledger.phase === "complete") {
        setNotice("Task already completed; start a new request to continue");
        return;
      }
      await runTask(
        session.objective,
        turnId,
        session.id,
        runtimeResult.snapshot,
        runtimeResult.snapshot.repositoryRoot,
      );
    })().catch((error: unknown) => {
      appendError(error instanceof Error ? error.message : "Task failed");
      setNotice(
        error instanceof Error && error.name === "AbortError"
          ? "Task cancelled"
          : "Task failed",
      );
    });
  };

  const setupPrivacyOptions: RepositoryPrivacy[] = [
    "private",
    "private_zdr_only",
    "local_only",
    "public_free",
  ];
  const setupRoutingOptions = ["strict-zero", "ask-before-paid"] as const;

  const cycleSetupPrivacy = (direction: 1 | -1): void => {
    const current = setupPrivacyOptions.indexOf(privacy());
    const next =
      (current + direction + setupPrivacyOptions.length) %
      setupPrivacyOptions.length;
    setPrivacy(setupPrivacyOptions[next] ?? "private");
  };

  const cycleSetupRouting = (direction: 1 | -1): void => {
    const current = setupRoutingOptions.indexOf(routingMode());
    const next =
      (current + direction + setupRoutingOptions.length) %
      setupRoutingOptions.length;
    setRoutingMode(setupRoutingOptions[next] ?? "strict-zero");
  };

  const persistUiSettings = async (): Promise<void> => {
    const { openControlPlane } = await import("../cli/control-plane.js");
    const controlPlane = await openControlPlane(process.cwd());
    try {
      controlPlane.db.setSetting("privacy.policy", privacy());
      controlPlane.db.setSetting("routing.mode", routingMode());
      controlPlane.db.setSetting("permission.mode", permissionMode());
      await persistRepositorySettings(process.cwd(), {
        privacy: privacy(),
        routingMode: routingMode(),
        permissionMode: permissionMode(),
        permissionRules: permissionRules(),
      });
    } finally {
      controlPlane.close();
    }
  };

  const visiblePermissionGrants = createMemo(() => [
    ...sessionPermissionGrants(),
    ...permissionRules(),
  ]);

  const removePermissionRule = (grant: PermissionGrant): void => {
    if (grant.scope === "session") {
      setSessionPermissionGrants((current) =>
        removePermissionGrant(current, grant.id),
      );
      setPermissionRuleIndex((current) =>
        Math.max(0, Math.min(current, visiblePermissionGrants().length - 1)),
      );
      setNotice("Session permission rule revoked");
      return;
    }
    const nextRules = removePermissionGrant(permissionRules(), grant.id);
    void persistRepositorySettings(process.cwd(), {
      permissionRules: nextRules,
    })
      .then(() => {
        setPermissionRules(nextRules);
        setPermissionRuleIndex((current) =>
          Math.max(0, Math.min(current, visiblePermissionGrants().length - 1)),
        );
        setNotice("Project permission rule revoked");
      })
      .catch((error: unknown) => {
        setNotice(
          error instanceof Error
            ? `Permission rule could not be revoked · ${error.message}`
            : "Permission rule could not be revoked",
        );
      });
  };

  const clearProjectPermissionRules = (): void => {
    if (permissionRules().length === 0) {
      setNotice("No project permission rules to clear");
      return;
    }
    void persistRepositorySettings(process.cwd(), { permissionRules: [] })
      .then(() => {
        setPermissionRules([]);
        setPermissionRuleIndex(0);
        setNotice("Project permission rules cleared");
      })
      .catch((error: unknown) => {
        setNotice(
          error instanceof Error
            ? `Permission rules could not be cleared · ${error.message}`
            : "Permission rules could not be cleared",
        );
      });
  };

  const cycleSettings = async (direction: 1 | -1): Promise<void> => {
    const index = settingsIndex();
    if (index === 2) {
      setDensity((current) =>
        current === "comfortable" ? "compact" : "comfortable",
      );
      setNotice(`Interface density · ${density()} · session only`);
      return;
    }
    if (index === 3) {
      setReducedMotion((current) => !current);
      setNotice(
        `Motion · ${reducedMotion() ? "System" : "Reduced"} · session only`,
      );
      return;
    }
    const previous = {
      privacy: privacy(),
      routingMode: routingMode(),
      permissionMode: permissionMode(),
    };
    if (index === 4) {
      const options: RepositoryPrivacy[] = [
        "private",
        "private_zdr_only",
        "local_only",
        "public_free",
      ];
      const current = options.indexOf(privacy());
      setPrivacy(
        options[(current + direction + options.length) % options.length] ??
          "private",
      );
    } else if (index === 5) {
      const options = ["strict-zero", "ask-before-paid"] as const;
      const current = options.indexOf(routingMode());
      setRoutingMode(
        options[(current + direction + options.length) % options.length] ??
          "strict-zero",
      );
    } else if (index === 6) {
      const options: PermissionMode[] = ["ASK", "PLAN", "EDIT", "AUTO"];
      const current = options.indexOf(permissionMode());
      setPermissionMode(
        options[(current + direction + options.length) % options.length] ??
          "ASK",
      );
    } else {
      setNotice("This setting is fixed by the current product policy");
      return;
    }
    try {
      await persistUiSettings();
      setNotice("Setting saved to this repository");
    } catch (error) {
      setPrivacy(previous.privacy);
      setRoutingMode(previous.routingMode);
      setPermissionMode(previous.permissionMode);
      setNotice(
        error instanceof Error ? error.message : "Setting could not be saved",
      );
    }
  };

  const completeSetup = async (): Promise<void> => {
    setNotice("Saving setup…");
    try {
      const { openControlPlane } = await import("../cli/control-plane.js");
      const controlPlane = await openControlPlane(process.cwd());
      try {
        controlPlane.db.setSetting("privacy.policy", privacy());
        controlPlane.db.setSetting("routing.mode", routingMode());
        await persistRepositorySettings(process.cwd(), {
          privacy: privacy(),
          routingMode: routingMode(),
        });
      } finally {
        controlPlane.close();
      }
      setSetupStage(6);
      show("conversation");
      setNotice("Setup complete · ready to code");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Setup could not be saved",
      );
    }
  };

  const advanceSetup = (): void => {
    if (setupStage() >= 6) {
      void completeSetup();
      return;
    }
    setSetupStage((current) => Math.min(6, current + 1));
    setNotice("Setup · continue");
  };

  const runUiCommand = (id: string): void => {
    if (id === "home-next" || id === "home-previous") {
      const activityGroups = presentation().items.filter(
        (item) => item.kind === "activity-group",
      );
      if (activityGroups.length > 0) {
        const target =
          id === "home-previous" ? activityGroups.at(-1) : activityGroups[0];
        if (target) {
          setFocusedActivityId(target.id);
          composerEditor?.blur();
          transcriptViewport
            ?.findDescendantById(`activity-${target.id}`)
            ?.focus();
        }
        return;
      }
      const current = homeSuggestionIndex();
      setHomeSuggestionIndex(
        moveHomeSuggestionIndex(
          current,
          id === "home-previous" ? -1 : 1,
          homeSuggestions(gitDirty()).length,
        ),
      );
      return;
    }
    if (id !== "palette") {
      setRecentCommandIds((current) =>
        [id, ...current.filter((item) => item !== id)].slice(0, 6),
      );
    }
    setOverlay("none");
    setPaletteQuery("");
    setPaletteDraft(undefined);
    if (id === "cancel-task") {
      if (activeTaskAbort) {
        activeTaskAbort.abort();
        setNotice("Cancelling task…");
      } else {
        setNotice("No active task");
      }
      return;
    }
    if (id === "resume") {
      resumeSelectedSession();
      return;
    }
    if (id === "exit") {
      activeTaskAbort?.abort();
      props.onExit?.();
      return;
    }
    if (id === "palette") {
      openPalette();
      return;
    }
    if (id === "model") {
      openModelPicker();
      return;
    }
    if (id === "context") {
      openContextPicker();
      return;
    }
    if (id === "retry-health") {
      void retryProviderHealth();
      return;
    }
    if (id === "toggle-sidebar") {
      setSidebarHidden((current) => !current);
      setNotice(sidebarHidden() ? "Sidebar visible" : "Sidebar hidden");
      return;
    }
    if (id === "cycle-density") {
      cycleDensity();
      return;
    }
    if (id === "clear" || id === "new") {
      activeTaskAbort?.abort();
      selectedSessionId = undefined;
      setPresentation(createTranscriptPresentation());
      setActiveObjective("");
      show("conversation");
      setComposerValue("");
      setNotice(id === "new" ? "New session" : "Transcript cleared");
      return;
    }
    if (id === "changes") {
      void loadCenter("diff");
      return;
    }
    if (id === "status") {
      void loadCenter("doctor");
      return;
    }
    if (id === "theme" || id === "keybinds" || id === "layout") {
      void loadCenter("settings");
      return;
    }
    if (id === "permissions") {
      void loadCenter("permissions");
      return;
    }
    if (id === "conversation") {
      show("conversation");
      setNotice("Ready · local-first · strict-zero");
      return;
    }
    if (id === "setup") {
      setSetupStage(0);
      show("setup");
      setNotice("Setup · welcome");
      return;
    }
    if (id === "checkpoint" || id === "checkpoint-alias") {
      void loadCenter("checkpoint");
      return;
    }
    if (id === "explain-route") {
      void loadCenter("explain-route");
      return;
    }
    void loadCenter(id as CenterScreen);
  };

  uiCommands = createUICommands(runUiCommand);
  props.onActionReady?.(runUiCommand);

  const openPalette = (query = ""): void => {
    setPaletteDraft(composerValue());
    setOverlay("palette");
    setPaletteQuery(query);
    setPaletteIndex(0);
    setNotice("Command palette");
  };

  const selectPaletteCommand = (index = paletteIndex()): void => {
    const command = paletteItems()[index];
    if (command?.enabled?.() === false) return;
    command?.run?.();
  };

  const handlePaletteKey = (event: KeyEvent): void => {
    if (event.name === "escape" || event.name === "esc") {
      event.preventDefault();
      setOverlay("none");
      setPaletteQuery("");
      setComposerValue(paletteDraft() ?? "");
      setPaletteDraft(undefined);
      focusComposer();
      return;
    }
    if (event.name === "up" || event.name === "down") {
      event.preventDefault();
      const count = paletteItems().length;
      if (count === 0) return;
      setPaletteIndex((current) =>
        event.name === "up"
          ? (current - 1 + count) % count
          : (current + 1) % count,
      );
    }
  };

  const handleModelPickerKey = (event: KeyEvent): void => {
    if (event.name === "escape" || event.name === "esc") {
      event.preventDefault();
      setOverlay("none");
      setModelQuery("");
      setModelIndex(0);
      setComposerValue(modelPickerDraft() ?? "");
      setModelPickerDraft(undefined);
      setNotice("Model selection cancelled");
      focusComposer();
      return;
    }
    if (event.name === "up" || event.name === "down") {
      event.preventDefault();
      const count = modelPickerItems().length;
      if (count === 0) return;
      setModelIndex((current) =>
        event.name === "up"
          ? (current - 1 + count) % count
          : (current + 1) % count,
      );
    }
  };

  const handleKeyDown = (event: KeyEvent): void => {
    if (
      focusedActivityId() &&
      (event.name === "escape" || event.name === "esc")
    ) {
      event.preventDefault();
      setFocusedActivityId(undefined);
      focusComposer();
      return;
    }
    // Inline "/" suggestions (SlashCommandMenu) never take their own focus
    // — the composer's real textarea stays focused throughout, so its own
    // onKeyDown (here) is the only place that ever sees these keys. Two
    // ways to close it, both direct: Esc, or (handled in
    // handleComposerInput) erasing the "/" itself.
    if (overlay() === "slash") {
      if (event.name === "escape" || event.name === "esc") {
        event.preventDefault();
        batch(() => {
          setOverlay("none");
          setPaletteQuery("");
        });
        return;
      }
      if (event.name === "up" || event.name === "down") {
        event.preventDefault();
        const count = isSlashModelMode()
          ? slashModelCandidates().length
          : paletteItems().length;
        if (count === 0) return;
        setPaletteIndex((current) =>
          event.name === "up"
            ? (current - 1 + count) % count
            : (current + 1) % count,
        );
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        event.preventDefault();
        if (isSlashModelMode()) {
          const choice = slashModelCandidates()[paletteIndex()];
          batch(() => {
            setComposerValue("");
            setPaletteQuery("");
          });
          chooseModel(choice);
          return;
        }
        const command = paletteItems()[paletteIndex()];
        batch(() => {
          setOverlay("none");
          setPaletteQuery("");
          setComposerValue("");
        });
        if (command?.enabled?.() !== false) command?.run?.();
        return;
      }
    }
    const homeIdle =
      overlay() === "none" &&
      screen() === "conversation" &&
      !activeObjective() &&
      presentation().items.length === 0 &&
      !composerValue().trim();
    if (
      homeIdle &&
      (event.name === "tab" ||
        event.name === "up" ||
        event.name === "down" ||
        event.name === "linefeed" ||
        (event.ctrl &&
          (event.name.toLowerCase() === "j" ||
            event.name.toLowerCase() === "k")))
    ) {
      event.preventDefault();
      const direction =
        event.name === "up" || event.name.toLowerCase() === "k" ? -1 : 1;
      setHomeSuggestionIndex((current) =>
        moveHomeSuggestionIndex(
          current,
          direction,
          homeSuggestions(gitDirty()).length,
        ),
      );
      return;
    }
    if (
      homeIdle &&
      homeSuggestionIndex() >= 0 &&
      (event.name === "return" || event.name === "enter")
    ) {
      event.preventDefault();
      const suggestion = homeSuggestions(gitDirty())[homeSuggestionIndex()];
      if (suggestion) submit(suggestion);
      return;
    }
    if (
      homeIdle &&
      homeSuggestionIndex() >= 0 &&
      (event.name === "escape" || event.name === "esc")
    ) {
      event.preventDefault();
      setHomeSuggestionIndex(-1);
      focusComposer();
      return;
    }
    if (
      screen() === "conversation" &&
      overlay() === "none" &&
      presentation().items.length > 0 &&
      !event.ctrl &&
      !event.option &&
      !event.meta &&
      !event.shift &&
      (event.name === "up" || event.name === "down") &&
      (composerValue().length === 0 || promptHistoryIndex >= 0)
    ) {
      event.preventDefault();
      if (event.name === "up" && promptHistoryIndex < 0) {
        promptHistoryDraft = composerValue();
      }
      const result = navigatePromptHistory(
        promptHistory(),
        promptHistoryIndex,
        event.name === "up" ? -1 : 1,
        promptHistoryDraft,
      );
      promptHistoryIndex = result.index;
      setComposerValue(result.value);
      return;
    }
    if (event.ctrl && event.name.toLowerCase() === "c") {
      event.preventDefault();
      if (activeTaskAbort) activeTaskAbort.abort();
      else props.onExit?.();
      return;
    }
    if (
      (event.ctrl && event.name.toLowerCase() === "k") ||
      (event.ctrl && event.name.toLowerCase() === "p")
    ) {
      event.preventDefault();
      openPalette();
      return;
    }
    // Scroll the transcript regardless of what currently holds focus (the
    // composer normally does, so PageUp/PageDown would otherwise never
    // reach the scrollbox's own keyboard handling). PageUp/PageDown aren't
    // claimed by the textarea's own key bindings, so this can't conflict
    // with typing. Scrolling exactly to the bottom via PageDown also
    // re-engages the scrollbox's native `stickyScroll` (it only pauses
    // until you scroll back to the sticky edge), so no separate "resume
    // auto-scroll" affordance is needed beyond reaching the bottom.
    if (
      screen() === "conversation" &&
      overlay() === "none" &&
      (event.name === "pageup" || event.name === "pagedown")
    ) {
      event.preventDefault();
      transcriptViewport?.scrollBy(
        { x: 0, y: event.name === "pageup" ? -1 : 1 },
        "viewport",
      );
      return;
    }
    if (screen() === "setup") {
      const key = event.name.toLowerCase();
      if (
        key === "return" ||
        key === "enter" ||
        key === "linefeed" ||
        event.sequence === "\r" ||
        event.sequence === "\n"
      ) {
        event.preventDefault();
        advanceSetup();
        return;
      }
      if (key === "p" && !event.ctrl && !event.option && !event.meta) {
        event.preventDefault();
        cycleSetupPrivacy(1);
        return;
      }
      if (key === "r" && !event.ctrl && !event.option && !event.meta) {
        event.preventDefault();
        cycleSetupRouting(1);
        return;
      }
      if (event.name === "escape" || event.name === "esc") {
        event.preventDefault();
        props.onExit?.();
        return;
      }
    }
    if (overlay() === "palette") {
      handlePaletteKey(event);
      return;
    }
    if (overlay() === "model-picker") {
      handleModelPickerKey(event);
      return;
    }
    if (overlay() === "context-picker") {
      if (event.name === "escape" || event.name === "esc") {
        event.preventDefault();
        closeContextPicker();
      } else if (event.name === "up" || event.name === "down") {
        event.preventDefault();
        const count = contextPickerItems().length;
        if (count > 0) {
          setContextIndex((current) =>
            event.name === "up"
              ? (current - 1 + count) % count
              : (current + 1) % count,
          );
        }
      }
      return;
    }
    if (overlay() === "approval") {
      if (event.name === "escape" || event.name === "esc") {
        event.preventDefault();
        event.stopPropagation();
        void resolveApproval("deny");
      } else if (event.name === "return" || event.name === "enter") {
        event.preventDefault();
        event.stopPropagation();
        const option = APPROVAL_OPTIONS[approvalIndex()];
        if (option) void resolveApproval(option.decision);
      } else if (event.name === "up" || event.name === "down") {
        event.preventDefault();
        event.stopPropagation();
        setApprovalIndex((current) =>
          event.name === "up"
            ? (current - 1 + APPROVAL_OPTIONS.length) % APPROVAL_OPTIONS.length
            : (current + 1) % APPROVAL_OPTIONS.length,
        );
      } else {
        const decision = approvalDecisionForKey(event.name);
        if (decision) {
          event.preventDefault();
          event.stopPropagation();
          void resolveApproval(decision);
        }
      }
      return;
    }
    if (screen() === "settings") {
      if (event.name === "up" || event.name === "down") {
        event.preventDefault();
        setSettingsIndex((current) =>
          moveSettingIndex(
            current,
            event.name === "up" ? -1 : 1,
            settingsQuery(),
          ),
        );
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        event.preventDefault();
        void cycleSettings(1);
        return;
      }
    }
    if (screen() === "permissions") {
      if (event.name === "up" || event.name === "down") {
        event.preventDefault();
        const count = visiblePermissionGrants().length;
        if (count > 0) {
          setPermissionRuleIndex((current) =>
            event.name === "up"
              ? (current - 1 + count) % count
              : (current + 1) % count,
          );
        }
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        event.preventDefault();
        const grant = visiblePermissionGrants()[permissionRuleIndex()];
        if (grant) removePermissionRule(grant);
        return;
      }
      if (event.name.toLowerCase() === "x") {
        event.preventDefault();
        clearProjectPermissionRules();
        return;
      }
    }
    const providerActionsAvailable = providers().some(
      (provider) =>
        provider.freeStatus === "stale" ||
        provider.freeStatus === "unknown" ||
        provider.privacy === "unknown",
    );
    if (screen() === "providers" && providerActionsAvailable) {
      if (event.name === "up" || event.name === "down") {
        event.preventDefault();
        setProviderActionIndex((current) =>
          event.name === "up" ? (current - 1 + 2) % 2 : (current + 1) % 2,
        );
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        event.preventDefault();
        if (providerActionIndex() === 0) {
          void retryProviderHealth();
        } else {
          const local = modelData()?.models.find(
            (model) => model.source === "local",
          );
          if (local) {
            setActiveModelId(local.id);
            show("conversation");
            setNotice(`Local route selected · ${local.displayName}`);
            focusComposer();
          } else {
            setNotice("No local model is ready");
          }
        }
        return;
      }
    }
    if (screen() === "diff") {
      const key = event.name.toLowerCase();
      if (key === "j" || key === "k" || key === "up" || key === "down") {
        event.preventDefault();
        const delta = key === "j" || key === "down" ? 1 : -1;
        const count = Math.max(
          1,
          diffText()
            .split(/\r?\n/)
            .filter((line) => line.startsWith("@@ ")).length,
        );
        const next = Math.min(count - 1, Math.max(0, diffHunkIndex() + delta));
        setDiffHunkIndex(next);
        setNotice(`Diff hunk ${next + 1}`);
        return;
      }
      if (key === "v") {
        event.preventDefault();
        if (width() < 120) {
          setNotice("Split diff needs 120 columns");
        } else {
          const nextView = diffView() === "unified" ? "split" : "unified";
          setDiffView(nextView);
          setNotice(`Diff view · ${nextView}`);
        }
        return;
      }
    }
    if (screen() === "sessions") {
      if (event.name === "up" || event.name === "down") {
        event.preventDefault();
        const count = sessions().length;
        if (count > 0) {
          setSessionIndex((current) =>
            event.name === "up"
              ? (current - 1 + count) % count
              : (current + 1) % count,
          );
        }
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        event.preventDefault();
        void openSelectedSession();
        return;
      }
    }
    if (event.name === "escape" || event.name === "esc") {
      event.preventDefault();
      const action = resolveEscapeAction({
        overlayOpen: overlay() !== "none",
        screen: screen(),
        activeTask: Boolean(activeTaskAbort),
        draft: composerValue(),
      });
      if (action === "close-overlay") {
        setOverlay("none");
        setPaletteQuery("");
        setComposerValue(paletteDraft() ?? "");
        setPaletteDraft(undefined);
        focusComposer();
      } else if (action === "return-conversation") {
        show("conversation");
        setNotice("Ready · local-first · strict-zero");
      } else if (action === "cancel-task") {
        activeTaskAbort?.abort();
        setComposerValue("");
      } else if (action === "clear-draft") {
        setComposerValue("");
      }
      return;
    }
  };

  const submit = (value: unknown): void => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return;
    if (taskBusy()) {
      setNotice("Task already running Â· Ctrl+C or Esc to cancel");
      return;
    }
    if (text.startsWith("/")) {
      const command = uiCommands.find((item) => item.slash === text);
      if (command) {
        command.run?.();
        return;
      }
      appendError(
        `Unknown command ${text}`,
        "Press Ctrl+P to search available commands.",
      );
      setNotice("Unknown command");
      setComposerValue("");
      return;
    }
    setPromptHistory((current) => addPromptToHistory(current, text));
    promptHistoryIndex = -1;
    promptHistoryDraft = "";
    setComposerValue("");
    selectedSessionId = undefined;
    setActiveObjective(text);
    setScreen("conversation");
    // A prior version animated this transition (imperatively flipping the
    // composer to `position: absolute`, animating top/left/width via
    // createTimeline, then handing back to `position: relative`). It broke
    // in real interactive use twice — the composer becoming invisible
    // after the transition — and the exact Yoga-level cause wasn't
    // reliably reproducible under the headless test renderer used in this
    // repo (`testRender`'s timeline/frame timing doesn't visibly match a
    // real terminal's), so it couldn't be verified fixed with real
    // confidence. Reactive flex layout alone (isEmptyConversation() flipping
    // false above) already snaps the composer to its correct bottom-anchored
    // position correctly and immediately — no animation, but never wrong or
    // invisible. Correctness over polish until this can be redone with a
    // reliable way to verify it in a real terminal, not just this harness.
    const turnId = crypto.randomUUID();
    // Do not narrate an assumed action here: what happens next (nothing, a
    // read-only lookup, or a coding turn) depends on turn-policy
    // classification inside runTask, not on a canned assistant line.
    setPresentation((current) =>
      beginTranscriptTurn(current, { turnId, text }),
    );
    // Always land on your own new message, even if you'd scrolled up to
    // read earlier history (which pauses the scrollbox's stickyScroll).
    // Deferred one tick so the new turn's content has actually been added
    // to the transcript before we measure scrollHeight against it.
    setTimeout(() => {
      if (transcriptViewport)
        transcriptViewport.scrollTo({
          x: 0,
          y: transcriptViewport.scrollHeight,
        });
    }, 0);
    void runTask(text, turnId).catch((error: unknown) => {
      appendError(error instanceof Error ? error.message : "Task failed");
      setNotice(
        error instanceof Error && error.name === "AbortError"
          ? "Task cancelled"
          : "Task failed",
      );
    });
  };

  const handleComposerInput = (value: string): void => {
    // solid-js has no automatic batching outside solid-js/web's DOM event
    // delegation — this custom (opentui) renderer doesn't provide it
    // either, so the signal writes below would otherwise each flush
    // *separately*, synchronously, mid-function. Confirmed by direct
    // instrumentation: typing "/" fired the root layout gate (app.tsx's
    // `{() => showMainContent() ? ... : null}` block) with composerValue
    // already "/" but overlay still "none" — a torn intermediate state
    // that doesn't correspond to any value this function ever actually
    // settles on. Every one of those spurious in-between flushes is one
    // more chance for something downstream (in this case, a fresh
    // TextareaRenderable mounting mid-keystroke with its cursor reset to
    // the start — see showMainContent's own comment) to observe state
    // that was never meant to be visible. batch() coalesces all of this
    // function's writes into the single, atomic, fully-settled update a
    // single keystroke actually represents.
    batch(() => {
      setComposerValue(value);
      if (value.startsWith("/")) {
        // Inline suggestions (SlashCommandMenu) — distinct from "palette",
        // which is the separate Ctrl+P "search everything" modal with its
        // own input field. This one has none: the composer keeps focus and
        // is the only source of truth for what's typed, so there's nothing
        // to keep in sync and nothing to restore on close.
        setOverlay("slash");
        setPaletteQuery(value);
        setPaletteIndex(0);
      } else {
        const atIndex = value.lastIndexOf("@");
        if (isActiveFileReference(value)) {
          openContextPicker(value.slice(atIndex + 1));
        } else if (overlay() === "context-picker") {
          setOverlay("none");
          setContextQuery("");
        } else if (overlay() === "palette" || overlay() === "slash") {
          // Backspacing the "/" away is the second way to close this — Esc
          // (handleKeyDown) is the first.
          setOverlay("none");
          setPaletteQuery("");
        }
      }
    });
  };

  const renderCenter = () => {
    const target = screen();
    switch (target) {
      case "setup":
        return (
          <SetupView
            theme={theme}
            stage={setupStage()}
            hardware={hardware()}
            modelData={modelData()}
            providers={providers()}
            privacy={privacy()}
            routingMode={routingMode()}
          />
        );
      case "models":
        return (
          <ModelsView theme={theme} width={contentWidth()} data={modelData()} />
        );
      case "providers":
        return (
          <ProvidersView
            theme={theme}
            providers={providers()}
            actionIndex={providerActionIndex()}
            onActionFocus={setProviderActionIndex}
            onRetry={retryProviderHealth}
            onUseLocal={() => {
              const local = modelData()?.models.find(
                (model) => model.source === "local",
              );
              if (!local) {
                setNotice("No local model is ready");
                return;
              }
              setActiveModelId(local.id);
              show("conversation");
              setNotice(`Local route selected · ${local.displayName}`);
              focusComposer();
            }}
          />
        );
      case "quota":
        return (
          <QuotaView theme={theme} quotas={quotas()} width={contentWidth()} />
        );
      case "routing":
      case "explain-route":
        return (
          <RoutingView
            theme={theme}
            decision={lastDecision()}
            lines={lines()}
            width={contentWidth()}
          />
        );
      case "privacy":
        return (
          <PrivacyView
            theme={theme}
            privacy={privacy()}
            routingMode={routingMode()}
            lines={lines()}
          />
        );
      case "settings":
        return (
          <SettingsView
            theme={theme}
            density={density()}
            reducedMotion={reducedMotion()}
            width={contentWidth()}
            privacy={privacy()}
            routingMode={routingMode()}
            permissionMode={permissionMode()}
            selectedIndex={settingsIndex()}
            query={settingsQuery()}
            onQuery={(value) => {
              setSettingsQuery(value);
              setSettingsIndex(moveSettingIndex(0, 1, value));
            }}
            onKeyDown={handleKeyDown}
            onActivate={(index) => {
              setSettingsIndex(index);
              void cycleSettings(1);
            }}
          />
        );
      case "permissions":
        return (
          <PermissionsView
            theme={theme}
            permissionMode={permissionMode()}
            grants={visiblePermissionGrants()}
            selectedIndex={permissionRuleIndex()}
            onRemove={removePermissionRule}
          />
        );
      case "diff":
        return (
          <ChangesView
            theme={theme}
            diff={diffText()}
            lines={lines()}
            view={width() >= 120 ? diffView() : "unified"}
            hunkIndex={diffHunkIndex()}
          />
        );
      case "context":
        return (
          <GenericCenterView
            theme={theme}
            eyebrow="Context inspector"
            title="Context"
            lines={lines()}
          />
        );
      case "plan":
        return (
          <GenericCenterView
            theme={theme}
            eyebrow="Task progress"
            title="Plan"
            lines={lines()}
          />
        );
      case "doctor":
        return (
          <GenericCenterView
            theme={theme}
            eyebrow="Readiness"
            title="Doctor"
            lines={lines()}
          />
        );
      case "help":
        return (
          <GenericCenterView
            theme={theme}
            eyebrow="Keyboard first"
            title="Help"
            lines={lines()}
          />
        );
      case "sessions":
        return (
          <SessionsView
            theme={theme}
            sessions={sessions()}
            selectedIndex={sessionIndex()}
            onSelect={(index) => {
              setSessionIndex(index);
              void openSelectedSession(index);
            }}
          />
        );
      case "checkpoint":
        return (
          <GenericCenterView
            theme={theme}
            eyebrow="Safe restore"
            title="Checkpoints"
            lines={lines()}
          />
        );
      case "rollback":
        return (
          <GenericCenterView
            theme={theme}
            eyebrow="Safe restore"
            title="Rollback"
            lines={lines()}
          />
        );
      default:
        return (
          <GenericCenterView
            theme={theme}
            title="LocalCode center"
            lines={lines()}
          />
        );
    }
  };

  onMount(() => {
    const activeFixture = initialFixture;
    if (activeFixture) {
      const fixture = createUIFixture(activeFixture);
      if (fixture.objective) setActiveObjective(fixture.objective);
      if (fixture.presentation) {
        setPresentation(fixture.presentation);
      } else if (fixture.messages || fixture.streamingText) {
        setPresentation(
          presentationFromLegacy(fixture.messages ?? [], fixture.streamingText),
        );
      }
      if (fixture.modelData) setModelData(fixture.modelData);
      if (fixture.providers) setProviders(fixture.providers);
      if (fixture.quotas) setQuotas(fixture.quotas);
      if (fixture.sessions) setSessions(fixture.sessions);
      if (fixture.expandTools) setExpandedTools(true);
      if (fixture.lines) setLines(fixture.lines);
      if (fixture.diffText) setDiffText(fixture.diffText);
      if (activeFixture === "models") show("models");
      if (activeFixture === "model-picker") {
        setTimeout(() => openModelPicker(), 0);
      }
      if (activeFixture === "palette") {
        setTimeout(
          () => openPalette(process.env.LOCALCODE_UI_FIXTURE_QUERY ?? ""),
          0,
        );
      }
      if (activeFixture === "settings") show("settings");
      if (activeFixture === "diff") show("diff");
      if (activeFixture === "provider-error") show("providers");
      if (activeFixture === "approval") {
        setNotice("Approval requested");
      }
      if (fixture.fixtureScreen)
        show(fixture.fixtureScreen, fixture.lines ?? []);
      setNotice(
        activeFixture === "provider-error"
          ? "Provider health needs attention"
          : activeFixture === "models"
            ? "Models ready"
            : activeFixture === "model-picker"
              ? "Model picker"
              : activeFixture === "settings"
                ? "Settings ready"
                : activeFixture === "palette"
                  ? "Command palette"
                  : activeFixture === "diff"
                    ? "Changes · working tree"
                    : "Ready · local-first · strict-zero",
      );
      if (initialFixtureState.busy) setNotice("Working");
    } else {
      void refreshModelData().catch(() => undefined);
    }
    void import("../shared/process.js")
      .then(async ({ runCommand }) => {
        const [branchResult, statusResult] = await Promise.all([
          runCommand("git", ["branch", "--show-current"], {
            intent: "read",
            cwd: process.cwd(),
            timeoutMs: 1_000,
          }),
          runCommand("git", ["status", "--porcelain"], {
            intent: "read",
            cwd: process.cwd(),
            timeoutMs: 1_000,
          }),
        ]);
        const current = branchResult.stdout.trim();
        if (current) setBranch(current);
        setGitDirty(Boolean(statusResult.stdout.trim()));
      })
      .catch(() => undefined);
  });

  onCleanup(() => {
    activeApproval()?.resolve?.(false);
    activeTaskAbort?.abort();
    endBusyClock();
  });

  useKeyboard(handleKeyDown);

  createEffect(() => {
    if (paletteIndex() >= paletteItems().length && paletteItems().length > 0)
      setPaletteIndex(0);
  });

  const isConversation = () => screen() === "conversation";
  // The "hero" landing state — 0 messages, nothing running yet. Home and the
  // composer are grouped and centered together as one block here, matching
  // the empty-state pattern from ChatGPT/Claude.ai and OpenCode's TUI,
  // rather than Home anchored top with the composer separately pinned to
  // the bottom. The moment this flips false (first message sent), the
  // submit() handler above animates the composer from its centered spot
  // down to its normal bottom-anchored one instead of letting it jump.
  //
  // createMemo, not a plain function: this is read directly (not behind an
  // accessor-prop closure) inside the giant `{() => ...}` root layout block
  // below, which — per this session's established, proven finding for
  // MarkdownBlock's `plain`/`segments`/`hasCodeBlock` — recreates its
  // *entire* returned subtree (every component from TopBar down to the
  // composer) on every re-invocation, not just patches what changed. A
  // plain function here would make that recomputation fire on every
  // streamed token (it reads presentation() transitively), tearing down and
  // remounting the whole app tree — including the composer's own
  // TextareaRenderable — dozens of times a second while an answer streams.
  // createMemo only notifies dependents when this *boolean* actually flips,
  // so a token landing while already mid-conversation is a no-op here.
  const isEmptyConversation = createMemo(
    () =>
      isConversation() &&
      !activeObjective() &&
      presentation().items.length === 0,
  );
  // Same reasoning as isEmptyConversation above: read directly inside the
  // root layout block to decide Transcript vs. HomeView, so it must be a
  // memo — presentation() changes every streamed token, but "is there at
  // least one item" flips at most once per conversation.
  const hasTranscriptItems = createMemo(() => presentation().items.length > 0);
  // The transcript and composer are one reading column in every conversation
  // state, including the empty home state. Keeping this as a single geometry
  // source prevents the input from shifting horizontally when the first turn
  // replaces the home content.
  const composerColumnWidth = () => coreGeometry().width;
  const wideWorkspace = () => width() >= 150 && screen() !== "setup";
  const contentWidth = () =>
    wideWorkspace()
      ? Math.min(width() - 6, Math.max(120, Math.floor(width() * 0.86)))
      : width();
  const coreGeometry = createMemo(() => getCoreContentGeometry(width()));
  const composerLineCount = createMemo(() => {
    const value = composerValue();
    if (!value) return 0;
    return value.split("\n").length;
  });
  const coreVerticalLayout = createMemo(() =>
    getCoreVerticalLayout(width(), height(), composerLineCount()),
  );
  const composerRows = () => coreVerticalLayout().composer.inputRows;
  const showInspector = () =>
    screen() !== "setup" &&
    (layout().inspector === "panel" ||
      (layout().inspector === "drawer" && Boolean(activeObjective())));
  // The root layout gate below (`{() => showMainContent() ? ... : null}`)
  // recreates its whole returned subtree on every re-invocation — same
  // finding as isEmptyConversation/hasTranscriptItems above. "slash" (the
  // inline "/" suggestions sheet) is deliberately grouped into that same
  // true-branch so the conversation and composer stay mounted underneath
  // it, but handleComposerInput calls setOverlay("slash") on *every*
  // keystroke while the draft starts with "/", not just the first one.
  // Direct user feedback traced this exact bug: "escribo el / y despues
  // las letras se ponen delante ejemplo letras/" plus "cuando selecciono
  // modelo me lleva a otro lugar" — both came from the *first* "/"
  // keystroke flipping overlay() from "none" to "slash": read as a plain
  // `overlay() === "none" || overlay() === "slash"` (no memo), that literal
  // signal write — even though the boolean result stays true — was still
  // enough to re-run the outer function and remount the entire tree,
  // including a brand new Composer with a brand new TextareaRenderable.
  // That renderable's constructor calls `setText(initialValue)` with no
  // matching `gotoBufferEnd()` (unlike InputRenderable, which explicitly
  // sets `cursorOffset = initialValue.length` — see Textarea vs Input in
  // @opentui/core), so the fresh editor's cursor started at position 0
  // instead of after the "/" — every following keystroke then inserted
  // *before* it: "/" + "m" at cursor 0 → "m/", + "o" → "mo/", ... "model/".
  // Wrapping the gate in createMemo means the "none"→"slash" transition no
  // longer changes its *output*, so the outer function — and the composer
  // inside it — never remounts, and the same live editor instance (with
  // its own correct cursor) keeps receiving every keystroke.
  const showMainContent = createMemo(
    () => overlay() === "none" || overlay() === "slash",
  );

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={themeColor(theme, colors.background.canvas)}
    >
      {() =>
        // "slash" (inline "/" suggestions) is a small floating menu, not a
        // full-screen takeover like every other overlay here — the whole
        // point is that the conversation and the composer it's anchored to
        // stay mounted, visible, and focused underneath it. Every other
        // overlay value still replaces this with its own full-screen view.
        // showMainContent (memoized above) is load-bearing, not a style
        // choice — see its own comment for why a plain boolean here
        // remounted the whole tree on the first "/" keystroke.
        showMainContent() ? (
          <>
            <box height={1} minHeight={1} flexShrink={0}>
              <TopBar
                theme={theme}
                width={width()}
                route={routeLabel()}
                model={modelLabel()}
                workspace={workspace}
                privacy={privacyText()}
                mode="AUTO"
                branch={branch()}
              />
            </box>
            <box flexGrow={1} flexDirection="row" gap={0} minHeight={0}>
              {screen() !== "setup" &&
              layout().navigation !== "hidden" &&
              !sidebarHidden() ? (
                <Sidebar
                  theme={theme}
                  active={screen()}
                  collapsed={layout().navigation === "collapsed"}
                  onNavigate={(id) => runUiCommand(id)}
                />
              ) : null}
              <box
                flexGrow={1}
                flexDirection="column"
                paddingX={0}
                gap={0}
                minHeight={0}
                width="100%"
                alignItems={isConversation() ? "center" : undefined}
                justifyContent={isEmptyConversation() ? "center" : "flex-start"}
              >
                <box
                  flexGrow={isEmptyConversation() ? 0 : 1}
                  flexDirection="column"
                  paddingTop={isConversation() ? 0 : 1}
                  paddingBottom={0}
                  minHeight={0}
                  alignItems={
                    isConversation()
                      ? "center"
                      : width() >= 150 && screen() !== "setup"
                        ? "center"
                        : undefined
                  }
                >
                  <box
                    id={
                      isConversation()
                        ? "core-content-column"
                        : "center-content"
                    }
                    width={
                      isConversation()
                        ? coreGeometry().width
                        : wideWorkspace()
                          ? contentWidth()
                          : "100%"
                    }
                    flexGrow={1}
                    minHeight={0}
                    overflow="hidden"
                  >
                    {isConversation() ? (
                      activeObjective() || hasTranscriptItems() ? (
                        <box flexDirection="column" flexGrow={1} minHeight={0}>
                          <Transcript
                            theme={theme}
                            items={() =>
                              presentationDensity() === "focus"
                                ? presentation().items.filter(
                                    (item) => item.kind !== "route-event",
                                  )
                                : presentation().items
                            }
                            width={coreGeometry().width}
                            expandActivities={
                              presentationDensity() === "verbose" ||
                              (presentationDensity() !== "focus" &&
                                expandedTools())
                            }
                            expandedActivityIds={
                              presentationDensity() === "focus"
                                ? undefined
                                : expandedActivityIds
                            }
                            density={height() <= 24 ? "compact" : density()}
                            onReady={(viewport) => {
                              transcriptViewport = viewport;
                            }}
                            agentPhase={agentMatrixPhase}
                            agentTick={spinnerTick}
                            agentElapsedSeconds={elapsedSeconds}
                            agentReducedMotion={reducedMotion}
                            runningVerification={() =>
                              presentation().runningVerification
                            }
                            onActivityToggle={(id) => {
                              props.onActivityToggle?.(id);
                              setExpandedActivityIds((current) => {
                                const next = new Set(current);
                                if (next.has(id)) next.delete(id);
                                else next.add(id);
                                return next;
                              });
                            }}
                          />
                        </box>
                      ) : (
                        <HomeView
                          theme={theme}
                          width={coreGeometry().width}
                          height={height()}
                          model={modelLabel()}
                          workspace={workspace}
                          branch={branch()}
                          dirty={gitDirty()}
                          selectedIndex={homeSuggestionIndex}
                          onSelect={setHomeSuggestionIndex}
                          onSuggestion={submit}
                        />
                      )
                    ) : (
                      renderCenter()
                    )}
                  </box>
                </box>
                {screen() === "conversation" ? (
                  <box
                    id="core-composer-column"
                    width={composerColumnWidth()}
                    height={coreVerticalLayout().composer.height}
                    minHeight={coreVerticalLayout().composer.height}
                    flexShrink={0}
                  >
                    <Composer
                      theme={theme}
                      value={composerValue}
                      rows={composerRows()}
                      mode="Auto"
                      route={
                        routeLabel() === "FREE" ? "Free cloud" : "Local first"
                      }
                      focused={
                        // "slash" (inline "/" suggestions) deliberately
                        // keeps the composer itself focused — unlike every
                        // other overlay here, it has no input field of its
                        // own to hand focus to.
                        showMainContent() &&
                        !(
                          screen() === "conversation" &&
                          homeSuggestionIndex() >= 0
                        ) &&
                        !focusedActivityId()
                      }
                      width={composerColumnWidth()}
                      busy={taskBusy()}
                      contextCount={() => contextFiles().length}
                      onContext={openContextPicker}
                      onInput={handleComposerInput}
                      onReady={(editor) => {
                        composerEditor = editor;
                      }}
                      onSubmit={submit}
                      onKeyDown={handleKeyDown}
                    />
                  </box>
                ) : null}
              </box>
              {showInspector() && layout().inspector === "panel" ? (
                <Inspector
                  theme={theme}
                  objective={activeObjective()}
                  route={routeLabel()}
                  model={modelLabel()}
                  contextFiles={contextFiles()}
                  lines={lines()}
                />
              ) : null}
            </box>
            <box height={1} minHeight={1} flexShrink={0}>
              <StatusBar
                theme={theme}
                notice={notice}
                width={width}
                route={routeLabel}
                model={modelLabel}
                context={() => "ctx 0/32k"}
                busy={taskBusy}
                showSpinner={() =>
                  taskBusy() &&
                  agentMatrixPhase() === undefined &&
                  !hasConcreteActiveWork()
                }
                spinnerFrame={spinnerFrame}
                elapsedSeconds={elapsedSeconds}
              />
            </box>
          </>
        ) : null
      }
      {() =>
        overlay() === "slash" ? (
          <SlashCommandMenu
            theme={theme}
            query={paletteQuery()}
            rows={slashMenuRows()}
            emptyHint={
              isSlashModelMode()
                ? "No matching models · Esc to close"
                : undefined
            }
            selectedIndex={paletteIndex()}
            x={coreGeometry().x}
            y={coreVerticalLayout().composer.y}
            width={coreGeometry().width}
          />
        ) : null
      }
      {() =>
        overlay() !== "none" && overlay() !== "slash" ? (
          <box
            position="absolute"
            top={0}
            left={0}
            width={width()}
            height={height()}
            backgroundColor={themeColor(theme, colors.background.canvas)}
            shouldFill
            zIndex={100}
          >
            {overlay() === "palette" ? (
              <CommandPalette
                theme={theme}
                query={paletteQuery()}
                commands={uiCommands}
                selectedIndex={paletteIndex()}
                recentIds={recentCommandIds()}
                width={width()}
                height={height()}
                onInput={(value) => {
                  setPaletteQuery(value);
                  setPaletteIndex(0);
                }}
                onSubmit={selectPaletteCommand}
                onKeyDown={handlePaletteKey}
              />
            ) : overlay() === "model-picker" ? (
              <ModelPicker
                theme={theme}
                width={width()}
                height={height()}
                models={modelData()?.models ?? []}
                activeModelId={activeModelId()}
                query={modelQuery()}
                selectedIndex={modelIndex()}
                onInput={(value) => {
                  setModelQuery(value);
                  setModelIndex(0);
                }}
                onMove={(delta) => {
                  const count = modelPickerItems().length;
                  if (count === 0) return;
                  setModelIndex((current) => (current + delta + count) % count);
                }}
                onSubmit={chooseModel}
                onKeyDown={handleModelPickerKey}
              />
            ) : overlay() === "context-picker" ? (
              <ContextPicker
                theme={theme}
                width={width()}
                height={height()}
                files={contextCandidates}
                selectedFiles={contextFiles}
                query={contextQuery}
                selectedIndex={contextIndex}
                onInput={(value) => {
                  setContextQuery(value);
                  setContextIndex(0);
                }}
                onMove={(delta) => {
                  const count = contextPickerItems().length;
                  if (count === 0) return;
                  setContextIndex(
                    (current) => (current + delta + count) % count,
                  );
                }}
                onToggle={toggleContextFile}
                onClose={closeContextPicker}
              />
            ) : (
              <ApprovalDialog
                theme={theme}
                width={width()}
                height={height()}
                action={activeApproval()?.description}
                impact={activeApproval()?.impact}
                scopeDescription={activeApproval()?.scopeDescription}
                busy={approvalBusy()}
                selectedIndex={approvalIndex()}
                onDecision={(decision) => {
                  void resolveApproval(decision);
                }}
                onCancel={() => {
                  void resolveApproval("deny");
                }}
                onMove={(delta) => {
                  setApprovalIndex(
                    (current) =>
                      (current + delta + APPROVAL_OPTIONS.length) %
                      APPROVAL_OPTIONS.length,
                  );
                }}
                onKeyDown={handleKeyDown}
              />
            )}
          </box>
        ) : null
      }
    </box>
  );
}
