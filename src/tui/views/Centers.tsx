import type { LocalModelRecommendation } from "../../hardware/types.js";
import type { HardwareInspection } from "../../hardware/types.js";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { ProviderStatus } from "../../providers/registry.js";
import type { SessionSummary } from "../../storage/database.js";
import { createMemo } from "solid-js";
import type {
  ModelCandidate,
  PermissionMode,
  QuotaSnapshot,
  RepositoryPrivacy,
  RoutingMode,
  RouteDecision,
} from "../../shared/types.js";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";
import {
  EmptyState,
  LoadingState,
  Meter,
  Metric,
  SectionHeading,
  StatusDot,
  Tag,
} from "../components/primitives.js";
import { SelectableRow } from "../components/SelectableRow.js";
import { StatusMark } from "../components/StatusMark.js";

export type CenterScreen =
  | "models"
  | "providers"
  | "quota"
  | "routing"
  | "privacy"
  | "context"
  | "plan"
  | "diff"
  | "doctor"
  | "help"
  | "settings"
  | "sessions"
  | "checkpoint"
  | "rollback"
  | "explain-route";

export interface ModelCenterData {
  recommendations: LocalModelRecommendation[];
  models: ModelCandidate[];
  quotas: Record<string, QuotaSnapshot>;
}

function quietScrollbar(theme: ThemeTokens) {
  return theme.colorsEnabled
    ? {
        visible: false,
        showArrows: false,
        trackOptions: {
          foregroundColor: theme.colors.background.canvas,
          backgroundColor: theme.colors.background.canvas,
        },
      }
    : undefined;
}

function hideScrollbars(scrollbox: ScrollBoxRenderable): void {
  queueMicrotask(() => {
    scrollbox.verticalScrollBar.visible = false;
    scrollbox.horizontalScrollBar.visible = false;
  });
}

function compactModelName(name: string, width: number): string {
  if (name.length <= width) return name;
  return `${name.slice(0, Math.max(4, width - 1))}…`;
}

