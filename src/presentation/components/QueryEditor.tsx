/**
 * QueryEditor — the SQL editor pane (top-right of the workbench): ONE bordered
 * panel with two stacked sections, an "ask" row on top and the SQL editor below,
 * split by a divider:
 *
 *   ╭─────────────────────────────────╮
 *   │ ✦ ask   how many active users?  │   ← NL→SQL input (active on ^G)
 *   │ ─────────────────────────────── │   ← divider
 *   │ SQL>    SELECT count(*) …        │   ← SQL editor (native input)
 *   │ ⇥ users · user_id …             │   ← completions / explanation / error
 *   ╰─────────────────────────────────╯
 *
 * Both the ask row and the SQL line are native OpenTUI <input> widgets: each owns
 * its own text + cursor (the cursor is the terminal's, no hand-rolled glyph), and
 * reports edits via onInput / submits via onSubmit. The store holds only the
 * committed query string (bound to the SQL input's `value`); history, completion
 * and NL all drive it through that prop. While the editor is empty the statement
 * behind the current grid shows as the input's dim placeholder. Running a query
 * sends its result to the shared grid — the editor never renders results itself (SRP).
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
import {
  isDestructive,
  type StatementKind,
} from '../../domain/query/classify.ts';
import { theme, INPUT_CURSOR } from '../theme/theme.ts';

interface Props {
  /** The committed query text the SQL input is bound to (it owns the cursor). */
  queryText: string;
  /** Read-only echo of the statement behind the current grid (browse SQL or the
   *  executed query), shown as the input's dim placeholder while it is empty so
   *  the panel always reflects how the result was produced. */
  statement: string | null;
  /** Editor pane focused; the SQL input is active when not in `nlMode`. */
  focused: boolean;
  /** The ask row is active (capturing the NL prompt). */
  nlMode: boolean;
  /** The NL prompt was submitted (Enter) — generate SQL from it. */
  onNlSubmit: (prompt: string) => void;
  /** The SQL input changed — sync the store (re-derives completions). */
  onQueryInput: (value: string) => void;
  /** The SQL input was submitted (Enter) — run the query. */
  onQuerySubmit: () => void;
  completions: string[];
  generating: boolean;
  nlExplanation: string | null;
  nlKind: StatementKind | null;
  error: string | null;
  /** Fixed panel height, including its border. */
  height: number;
  /** Content width (panel inner width) — drives the divider. */
  innerWidth: number;
  /** The pane was clicked — focus the editor. */
  onPaneClick: () => void;
}

const PROMPT = 'SQL> ';

/** Collapse newlines so a value stays on a SINGLE feedback line — otherwise a
 *  multi-line error would overflow the fixed-height pane and push the (pinned)
 *  ask row off the top. */
const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ');

const QueryEditorImpl = ({
  queryText,
  statement,
  focused,
  nlMode,
  onNlSubmit,
  onQueryInput,
  onQuerySubmit,
  completions,
  generating,
  nlExplanation,
  nlKind,
  error,
  height,
  innerWidth,
  onPaneClick,
}: Props) => {
  const borderColor = nlMode
    ? theme.magenta
    : focused
      ? theme.borderFocus
      : theme.border;

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      width="100%"
      height={height}
      border
      borderStyle="rounded"
      borderColor={borderColor}
      paddingX={1}
      onMouseDown={onPaneClick}
    >
      {/* ── ask row (NL→SQL): a native input while asking, else the hint/echo ── */}
      {nlMode ? (
        <box flexDirection="row">
          <text wrapMode="none">
            <b fg={theme.magenta}>✦ ask </b>
          </text>
          <input
            focused
            onSubmit={onNlSubmit as never}
            flexGrow={1}
            textColor={theme.cyan}
            cursorStyle={INPUT_CURSOR}
            cursorColor={theme.accent}
          />
        </box>
      ) : (
        <text wrapMode="none" selectable>
          <b fg={theme.magenta}>✦ ask </b>
          {nlExplanation ? (
            <span fg={theme.magenta}>
              {oneLine(nlExplanation)}
              {nlKind && isDestructive(nlKind) ? (
                <b fg={theme.red}>
                  {'  '}⚠ {nlKind.toUpperCase()}
                </b>
              ) : null}
            </span>
          ) : (
            <span fg={theme.border}>press ^G to ask in natural language</span>
          )}
        </text>
      )}

      {/* ── divider ── */}
      <text fg={theme.border} wrapMode="none">
        {'─'.repeat(Math.max(0, innerWidth))}
      </text>

      {/* ── SQL editor: a native input bound to the committed query text; while
          empty it shows the browse statement as a dim placeholder ── */}
      <box flexDirection="row">
        <text wrapMode="none">
          <b fg={theme.magenta}>{PROMPT}</b>
        </text>
        <input
          value={queryText}
          onInput={onQueryInput}
          onSubmit={onQuerySubmit as never}
          focused={focused && !nlMode}
          placeholder={statement ?? ''}
          placeholderColor={theme.muted}
          textColor={theme.cyan}
          cursorStyle={INPUT_CURSOR}
          cursorColor={theme.accent}
          flexGrow={1}
        />
      </box>

      {/* ── feedback: completions / generating / error / hint ── */}
      {error ? (
        <text fg={theme.red} wrapMode="none">
          error: {oneLine(error)}
        </text>
      ) : generating ? (
        <text fg={theme.magenta}>✦ Generating SQL…</text>
      ) : focused && !nlMode && completions.length > 0 ? (
        <text wrapMode="none">
          <span fg={theme.border}>⇥ </span>
          <b fg={theme.cyan}>{completions[0]}</b>
          <span fg={theme.border}>
            {completions.slice(1).map((c) => ` · ${c}`).join('')}
          </span>
        </text>
      ) : (
        <text fg={theme.border} wrapMode="none">
          {nlMode
            ? '⏎ generate SQL (review before running) · esc cancel'
            : focused
              ? '⏎ run · ^G ask AI · ↑/↓ history · ^C clear · esc grid'
              : ': focus editor · ⏎ run'}
        </text>
      )}
    </box>
  );
};

export const QueryEditor = React.memo(QueryEditorImpl);
