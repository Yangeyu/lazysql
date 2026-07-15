/**
 * QueryEditor — the SQL editor pane (top-right of the workbench). Two gears
 * (ADR 0013): collapsed (default) it is a one-line ECHO BAR — a read-only
 * readout of the statement behind the grid, not focusable, so the grid keeps
 * the screen; expanded (`:` / ^O / click) it is the full editing pane below.
 *
 * Expanded: ONE bordered panel whose `✦ ask` row, divider and feedback line are
 * PINNED while the SQL editor between them is a multi-line <textarea> that
 * soft-wraps and scrolls within the fixed panel height (ADR 0010):
 *
 *   ╭─────────────────────────────────╮
 *   │ ✦ ask   how many active users?  │   ← NL→SQL input (active on ^G) · pinned
 *   │ SQL> ─────────────────────────── │   ← labeled divider · pinned
 *   │ SELECT count(*)                 │   ┐ SQL <textarea>: the only scroll region
 *   │ FROM users WHERE active         │   ┘ (soft-wrap + vertical scroll)
 *   │ ⇥ users · user_id …             │   ← completions / explanation / error · pinned
 *   ╰─────────────────────────────────╯
 *
 * The <textarea> owns its buffer + cursor (the terminal's, no hand-rolled glyph).
 * The store holds only a MIRROR of the text + caret (`queryText`/`editorCaret`):
 * the widget reports edits via onContentChange/onCursorChange (→ onEditorChange),
 * and programmatic writes (history, NL fill, run-clear) flow the other way — the
 * reconcile effect pushes them into the widget only when the two diverge, so user
 * typing never causes a cursor jump. Enter runs the query (onSubmit); Shift+Enter
 * inserts a newline. Running a query sends its result to the shared grid — the
 * editor never renders results itself (SRP).
 */

import React, { useEffect, useRef } from 'react';
import type { TextareaOptions, TextareaRenderable } from '@opentui/core';
import {
  isDestructive,
  type StatementKind,
} from '../../domain/query/classify.ts';
import { theme, INPUT_CURSOR } from '../theme/theme.ts';

/** Enter runs the query, Shift+Enter inserts a newline — overriding OpenTUI's
 *  textarea defaults (Enter=newline, ⌥Enter=submit) so the editor keeps its
 *  REPL-style "⏎ runs" contract while still composing multi-line SQL. The default
 *  ⌥Enter→submit survives the merge as a harmless second run key. See ADR 0010. */
const SQL_KEYBINDINGS: NonNullable<TextareaOptions['keyBindings']> = [
  { name: 'return', action: 'submit' },
  { name: 'kpenter', action: 'submit' },
  { name: 'return', shift: true, action: 'newline' },
  { name: 'kpenter', shift: true, action: 'newline' },
];

interface Props {
  /** Expanded = the full editing pane; collapsed = the one-line echo bar. */
  expanded: boolean;
  /** The store's mirror of the editor text (the <textarea> owns the real buffer). */
  queryText: string;
  /** The store's mirror of the caret offset — used to reconcile the widget on a
   *  programmatic write so the cursor lands where the action intends. */
  editorCaret: number;
  /** Read-only echo of the statement behind the current grid (browse SQL or the
   *  executed query), shown as the input's dim placeholder while it is empty so
   *  the panel always reflects how the result was produced. */
  statement: string | null;
  /** Editor pane focused; the SQL textarea is active when not in `nlMode`. */
  focused: boolean;
  /** The ask row is active (capturing the NL prompt). */
  nlMode: boolean;
  /** Whether schema completion is on — gates whether completions are advertised. */
  completionsOn: boolean;
  /** The NL prompt was submitted (Enter) — generate SQL from it. */
  onNlSubmit: (prompt: string) => void;
  /** The SQL textarea changed (edit or cursor move) — mirror text + caret to the
   *  store (which re-derives completions). */
  onEditorChange: (text: string, caret: number) => void;
  /** The SQL textarea was submitted (Enter) — run the query. */
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

/** Collapse newlines so a value stays on a SINGLE feedback line — otherwise a
 *  multi-line error would overflow the fixed-height pane and push the (pinned)
 *  ask row off the top. */
const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ');

const QueryEditorImpl = ({
  expanded,
  queryText,
  editorCaret,
  statement,
  focused,
  nlMode,
  completionsOn,
  onNlSubmit,
  onEditorChange,
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
  const ref = useRef<TextareaRenderable | null>(null);

  // Reconcile the widget-owned buffer with the store mirror ONLY on divergence —
  // i.e. a programmatic write (history recall, NL fill, run-clear, completion).
  // User typing already mirrored text+caret into the store via onEditorChange, so
  // both match here and this is a no-op (no cursor jump). See ADR 0010 §2.
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    if (ta.plainText !== queryText) ta.setText(queryText);
    if (ta.cursorOffset !== editorCaret) ta.cursorOffset = editorCaret;
  }, [queryText, editorCaret]);