export function ModelsView(props: {
  theme: ThemeTokens;
  width: number;
  data?: ModelCenterData;
}) {
  const colors = props.theme.colors;
  const data = props.data;
  if (!data) {
    return (
      <LoadingState
        theme={props.theme}
        title="Discovering models"
        detail="Checking local runtimes and verified free capacity…"
      />
    );
  }
  const local = data.models.filter((model) => model.source === "local");
  const cloud = data.models.filter((model) => model.source === "free_cloud");
  const active = local[0] ?? cloud[0];
  const localAlternatives = local.filter((model) => model.id !== active?.id);
  const recommendations = data.recommendations.filter(
    (recommendation) =>
      !active ||
      (recommendation.id !== active.id &&
        recommendation.displayName !== active.displayName),
  );
  return (
    <box flexDirection="column" gap={1} flexGrow={1} width="100%">
      <SectionHeading
        theme={props.theme}
        eyebrow="Model center"
        title="Models"
        detail={`${data.models.length} discovered`}
      />
      {active ? (
        <box
          width="100%"
          padding={1}
          flexDirection="column"
          gap={1}
          backgroundColor={themeColor(props.theme, colors.background.active)}
        >
          <box width="100%" flexDirection="row" justifyContent="space-between">
            <text fg={themeColor(props.theme, colors.text.primary)}>
              <strong>Active</strong>
            </text>
            <Tag
              theme={props.theme}
              label={active.source === "local" ? "LOCAL" : "FREE"}
              tone={active.source === "local" ? "local" : "cloud"}
            />
          </box>
          <text fg={themeColor(props.theme, colors.purple[300])}>
            <strong>
              {compactModelName(active.displayName, props.width - 8)}
            </strong>
          </text>
          <text fg={themeColor(props.theme, colors.text.secondary)}>
            {active.local?.runtime ?? active.providerId} · {active.health.state}
            {active.capabilities.maxContext
              ? ` · ${Math.round(active.capabilities.maxContext / 1000)}k context`
              : ""}
          </text>
        </box>
      ) : null}
      <scrollbox
        ref={hideScrollbars}
        flexGrow={1}
        width="100%"
        viewportCulling
        scrollbarOptions={quietScrollbar(props.theme)}
      >
        <box flexDirection="column" gap={1}>
          <text fg={themeColor(props.theme, colors.text.muted)}>
            RECOMMENDED FOR THIS MACHINE
          </text>
          {recommendations.slice(0, 3).map((recommendation, index) => (
            <box
              width="100%"
              padding={1}
              flexDirection="column"
              gap={0}
              backgroundColor={
                index === 0
                  ? themeColor(props.theme, colors.background.elevated)
                  : undefined
              }
            >
              <box
                width="100%"
                flexDirection="row"
                justifyContent="space-between"
              >
                <text fg={themeColor(props.theme, colors.text.primary)}>
                  <strong>
                    {index === 0
                      ? "BEST FIT"
                      : index === 1
                        ? "FAST"
                        : "STRETCH"}
                  </strong>
                </text>
                <text fg={themeColor(props.theme, colors.purple[300])}>
                  {recommendation.fit ?? "FIT"}
                </text>
              </box>
              <text fg={themeColor(props.theme, colors.text.primary)}>
                {compactModelName(recommendation.displayName, props.width - 10)}
              </text>
              <text fg={themeColor(props.theme, colors.text.tertiary)}>
                {recommendation.runtime ?? "local runtime"}
                {recommendation.quantization
                  ? ` · ${recommendation.quantization}`
                  : ""}
                {recommendation.estimatedMemoryGb
                  ? ` · ${recommendation.estimatedMemoryGb} GB`
                  : ""}
                {recommendation.estimatedTps
                  ? ` · ~${recommendation.estimatedTps} tok/s`
                  : ""}
              </text>
            </box>
          ))}
          {recommendations.length === 0 ? (
            <text fg={themeColor(props.theme, colors.text.tertiary)}>
              Active model is the current best fit for this workspace.
            </text>
          ) : null}
          <text fg={themeColor(props.theme, colors.text.muted)}>LOCAL</text>
          {localAlternatives.length > 0 ? (
            localAlternatives
              .slice(0, props.width < 100 ? 3 : 6)
              .map((model) => (
                <ModelRow
                  theme={props.theme}
                  model={model}
                  width={props.width}
                />
              ))
          ) : (
            <text fg={themeColor(props.theme, colors.text.tertiary)}>
              Active local model is shown above.
            </text>
          )}
          <text fg={themeColor(props.theme, colors.text.muted)}>
            FREE CLOUD
          </text>
          {cloud.length === 0 ? (
            <text fg={themeColor(props.theme, colors.text.tertiary)}>
              No verified free-cloud capacity is available right now.
            </text>
          ) : null}
          {cloud.slice(0, props.width < 100 ? 3 : 8).map((model) => (
            <ModelRow theme={props.theme} model={model} width={props.width} />
          ))}
          {local.length === 0 && cloud.length === 0 ? (
            <EmptyState
              theme={props.theme}
              title="No model is ready"
              detail="Shelra Code can continue in local-only setup once a runtime is available."
              action="Run /doctor"
            />
          ) : null}
        </box>
      </scrollbox>
    </box>
  );
}

function ModelRow(props: {
  theme: ThemeTokens;
  model: ModelCandidate;
  width: number;
}) {
  const colors = props.theme.colors;
  return (
    <box
      width={props.width < 110 ? "94%" : "100%"}
      flexDirection="row"
      justifyContent="space-between"
      gap={1}
    >
      <box flexDirection="row" gap={1} flexGrow={1}>
        <StatusDot
          theme={props.theme}
          state={
            props.model.health.state === "healthy"
              ? "success"
              : props.model.health.state === "degraded"
                ? "warning"
                : "muted"
          }
        />
        <text fg={themeColor(props.theme, colors.text.secondary)}>
          {compactModelName(
            props.model.displayName,
            props.width < 110 ? 22 : 32,
          )}
        </text>
      </box>
      <text fg={themeColor(props.theme, colors.text.muted)}>
        {compactModelName(
          props.model.local?.runtime ?? props.model.providerId,
          props.width < 110 ? 10 : 16,
        )}
      </text>
    </box>
  );
}

