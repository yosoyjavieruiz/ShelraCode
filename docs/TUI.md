# TUI

The interface is calm, dense, keyboard-first, and state-explicit. Spacing and grouping carry hierarchy; colors reinforce but do not define privacy, cost, health, or route state.

## Layout

Top bar: LocalCode, repository/branch, selected route/model, privacy.  
Main: transcript and compact tool rows.  
Composer: focused input with command hint.  
Status: plan/context/cost/quota/test summary.

At narrow widths the top bar shortens metadata, optional side content disappears, transcript rows stack, and the composer remains usable. The smoke matrix is 80x24, 100x30, 120x40, and 160x50.

## Interaction

Enter submits; Ctrl+K opens the command palette; Escape closes the top overlay or cancels an active task; Ctrl+C cancels work and exits only when idle; `/` commands open centers. Dialogs have explicit focus and approval states.

## Components

The current tree uses `AppShell`, `TopBar`, `Transcript`, `ToolCallRow`, `Composer`, `StatusBar`, `CommandPalette`, and center dialogs. Business services remain outside them. Verbose tool output is collapsed by default; streaming text and route events append incrementally.