  const sync = (): void => {
    const ta = ref.current;
    if (ta) onEditorChange(ta.plainText, ta.cursorOffset);
  };

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
      {/* ── collapsed: the echo bar. The editing rows below stay MOUNTED but
          display:none (`visible`) — a remounting textarea boots a fresh cursor
          and echoes it into the mirror, losing the draft's caret (ADR 0013). ── */}
      {!expanded ? (
        <text wrapMode="none" selectable flexShrink={0}>
          <b fg={theme.magenta}>{'SQL> '}</b>
          {statement ? (
            <span fg={theme.muted}>{oneLine(statement)}</span>
          ) : (
            <span fg={theme.border}>: compose SQL · ^O expand</span>
          )}
          {queryText.trim() ? <span fg={theme.yellow}>{'  (draft)'}</span> : null}
        </text>
      ) : null}

      {/* ── ask row (NL→SQL): a native input while asking, else the hint/echo ── */}
      {!expanded ? null : nlMode ? (
        <box flexDirection="row" flexShrink={0}>
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
        <text wrapMode="none" selectable flexShrink={0}>
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

      {/* ── divider, doubling as the SQL editor label (a header, not a per-line
          gutter — the textarea below is full-width) ── */}
      {expanded ? (
        <text wrapMode="none" flexShrink={0}>
          <b fg={theme.magenta}>{'SQL> '}</b>
          <span fg={theme.border}>{'─'.repeat(Math.max(0, innerWidth - 5))}</span>
        </text>
      ) : null}

      {/* ── SQL editor: a multi-line textarea bound to the committed query text;
          the ONLY scroll region — soft-wraps + scrolls within the fixed panel
          while the ask row above stays pinned. Empty → browse statement as a dim
          placeholder. ── */}
      <textarea
        ref={ref}
        visible={expanded}
        initialValue={queryText}
        focused={expanded && focused && !nlMode}
        keyBindings={SQL_KEYBINDINGS}
        wrapMode="word"
        onContentChange={sync}
        onCursorChange={sync}
        onSubmit={onQuerySubmit}
        placeholder={statement ?? ''}
        placeholderColor={theme.muted}
        textColor={theme.cyan}
        cursorStyle={INPUT_CURSOR}
        cursorColor={theme.accent}
        flexGrow={1}
      />

      {/* ── feedback: completions / generating / error / hint ── */}
      {!expanded ? null : error ? (
        <text fg={theme.red} wrapMode="none" flexShrink={0}>
          error: {oneLine(error)}
        </text>
      ) : generating ? (
        <text fg={theme.magenta} flexShrink={0}>
          ✦ Generating SQL…
        </text>
      ) : focused && !nlMode && completionsOn && completions.length > 0 ? (
        <text wrapMode="none" flexShrink={0}>
          <span fg={theme.border}>⇥ </span>
          <b fg={theme.cyan}>{completions[0]}</b>
          <span fg={theme.border}>
            {completions.slice(1).map((c) => ` · ${c}`).join('')}
          </span>
        </text>
      ) : (
        <text fg={theme.border} wrapMode="none" flexShrink={0}>
          {nlMode
            ? '⏎ generate SQL (review before running) · esc cancel'
            : focused
              ? `⏎ run · ⇧⏎ newline · ^P/^N hist · ^T compl:${completionsOn ? 'on' : 'off'} · ^G ask · ^O hide · esc grid`
              : ': focus editor · ⏎ run · ^O hide'}
        </text>
      )}
    </box>
  );
};

export const QueryEditor = React.memo(QueryEditorImpl);