export function ProvidersView(props: {
  theme: ThemeTokens;
  providers: ProviderStatus[];
  actionIndex?: number;
  onActionFocus?: (index: number) => void;
  onRetry?: () => void;
  onUseLocal?: () => void;
}) {
  const colors = props.theme.colors;
  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <SectionHeading
        theme={props.theme}
        eyebrow="Free cloud mesh"
        title="Providers"
        detail={`${props.providers.filter((item) => item.configured).length} configured`}
      />
      <scrollbox
        ref={hideScrollbars}
        flexGrow={1}
        minHeight={0}
        viewportCulling
        scrollbarOptions={quietScrollbar(props.theme)}
      >
        <box flexDirection="column" gap={1}>
          {props.providers.map((provider) => (
            <box
              padding={1}
              flexDirection="column"
              gap={0}
              backgroundColor={
                provider.configured
                  ? themeColor(props.theme, colors.background.elevated)
                  : undefined
              }
            >
              {(() => {
                const degraded =
                  provider.freeStatus === "stale" ||
                  provider.freeStatus === "unknown" ||
                  provider.privacy === "unknown";
                return (
                  <>
                    <text fg={themeColor(props.theme, colors.text.primary)}>
                      <strong>{provider.displayName}</strong>
                    </text>
                    <StatusMark
                      theme={props.theme}
                      state={
                        degraded
                          ? "warning"
                          : provider.configured
                            ? "success"
                            : "muted"
                      }
                      label={
                        degraded
                          ? "degraded · local fallback"
                          : provider.configured
                            ? "connected"
                            : "not configured"
                      }
                    />
                    <text fg={themeColor(props.theme, colors.text.tertiary)}>
                      {provider.endpoint}
                    </text>
                    <text fg={themeColor(props.theme, colors.text.secondary)}>
                      Free eligibility: {provider.freeStatus} · Privacy:{" "}
                      {provider.privacy}
                    </text>
                    <text fg={themeColor(props.theme, colors.text.muted)}>
                      {provider.note}
                    </text>
                    {degraded ? (
                      <box flexDirection="column" gap={0}>
                        <text
                          fg={themeColor(props.theme, colors.status.warning)}
                        >
                          Cloud routing paused
                        </text>
                        <SelectableRow
                          theme={props.theme}
                          focused={props.actionIndex === 0}
                          title="Retry provider health"
                          subtitle="Recheck free capacity and privacy"
                          onActivate={() => {
                            props.onActionFocus?.(0);
                            props.onRetry?.();
                          }}
                        />
                        <SelectableRow
                          theme={props.theme}
                          focused={props.actionIndex === 1}
                          title="Use local route"
                          subtitle="Keep inference on the local runtime"
                          onActivate={() => {
                            props.onActionFocus?.(1);
                            props.onUseLocal?.();
                          }}
                        />
                      </box>
                    ) : null}
                  </>
                );
              })()}
            </box>
          ))}
          {props.providers.length === 0 ? (
            <EmptyState
              theme={props.theme}
              title="Local-only mode is ready"
              detail="No cloud provider is configured. This is a valid Shelra Code setup."
            />
          ) : null}
        </box>
      </scrollbox>
    </box>
  );
}

export function QuotaView(props: {
  theme: ThemeTokens;
  quotas: Record<string, QuotaSnapshot>;
  width?: number;
}) {
  const colors = props.theme.colors;
  const entries = Object.entries(props.quotas);
  const meterWidth = Math.max(
    12,
    Math.min(48, Math.floor(((props.width ?? 120) - 24) * 0.32)),
  );
  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <SectionHeading
        theme={props.theme}
        eyebrow="Free capacity"
        title="Usage"
      />
      <scrollbox
        ref={hideScrollbars}
        flexGrow={1}
        viewportCulling
        scrollbarOptions={quietScrollbar(props.theme)}
      >
        <box flexDirection="column" gap={1}>
          {entries.map(([providerId, quota]) => {
            const remaining =
              quota.requestsRemaining !== undefined && quota.requestsLimit
                ? quota.requestsRemaining / quota.requestsLimit
                : quota.tokensRemaining !== undefined && quota.tokensLimit
                  ? quota.tokensRemaining / quota.tokensLimit
                  : 0;
            const label =
              quota.requestsRemaining !== undefined
                ? `${quota.requestsRemaining}/${quota.requestsLimit ?? "?"} requests`
                : quota.tokensRemaining !== undefined
                  ? `${quota.tokensRemaining}/${quota.tokensLimit ?? "?"} tokens`
                  : "unverified";
            return (
              <box padding={1} flexDirection="column" gap={0}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={themeColor(props.theme, colors.text.primary)}>
                    <strong>{providerId}</strong>
                  </text>
                  <text fg={themeColor(props.theme, colors.text.muted)}>
                    {quota.confidence}
                  </text>
                </box>
                <Meter
                  theme={props.theme}
                  value={remaining}
                  width={meterWidth}
                  label={label}
                  tone={remaining < 0.2 ? "warning" : "accent"}
                />
                <text fg={themeColor(props.theme, colors.text.muted)}>
                  Reset {quota.resetAt ?? "not reported"}
                </text>
              </box>
            );
          })}
          {entries.length === 0 ? (
            <EmptyState
              theme={props.theme}
              title="No quota snapshots yet"
              detail="Connect a provider or run /models to refresh free capacity."
            />
          ) : null}
        </box>
      </scrollbox>
    </box>
  );
}

