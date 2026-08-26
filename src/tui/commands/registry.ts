import { UI_KEYBINDINGS } from "./keybindings.js";

export type UICommandCategory =
  | "Recent"
  | "Session"
  | "Navigation"
  | "Models"
  | "Routing"
  | "Project"
  | "Changes"
  | "Appearance"
  | "Settings"
  | "System";

export interface UICommand {
  id: string;
  slash?: string;
  label: string;
  description?: string;
  category: UICommandCategory | string;
  keywords?: string[];
  icon?: string;
  keybinding?: string;
  visible?: () => boolean;
  enabled?: () => boolean;
  run?: () => void | Promise<void>;
}

export function createUICommands(execute: (id: string) => void): UICommand[] {
  const command = (
    id: string,
    label: string,
    category: UICommandCategory,
    options: Omit<UICommand, "id" | "label" | "category" | "run"> = {},
  ): UICommand => ({
    id,
    label,
    category,
    ...options,
    run: () => execute(id),
  });

  return [
    command("conversation", "Open workspace", "Navigation", {
      slash: "/chat",
      description: "Return to the active conversation",
      icon: "◈",
      keybinding: UI_KEYBINDINGS.conversation,
    }),
    command("palette", "Command palette", "Navigation", {
      description: "Search every available action",
      icon: "⌕",
      keybinding: UI_KEYBINDINGS.palette,
      keywords: ["search", "commands", "actions"],
    }),
    command("new", "New session", "Session", {
      slash: "/new",
      description: "Start with a clean conversation",
      icon: "+",
    }),
    command("sessions", "Sessions", "Session", {
      slash: "/sessions",
      description: "Browse recent workspaces",
      icon: "○",
      keybinding: UI_KEYBINDINGS.sessions,
    }),
    command("resume", "Resume selected task", "Session", {
      slash: "/resume",
      description: "Continue a saved task from the current workspace state",
      icon: "->",
      keywords: ["continue", "retry", "task", "saved"],
    }),
    command("models", "Open Models", "Models", {
      slash: "/models",
      description: "Browse local and free cloud models",
      icon: "◆",
      keywords: ["model", "local", "cloud", "catalog"],
    }),
    command("model", "Switch model", "Models", {
      slash: "/model",
      description: "Choose the model for the next task",
      icon: "◆",
      keybinding: UI_KEYBINDINGS.models,
      keywords: ["models", "picker", "local", "cloud", "auto"],
    }),
    command("providers", "Providers", "Models", {
      slash: "/providers",
      description: "Inspect connections and health",
      icon: "●",
      keybinding: UI_KEYBINDINGS.providers,
      keywords: ["groq", "openrouter", "lm studio"],
    }),
    command("retry-health", "Retry provider health", "Models", {
      slash: "/retry-health",
      description: "Probe configured providers before cloud routing",
      icon: "!",
      keywords: ["health", "retry", "provider", "connection"],
    }),
    command("routing", "Routing", "Routing", {
      slash: "/routing",
      description: "Inspect the execution decision",
      icon: "⇄",
      keybinding: UI_KEYBINDINGS.routing,
      keywords: ["route", "policy", "local first"],
    }),
    command("quota", "Usage", "Routing", {
      slash: "/quota",
      description: "View free capacity",
      icon: "▥",
      keybinding: UI_KEYBINDINGS.quota,
      keywords: ["quota", "free", "capacity"],
    }),
    command("privacy", "Privacy", "Routing", {
      slash: "/privacy",
      description: "Review repository privacy policy",
      icon: "◇",
      keybinding: UI_KEYBINDINGS.privacy,
      keywords: ["secret", "zdr", "local only"],
    }),
    command("context", "Context", "Project", {
      slash: "/context",
      description: "See what the agent can use",
      icon: "@",
    }),
    command("plan", "Plan", "Project", {
      slash: "/plan",
      description: "Inspect task progress",
      icon: "≡",
    }),
    command("diff", "Review changes", "Changes", {
      slash: "/diff",
      description: "Review the current diff",
      icon: "±",
      keybinding: UI_KEYBINDINGS.diff,
      keywords: ["changes", "git", "review"],
    }),
    command("changes", "Review changes", "Changes", {
      slash: "/changes",
      description: "Review the current diff",
      icon: "±",
      visible: () => false,
    }),
    command("checkpoint", "Checkpoints", "Changes", {
      slash: "/checkpoints",
      description: "Inspect safe restore points",
      icon: "⌁",
    }),
    command("checkpoint-alias", "Checkpoints", "Changes", {
      slash: "/checkpoint",
      description: "Inspect safe restore points",
      icon: "⌁",
      visible: () => false,
    }),
    command("rollback", "Rollback checkpoint", "Changes", {
      slash: "/rollback",
      description: "Restore Shelra Code-owned changes",
      icon: "↶",
    }),
    command("explain-route", "Explain route", "Routing", {
      slash: "/explain-route",
      description: "See why this route was chosen",
      icon: "?",
    }),
    command("settings", "Settings", "Settings", {
      slash: "/settings",
      description: "Configure the workspace interface",
      icon: "⚙",
      keybinding: UI_KEYBINDINGS.settings,
      keywords: ["theme", "layout", "preferences"],
    }),
    command("theme", "Theme", "Appearance", {
      slash: "/theme",
      description: "Open Obsidian Violet appearance",
      icon: "✦",
    }),
    command("keybinds", "Keybindings", "Appearance", {
      slash: "/keybinds",
      description: "Review keyboard shortcuts",
      icon: "⌘",
    }),
    command("layout", "Layout", "Appearance", {
      slash: "/layout",
      description: "Review responsive layout behavior",
      icon: "▤",
    }),
    command("cycle-density", "Transcript detail", "Appearance", {
      slash: "/density",
      description: "Cycle Default → Focus → Verbose tool detail",
      icon: "≡",
      keybinding: UI_KEYBINDINGS.density,
      keywords: ["focus", "verbose", "compact", "diffstat", "detail"],
    }),
    command("doctor", "Doctor", "System", {
      slash: "/doctor",
      description: "Inspect local readiness",
      icon: "✚",
    }),
    command("setup", "Setup Shelra Code", "System", {
      slash: "/setup",
      description: "Run the guided workspace setup",
      icon: "◆",
      keywords: ["onboarding", "privacy", "routing"],
    }),
    command("status", "System status", "System", {
      slash: "/status",
      description: "Inspect local readiness",
      icon: "✚",
      visible: () => false,
    }),
    command("permissions", "Permissions", "Settings", {
      slash: "/permissions",
      description: "Review and revoke session/project permission rules",
      icon: "◇",
      keywords: ["approve", "allow", "deny", "session", "project", "rules"],
    }),
    command("help", "Help", "System", {
      slash: "/help",
      description: "Learn commands and shortcuts",
      icon: "?",
      keybinding: UI_KEYBINDINGS.help,
    }),
    command("clear", "Clear conversation", "Session", {
      slash: "/clear",
      description: "Clear the visible transcript",
      icon: "×",
    }),
    command("exit", "Exit Shelra Code", "System", {
      slash: "/exit",
      description: "Leave the terminal application",
      icon: "↗",
    }),
  ];
}

