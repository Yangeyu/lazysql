/**
 * ConnectionForm — the `n`/`e` connection modal. A driver selector over the
 * driver-appropriate fields, with an action-button row ([Test] [Save] [Cancel])
 * at the bottom; navigation lives in the store (mode 'connform').
 *
 * Every editable field is a native <input> (real cursor, mid-string editing,
 * the same accent caret as the rest of the app) EXCEPT the password: OpenTUI's
 * input can't mask, so the one secret field is store-rendered as bullets with a
 * ^R reveal. The Driver is its own focusable row so ←/→ can cycle it without
 * stealing the in-field cursor movement the native inputs need; the button row
 * reuses the same convention (↑/↓ reaches it, ←/→ cycles, ⏎ presses). Rows and
 * buttons also respond to the mouse, like every other pane.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
import { DRIVER_ROW, type ConnForm, type ConnFormField } from '../app/store.ts';
import { theme, INPUT_CURSOR, driverColor } from '../theme/theme.ts';
import { dialectLabel, shortTag } from '../tree/tree.ts';
import { Caret } from './Caret.tsx';

const LABEL_COL = 10;

/** Display order must match FORM_BUTTONS in connFormSlice.ts. */
const BUTTONS = [
  { label: 'Test', keys: '^T' },
  { label: 'Save', keys: '⏎' },
  { label: 'Cancel', keys: 'esc' },
] as const;

interface Props {
  readonly form: ConnForm;
  /** Push a non-secret field edit back to the store (inputs are controlled). */
  readonly onFieldInput: (key: string, value: string) => void;
  /** Focus a row on click (DRIVER_ROW, a field index, or the button row). */
  readonly onFocusRow: (index: number) => void;
  /** Press an action button on click (an index into BUTTONS/FORM_BUTTONS). */
  readonly onButton: (index: number) => void;
}

/** The masked password field: bullets (or the clear value under ^R), with the
 *  shared caret. The one field that can't be a native <input> (no mask there). */
const SecretField = ({
  field,
  focused,
  reveal,
  editing,
}: {
  field: ConnFormField;
  focused: boolean;
  reveal: boolean;
  editing: boolean;
}) => {
  const shown = reveal ? field.value : '•'.repeat(field.value.length);
  // Editing with a blank password keeps the stored secret — say so.
  const unchanged = field.value.length === 0 && editing ? '(unchanged)' : '';
  return (
    <text wrapMode="none" flexGrow={1}>
      <span fg={theme.cyan}>{shown}</span>
      <Caret focused={focused} />
      {unchanged ? <span fg={theme.muted}> {unchanged}</span> : null}
    </text>
  );
};

/** Label cell: a focus marker plus the padded label, accent when its row holds
 *  the focus so the active row reads at a glance. */
const Label = ({ text: label, focused }: { text: string; focused: boolean }) => (
  <text fg={focused ? theme.accent : theme.muted} wrapMode="none">
    {(focused ? '› ' : '  ') + label.padEnd(LABEL_COL)}
  </text>
);

const ConnectionFormImpl = ({ form, onFieldInput, onFocusRow, onButton }: Props) => {
  const editing = form.editingId !== null;
  const driverFocused = form.index === DRIVER_ROW;
  const buttonRow = form.fields.length;
  const onButtons = form.index === buttonRow;
  const driverName = dialectLabel(form.driver);
  const arrow = driverFocused ? theme.accent : theme.border;
  return (
    <box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
      <box
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={theme.borderFocus}
        title={editing ? ' Edit connection ' : ' New connection '}
        paddingX={3}
        paddingY={1}
        width={56}
      >
        {/* Driver — a focusable row; ←/→ cycles it while it holds the focus. */}
        <box flexDirection="row" onMouseDown={() => onFocusRow(DRIVER_ROW)}>
          <Label text="Driver" focused={driverFocused} />
          <text wrapMode="none">
            <span fg={arrow}>‹ </span>
            <span fg={driverColor(shortTag(driverName))} attributes={TextAttributes.BOLD}>
              {driverName}
            </span>
            <span fg={arrow}> ›</span>
          </text>
        </box>

        <text> </text>

        {form.fields.map((f, i) => {
          const focused = form.index === i;
          return (
            <box key={f.key} flexDirection="row" onMouseDown={() => onFocusRow(i)}>
              <Label text={f.label} focused={focused} />
              {f.secret ? (
                <SecretField field={f} focused={focused} reveal={form.reveal} editing={editing} />
              ) : focused ? (
                // Only the focused field is a live <input>; mounting one at a time
                // keeps native focus from lingering on a field we've navigated off.
                <input
                  value={f.value}
                  onInput={(v) => onFieldInput(f.key, v)}
                  focused
                  textColor={theme.cyan}
                  cursorStyle={INPUT_CURSOR}
                  cursorColor={theme.accent}
                  flexGrow={1}
                />
              ) : (
                <text wrapMode="none" flexGrow={1} fg={theme.cyan}>
                  {f.value}
                </text>
              )}
              {f.hint ? (
                <text wrapMode="none" fg={theme.muted}>
                  ({f.hint})
                </text>
              ) : null}
            </box>
          );
        })}

        {form.error ? (
          <box flexDirection="column">
            <text> </text>
            <text fg={theme.red} wrapMode="none">
              ⚠ {form.error}
            </text>
          </box>
        ) : form.probe ? (
          <box flexDirection="column">
            <text> </text>
            <text
              wrapMode="none"
              fg={
                form.probe.state === 'ok'
                  ? theme.green
                  : form.probe.state === 'fail'
                    ? theme.red
                    : theme.muted
              }
            >
              {form.probe.state === 'ok' ? '✓ ' : form.probe.state === 'fail' ? '✗ ' : '⏳ '}
              {form.probe.message}
            </text>
          </box>
        ) : null}

        <text> </text>
        <box flexDirection="row" justifyContent="center" gap={3}>
          {BUTTONS.map((b, i) => {
            const focused = onButtons && form.button === i;
            return (
              <text
                key={b.label}
                wrapMode="none"
                fg={focused ? theme.accent : theme.muted}
                attributes={focused ? TextAttributes.BOLD : undefined}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  onButton(i);
                }}
              >
                [ {b.label} {b.keys} ]
              </text>
            );
          })}
        </box>
        <text> </text>
        <box flexDirection="row" justifyContent="center">
          <text wrapMode="none" fg={theme.border}>
            paste a connection URL into any field to fill
          </text>
        </box>
      </box>
    </box>
  );
};

export const ConnectionForm = React.memo(ConnectionFormImpl);