export function RoutingView(props: {
  theme: ThemeTokens;
  decision?: RouteDecision;
  lines: string[];
  width?: number;
}) {
  const colors = props.theme.colors;
  const compact = (props.width ?? 120) < 100;
  const selected = props.decision?.selected;
  const selectedLabel = selected
    ? `${selected.candidate.providerId} / ${selected.candidate.displayName}`
    : "STOP · ASK USER";
  const explanation =
    props.decision?.explanation ??
    "Submit a task to create a live route explanation.";
  const stages = [
    "TASK",
    "PRIVACY",
    "CAPABILITY",
    "COST",
    "QUOTA",
    "SELECTION",
  ];
  return (
    <box flexDirection="column" gap={1} flexGrow={1} width="100%">
      <SectionHeading
        theme={props.theme}
        eyebrow="Explainable routing"
        title="Routing"
      />
      <box flexDirection="row" gap={1}>
        {stages.slice(0, 3).map((stage) => (
          <text fg={themeColor(props.theme, colors.text.secondary)}>
            {stage} →
          </text>
        ))}
      </box>
      <box flexDirection="row" gap={1}>
        {stages.slice(3).map((stage, index) => (
          <text
            fg={themeColor(
              props.theme,
              index === stages.slice(3).length - 1
                ? colors.purple[300]
                : colors.text.secondary,
            )}
          >
            {stage}
            {index < 2 ? " →" : ""}
          </text>
        ))}
      </box>
      {compact ? (
        <text
          width="100%"
          wrapMode="word"
          fg={themeColor(props.theme, colors.text.secondary)}
        >
          {`SELECTED  ${selectedLabel}\n${explanation}`}
        </text>
      ) : (
        <box
          width="100%"
          padding={1}
          flexDirection="column"
          gap={0}
          backgroundColor={themeColor(props.theme, colors.background.active)}
        >
          <text width="100%" fg={themeColor(props.theme, colors.text.muted)}>
            SELECTED
          </text>
          <text
            width="100%"
            wrapMode="word"
            fg={themeColor(props.theme, colors.purple[300])}
          >
            <strong>{selectedLabel}</strong>
          </text>
          <text
            width="100%"
            wrapMode="word"
            fg={themeColor(props.theme, colors.text.secondary)}
          >
            {explanation}
          </text>
        </box>
      )}
      {props.decision && compact ? (
        <text
          width="100%"
          wrapMode="word"
          fg={themeColor(props.theme, colors.text.muted)}
        >
          {`SIGNALS  task fit ${Math.round((selected?.breakdown.taskFit ?? 0) * 100)}% · reliability ${Math.round((selected?.breakdown.reliability ?? 0) * 100)}% · quota ${Math.round((selected?.breakdown.quotaHeadroom ?? 0) * 100)}%`}
        </text>
      ) : props.decision ? (
        <box flexDirection="column" gap={0} width="100%">
          <text fg={themeColor(props.theme, colors.text.muted)}>SIGNALS</text>
          <Meter
            theme={props.theme}
            value={selected?.breakdown.taskFit ?? 0}
            label={`task fit ${Math.round((selected?.breakdown.taskFit ?? 0) * 100)}%`}
          />
          <Meter
            theme={props.theme}
            value={selected?.breakdown.reliability ?? 0}
            label={`reliability ${Math.round((selected?.breakdown.reliability ?? 0) * 100)}%`}
            tone="success"
          />
          <Meter
            theme={props.theme}
            value={selected?.breakdown.quotaHeadroom ?? 0}
            label={`quota ${Math.round((selected?.breakdown.quotaHeadroom ?? 0) * 100)}%`}
            tone="warning"
          />
        </box>
      ) : null}
      <scrollbox
        ref={hideScrollbars}
        height={Math.max(5, Math.min(12, props.lines.length + 2))}
        width="100%"
        flexGrow={1}
        minHeight={0}
        viewportCulling
        scrollbarOptions={quietScrollbar(props.theme)}
      >
        <box flexDirection="column" gap={0}>
          <text fg={themeColor(props.theme, colors.text.muted)}>
            DECISION LOG
          </text>
          {props.lines.map((line) => (
            <text fg={themeColor(props.theme, colors.text.secondary)}>
              {line}
            </text>
          ))}
        </box>
      </scrollbox>
    </box>
  );
}

