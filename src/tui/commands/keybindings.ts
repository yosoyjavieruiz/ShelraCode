export const UI_KEYBINDINGS = {
  palette: "Ctrl+P",
  conversation: "Ctrl+X C",
  sessions: "Ctrl+X S",
  models: "Ctrl+X M",
  providers: "Ctrl+X P",
  routing: "Ctrl+X R",
  quota: "Ctrl+X Q",
  privacy: "Ctrl+X V",
  diff: "Ctrl+X D",
  toggleSidebar: "Ctrl+X B",
  settings: "Ctrl+X ,",
  help: "Ctrl+X ?",
  density: "Ctrl+X F",
} as const;

export const LEADER_SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ["c", "conversation"],
  ["s", "sessions"],
  ["m", "model"],
  ["p", "providers"],
  ["r", "routing"],
  ["q", "quota"],
  ["v", "privacy"],
  ["d", "diff"],
  ["b", "toggle-sidebar"],
  ["f", "cycle-density"],
  [",", "settings"],
  ["?", "help"],
];

export const HOME_SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ["ctrl+j", "home-next"],
  ["ctrl+k", "home-previous"],
];