function commandSearchText(command: UICommand): string {
  return [
    command.id,
    command.slash,
    command.label,
    command.description,
    ...(command.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function fuzzyScore(
  term: string,
  haystack: string,
  label: string,
): number | undefined {
  if (!term) return 0;
  if (label === term) return 100;
  if (label.startsWith(term)) return 80;
  if (label.includes(term)) return 60;
  let best: number | undefined;
  for (const rawWord of haystack.split(/\s+/)) {
    const word = rawWord.replace(/[^a-z0-9]/g, "");
    if (!word) continue;
    if (word.includes(term)) {
      best = Math.max(best ?? 0, 50);
      continue;
    }
    let cursor = 0;
    let gaps = 0;
    let matched = true;
    for (const character of term) {
      const index = word.indexOf(character, cursor);
      if (index < 0) {
        matched = false;
        break;
      }
      gaps += Math.max(0, index - cursor);
      cursor = index + 1;
    }
    if (matched && gaps <= term.length * 4) {
      best = Math.max(best ?? 0, Math.max(1, 35 - gaps));
    }
  }
  return best;
}

export function rankUICommands(
  commands: readonly UICommand[],
  query: string,
  recentIds: readonly string[] = [],
): UICommand[] {
  const normalized = query.trim().toLowerCase();
  const available = commands.filter((command) => command.visible?.() !== false);
  if (!normalized) {
    return [...available].sort(
      (left, right) =>
        recentIds.indexOf(left.id) - recentIds.indexOf(right.id) ||
        available.indexOf(left) - available.indexOf(right),
    );
  }
  const terms = normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => term.replace(/^\/+/, ""));
  return available
    .map((command, index) => {
      const haystack = commandSearchText(command);
      const label = `${command.label} ${command.slash ?? ""}`.toLowerCase();
      const scores = terms.map((term) => fuzzyScore(term, haystack, label));
      const matched = scores.every(
        (score): score is number => score !== undefined,
      );
      const recent = recentIds.indexOf(command.id);
      return {
        command,
        score: matched
          ? scores.reduce((total, score) => total + score, 0) +
            (command.slash?.toLowerCase() === normalized ? 200 : 0) +
            (recent >= 0 ? Math.max(0, 10 - recent) : 0)
          : -1,
        index,
      };
    })
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.command);
}

export function filterUICommands(
  commands: readonly UICommand[],
  query: string,
): UICommand[] {
  return rankUICommands(commands, query);
}

export function getCommandSlashes(commands: readonly UICommand[]): string[] {
  return commands
    .filter((command) => command.visible?.() !== false && command.slash)
    .map((command) => command.slash as string);
}

export function groupUICommands(
  commands: readonly UICommand[],
): Map<string, UICommand[]> {
  const groups = new Map<string, UICommand[]>();
  for (const command of commands) {
    const group = groups.get(command.category) ?? [];
    group.push(command);
    groups.set(command.category, group);
  }
  return groups;
}