export function PrivacyView(props: {
  theme: ThemeTokens;
  privacy?: RepositoryPrivacy;
  routingMode?: string;
  lines: string[];
}) {
  const colors = props.theme.colors;
  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <SectionHeading
        theme={props.theme}
        eyebrow="Policy center"
        title="Privacy"
      />
      <box
        padding={1}
        flexDirection="column"
        backgroundColor={themeColor(props.theme, colors.background.active)}
      >
        <text fg={themeColor(props.theme, colors.purple[300])}>
          <strong>{(props.privacy ?? "PRIVATE").toUpperCase()}</strong>
        </text>
        <text fg={themeColor(props.theme, colors.text.secondary)}>
          Routing {props.routingMode ?? "strict-zero"}
        </text>
      </box>
      <text fg={themeColor(props.theme, colors.text.muted)}>GUARDRAILS</text>
      {props.lines.map((line) => (
        <text fg={themeColor(props.theme, colors.text.secondary)}>{line}</text>
      ))}
      <text fg={themeColor(props.theme, colors.status.success)}>
        ✓ Secrets are blocked from non-compliant remote routes.
      </text>
    </box>
  );
}

export function SetupView(props: {
  theme: ThemeTokens;
  stage: number;
  hardware?: HardwareInspection;
  modelData?: ModelCenterData;
  providers: ProviderStatus[];
  privacy: RepositoryPrivacy;
  routingMode: string;
}) {
  const colors = props.theme.colors;
  const stages = [
    "Welcome",
    "Hardware",
    "Local model",
    "Free cloud",
    "Privacy",
    "Routing",
    "Ready",
  ];
  const stage = createMemo(() =>
    Math.min(stages.length - 1, Math.max(0, props.stage)),
  );
  const profile = createMemo(() => props.hardware?.profile);
  const localModel = createMemo(() =>
    props.modelData?.models.find((model) => model.source === "local"),
  );
  const connected = createMemo(() =>
    props.providers.filter((provider) => provider.configured),
  );
  const progress = createMemo(() =>
    stages
      .map((label, index) => `${index <= stage() ? "●" : "○"} ${label}`)
      .join("  "),
  );

  return (
    <box flexDirection="column" gap={1} flexGrow={1} paddingX={1}>
      <SectionHeading
        theme={props.theme}
        eyebrow="Setup"
        title="Shelra Code"
        detail={`${stage() + 1}/${stages.length}`}
      />
      <text fg={themeColor(props.theme, colors.purple[300])}>{progress()}</text>
      <box
        flexGrow={1}
        padding={2}
        flexDirection="column"
        gap={1}
        backgroundColor={themeColor(props.theme, colors.background.surface)}
      >
        {stage() === 0 ? (
          <>
            <text fg={themeColor(props.theme, colors.purple[300])}>
              <strong>◈</strong>
            </text>
            <text fg={themeColor(props.theme, colors.text.primary)}>
              <strong>Your code. Your hardware. Your choice of AI.</strong>
            </text>
            <text fg={themeColor(props.theme, colors.text.secondary)}>
              Local when possible. Free cloud when useful. Paid only with your
              explicit approval.
            </text>
          </>
        ) : null}
        {stage() === 1 ? (
          <>
            <text fg={themeColor(props.theme, colors.text.primary)}>
              <strong>Your machine</strong>
            </text>
            <text fg={themeColor(props.theme, colors.text.secondary)}>
              {profile()
                ? `${profile()?.cpuModel} · ${profile()?.memoryGb} GB`
                : "Scanning hardware…"}
            </text>
            <text fg={themeColor(props.theme, colors.text.tertiary)}>
              Accelerator {profile()?.accelerator ?? "pending"}
            </text>
            <text fg={themeColor(props.theme, colors.text.tertiary)}>
              Hardware intelligence{" "}
              {props.hardware?.llmfitAvailable
                ? "llmfit ready"
                : "basic detection"}
            </text>
          </>
        ) : null}
        {stage() === 2 ? (
          <>
            <text fg={themeColor(props.theme, colors.text.primary)}>
              <strong>Recommended local model</strong>
            </text>
            <text fg={themeColor(props.theme, colors.purple[300])}>
              {localModel()?.displayName ?? "Discovering local runtimes…"}
            </text>
            <text fg={themeColor(props.theme, colors.text.tertiary)}>
              {localModel()
                ? `${localModel()?.local?.runtime ?? localModel()?.providerId} · ${localModel()?.health.state}`
                : "Local-only mode remains available without a model."}
            </text>
          </>
        ) : null}
        {stage() === 3 ? (
          <>
            <text fg={themeColor(props.theme, colors.text.primary)}>
              <strong>Optional free cloud</strong>
            </text>
            <text fg={themeColor(props.theme, colors.text.secondary)}>
              Connect providers to increase capacity without enabling automatic
              paid usage.
            </text>
            {props.providers.map((provider) => (
              <box flexDirection="row" gap={1}>
                <StatusDot
                  theme={props.theme}
                  state={provider.configured ? "success" : "muted"}
                />
                <text fg={themeColor(props.theme, colors.text.secondary)}>
                  {provider.displayName} ·{" "}
                  {provider.configured ? "ready" : "not configured"}
                </text>
              </box>
            ))}
            {props.providers.length === 0 ? (
              <text fg={themeColor(props.theme, colors.text.muted)}>
                No provider is required. Local-only is a first-class setup.
              </text>
            ) : null}
          </>
        ) : null}
        {stage() === 4 ? (
          <>
            <text fg={themeColor(props.theme, colors.text.primary)}>
              <strong>Repository privacy</strong>
            </text>
            <text fg={themeColor(props.theme, colors.purple[300])}>
              {props.privacy.toUpperCase()}
            </text>
            <text fg={themeColor(props.theme, colors.text.secondary)}>
              Secrets and credential-shaped paths are blocked from non-compliant
              remote routes.
            </text>
            <text fg={themeColor(props.theme, colors.text.muted)}>
              Press P to cycle policy · current choice is saved at the end.
            </text>
          </>
        ) : null}
        {stage() === 5 ? (
          <>
            <text fg={themeColor(props.theme, colors.text.primary)}>
              <strong>Routing policy</strong>
            </text>
            <text fg={themeColor(props.theme, colors.purple[300])}>
              Local → Verified free cloud → Stop & Ask
            </text>
            <text fg={themeColor(props.theme, colors.text.secondary)}>
              Mode {props.routingMode}
            </text>
            <text fg={themeColor(props.theme, colors.text.muted)}>
              Press R to switch between strict-zero and ask-before-paid.
            </text>
          </>
        ) : null}
        {stage() === 6 ? (
          <>
            <text fg={themeColor(props.theme, colors.text.primary)}>
              <strong>You’re ready.</strong>
            </text>
            <Metric
              theme={props.theme}
              label="Local model"
              value={localModel()?.displayName ?? "not configured"}
            />
            <Metric
              theme={props.theme}
              label="Free providers"
              value={String(connected().length)}
            />
            <Metric theme={props.theme} label="Privacy" value={props.privacy} />
            <Metric theme={props.theme} label="Paid auto-usage" value="Off" />
            <text fg={themeColor(props.theme, colors.status.success)}>
              Local-first routing is ready.
            </text>
          </>
        ) : null}
      </box>
      <text fg={themeColor(props.theme, colors.text.muted)}>
        Enter continue · P privacy · R routing · Esc exit
      </text>
    </box>
  );
}

