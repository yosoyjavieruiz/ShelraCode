import type { ApprovalDecision } from "../../tools/permission-grants.js";

export interface ApprovalOption {
  decision: ApprovalDecision;
  key: string;
  label: string;
  detail: string;
}

/** Ordered like the approval APIs exposed by current coding-agent CLIs. */
export const APPROVAL_OPTIONS: readonly ApprovalOption[] = [
  {
    decision: "once",
    key: "o",
    label: "Approve once",
    detail: "Only this exact action",
  },
  {
    decision: "session",
    key: "s",
    label: "Allow for this session",
    detail: "Do not ask again for this tool/risk",
  },
  {
    decision: "project",
    key: "p",
    label: "Always allow in this project",
    detail: "Save a project permission rule",
  },
  {
    decision: "deny",
    key: "d",
    label: "Deny",
    detail: "Block this action and let the agent recover",
  },
  {
    decision: "cancel",
    key: "c",
    label: "Cancel turn",
    detail: "Stop the active task",
  },
];

export function approvalDecisionForKey(
  key: string | undefined,
): ApprovalDecision | undefined {
  if (!key) return undefined;
  return APPROVAL_OPTIONS.find((option) => option.key === key.toLowerCase())
    ?.decision;
}

export function approvalOptionIndex(decision: ApprovalDecision): number {
  const index = APPROVAL_OPTIONS.findIndex(
    (option) => option.decision === decision,
  );
  return index >= 0 ? index : 0;
}