export function SettingsView(props: {
  theme: ThemeTokens;
  density: "comfortable" | "compact";
  reducedMotion: boolean;
  width?: number;
  privacy?: RepositoryPrivacy;
  routingMode?: RoutingMode;
  permissionMode?: PermissionMode;
  selectedIndex?: number;
  query?: string;
  onQuery?: (value: string) => void;
  onKeyDown?: (event: import("@opentui/core").KeyEvent) => void;
  onActivate?: (index: number) => void;
}) {
  const colors = props.theme.colors;
  const rows: Array<[string, string, string]> = [
    ["Theme", "Obsidian Violet", "appearance"],
    ["Accent", "Violet · #8B5CF6", "appearance"],
    ["Interface density", props.density, "appearance"],
    ["Motion", props.reducedMotion ? "Reduced" : "System", "appearance"],
    ["Repository privacy", props.privacy ?? "private", "policy"],
    ["Routing mode", props.routingMode ?? "strict-zero", "policy"],
    ["Permission mode", props.permissionMode ?? "EDIT", "policy"],
    ["Secondary chrome", "Conversation-first · transient", "layout"],
    ["Tool activity", "Grouped · collapsed by default", "interaction"],
    ["Keybindings", "Default · Ctrl+P palette", "interaction"],
    ["Telemetry", "Off", "privacy"],
  ];
  const compact = (props.width ?? 120) < 110;
  const selected = () => props.selectedIndex ?? 0;
  const visibleRows = () =>
    rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        const query = props.query?.trim().toLowerCase() ?? "";
        return !query || row.join(" ").toLowerCase().includes(query);
      });
  const selectedCategory = () =>
    visibleRows().find(({ index }) => index === selected())?.row[2] ??
    "appearance";
  const displayedRows = () =>
    compact
      ? visibleRows()
      : visibleRows().filter(({ row }) => row[2] === selectedCategory());
  const compactValue = (value: string): string =>
    value
      .replace("Conversation-first · transient", "Transient")
      .replace("Grouped · collapsed by default", "Grouped")
      .replace("Default · Ctrl+P palette", "Default")
      .replace("strict-zero", "Strict zero")
      .replace("private", "Private")
      .replace("EDIT", "Edit");
  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <SectionHeading
        theme={props.theme}
        eyebrow="Workspace preferences"
        title="Settings"
      />
      <text fg={themeColor(props.theme, colors.text.secondary)}>
        Obsidian Violet
      </text>
      <input
        width="100%"
        value={props.query ?? ""}
        onInput={(value) => props.onQuery?.(value)}
        onKeyDown={props.onKeyDown}
        focused
        backgroundColor={themeColor(props.theme, colors.background.surface)}
        textColor={themeColor(props.theme, colors.text.primary)}
        placeholder="Filter settings…"
        placeholderColor={themeColor(props.theme, colors.text.muted)}
        cursorColor={themeColor(props.theme, colors.purple[400])}
      />
      <box flexDirection="row" gap={3} flexGrow={1}>
        {!compact ? (
          <box width={19} flexDirection="column" gap={1}>
            {["Appearance", "Layout", "Interaction", "Policy", "Privacy"].map(
              (item, index) => (
                <text
                  fg={themeColor(
                    props.theme,
                    selectedCategory() === item.toLowerCase()
                      ? colors.purple[300]
                      : colors.text.muted,
                  )}
                >
                  {selectedCategory() === item.toLowerCase() ? "> " : "  "}
                  {item}
                </text>
              ),
            )}
          </box>
        ) : null}
        <scrollbox
          ref={hideScrollbars}
          flexGrow={1}
          viewportCulling
          scrollbarOptions={quietScrollbar(props.theme)}
        >
          <box flexDirection="column" gap={compact ? 0 : 1}>
            <text fg={themeColor(props.theme, colors.text.muted)}>
              SETTINGS · {visibleRows().length} settings · ↑↓ select · Enter
              change · ↓ scroll
            </text>
            {displayedRows().map(
              ({ row: [label, value, category], index }, visibleIndex) => (
                <box flexDirection="column" gap={0}>
                  {!compact &&
                  (visibleIndex === 0 ||
                    displayedRows()[visibleIndex - 1]?.row[2] !== category) ? (
                    <text fg={themeColor(props.theme, colors.text.muted)}>
                      {category.toUpperCase()}
                    </text>
                  ) : null}
                  <SelectableRow
                    theme={props.theme}
                    selected={selected() === index}
                    title={label}
                    subtitle={compact ? compactValue(value) : undefined}
                    trailing={compact ? undefined : value}
                    onActivate={() => props.onActivate?.(index)}
                  />
                </box>
              ),
            )}
          </box>
        </scrollbox>
      </box>
    </box>
  );
}

export function SessionsView(props: {
  theme: ThemeTokens;
  sessions: SessionSummary[];
  selectedIndex?: number;
  onSelect?: (index: number) => void;
}) {
  const colors = props.theme.colors;
  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <SectionHeading
        theme={props.theme}
        eyebrow="Workspace history"
        title="Sessions"
        detail={`${props.sessions.length} local`}
      />
      <scrollbox
        ref={hideScrollbars}
        flexGrow={1}
        viewportCulling
        scrollbarOptions={quietScrollbar(props.theme)}
      >
        <box flexDirection="column" gap={1}>
          {props.sessions.map((session, index) => (
            <SelectableRow
              theme={props.theme}
              selected={(props.selectedIndex ?? 0) === index}
              title={session.objective}
              subtitle={session.repository}
              trailing={session.updatedAt.slice(0, 10)}
              onActivate={() => props.onSelect?.(index)}
            />
          ))}
          {props.sessions.length === 0 ? (
            <EmptyState
              theme={props.theme}
              title="No saved sessions yet"
              detail="Submit a task to create a local session timeline."
            />
          ) : null}
        </box>
      </scrollbox>
      <text fg={themeColor(props.theme, colors.text.muted)}>
        ↑↓ select · Enter open · Esc return
      </text>
    </box>
  );
}

export function GenericCenterView(props: {
  theme: ThemeTokens;
  title: string;
  eyebrow?: string;
  lines: string[];
}) {
  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <SectionHeading
        theme={props.theme}
        eyebrow={props.eyebrow}
        title={props.title}
      />
      <scrollbox
        ref={hideScrollbars}
        flexGrow={1}
        viewportCulling
        scrollbarOptions={quietScrollbar(props.theme)}
      >
        <box flexDirection="column" gap={0}>
          {props.lines.length === 0 ? (
            <EmptyState
              theme={props.theme}
              title="Nothing to show yet"
              detail="This view will fill as Shelra Code observes the workspace."
            />
          ) : (
            props.lines.map((line) => (
              <text
                fg={themeColor(props.theme, props.theme.colors.text.secondary)}
              >
                {line}
              </text>
            ))
          )}
        </box>
      </scrollbox>
    </box>
  );
}

export function ChangesView(props: {
  theme: ThemeTokens;
  diff: string;
  lines: string[];
  view?: "unified" | "split";
  hunkIndex?: number;
}) {
  const colors = props.theme.colors;
  const diffLines = props.diff.split(/\r?\n/);
  const additions = diffLines.filter(
    (line) => line.startsWith("+") && !line.startsWith("+++"),
  ).length;
  const removals = diffLines.filter(
    (line) => line.startsWith("-") && !line.startsWith("---"),
  ).length;
  const file = diffLines
    .find((line) => line.startsWith("+++ "))
    ?.replace(/^\+\+\+ [ab]\//, "");
  const canRenderDiff =
    diffLines.some((line) => line.startsWith("@@ ")) &&
    diffLines.some((line) => line.startsWith("+++ "));
  const hunkCount = diffLines.filter((line) => line.startsWith("@@ ")).length;
  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <SectionHeading
        theme={props.theme}
        eyebrow="Review"
        title="Changes"
        detail={props.diff ? "working tree" : "clean"}
      />
      {props.lines.length > 0 ? (
        <text fg={themeColor(props.theme, colors.text.muted)}>
          {props.lines[0]}
        </text>
      ) : null}
      {props.diff && canRenderDiff ? (
        <box flexDirection="column" gap={1} flexGrow={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={themeColor(props.theme, colors.text.secondary)}>
              {file ?? "working tree"}
            </text>
            <text fg={themeColor(props.theme, colors.text.muted)}>
              +{additions} added · -{removals} removed
            </text>
          </box>
          <diff
            flexGrow={1}
            width="100%"
            diff={props.diff}
            view={props.view ?? "unified"}
            showLineNumbers
            addedBg={themeColor(props.theme, colors.git.addedBackground)}
            removedBg={themeColor(props.theme, colors.git.removedBackground)}
            contextBg={themeColor(props.theme, colors.background.canvas)}
            addedSignColor={themeColor(props.theme, colors.git.added)}
            removedSignColor={themeColor(props.theme, colors.git.removed)}
            lineNumberFg={themeColor(props.theme, colors.text.muted)}
          />
          <text fg={themeColor(props.theme, colors.text.muted)}>
            {`j/k hunk ${Math.min((props.hunkIndex ?? 0) + 1, Math.max(1, hunkCount))}/${Math.max(1, hunkCount)} · v ${props.view === "split" ? "unified" : "split"} · Esc back`}
          </text>
        </box>
      ) : props.diff ? (
        <box flexDirection="column" gap={1} flexGrow={1}>
          <StatusMark
            theme={props.theme}
            state="warning"
            label="Diff preview unavailable"
            detail="Showing the raw change payload"
          />
          <scrollbox
            ref={hideScrollbars}
            flexGrow={1}
            viewportCulling
            scrollbarOptions={quietScrollbar(props.theme)}
          >
            <text
              fg={themeColor(props.theme, colors.text.secondary)}
              wrapMode="word"
            >
              {props.diff}
            </text>
          </scrollbox>
        </box>
      ) : (
        <EmptyState
          theme={props.theme}
          icon="✓"
          title="Working tree clean"
          detail="No Shelra Code changes to review."
        />
      )}
    </box>
  );
}
