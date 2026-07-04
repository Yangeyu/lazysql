/**
 * ConnectionForm — the `n`/`e` connection dialog. Floats OVER the workbench via
 * Overlay like every other dialog (confirm, help, cell inspector), with the
 * same badge-chip header. A URL row on top expands a pasted connection URL into
 * the fields below on ⏎; then a driver selector over the driver-appropriate
 * fields and a [Test] [Save] [Cancel] button row. Navigation lives in the store
 * (mode 'connform').
 *
 * Every editable field is a native <input> (real cursor, mid-string editing)
 * EXCEPT the password: OpenTUI's input can't mask, so the one secret field is
 * store-rendered as bullets with a ^R reveal. Inputs get an EXPLICIT width —
 * flexGrow would let a long value's intrinsic width overlap the label. The
 * Driver is its own focusable row so ←/→ can cycle it without stealing the
 * in-field cursor movement; the button row reuses that convention (↑/↓ reaches
 * it, ←/→ cycles, ⏎ presses). Rows and buttons respond to the mouse.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
import { DRIVER_ROW, type ConnForm, type ConnFormField } from '../app/store.ts';
import { theme, INPUT_CURSOR, driverColor } from '../theme/theme.ts';
import { dialectLabel, shortTag } from '../tree/tree.ts';
import { Caret } from './Caret.tsx';
import { Overlay } from './Overlay.tsx';

const LABEL_COL = 10;

/** Display order must match FORM_BUTTONS in connFormSlice.ts. */
const BUTTONS = [
  { label: 'Test', keys: '^T' },
  { label: 'Save', keys: '⏎' },
  { label: 'Cancel', keys: 'esc' },
] as const;

interface Props {
  readonly form: ConnForm;
  readonly termRows: number;
  readonly termCols: number;
  /** Push a non-secret field edit back to the store (inputs are controlled). */
  readonly onFieldInput: (key: string, value: string) => void;
  /** Focus a row on click (DRIVER_ROW, a field index, or the button row). */
  readonly onFocusRow: (index: number) => void;
  /** Press an action button on click (an index into BUTTONS/FORM_BUTTONS). */
  readonly onButton: (index: number) => void;
}

const clip = (s: string, w: number): string =>
  s.length > w ? s.slice(0, Math.max(0, w - 1)) + '…' : s;

/** The masked password field: bullets (or the clear value under ^R), with the
 *  shared caret. The one field that can't be a native <input> (no mask there). */
const SecretField = ({
  field,
  focused,
  reveal,
  editing,
  width,
}: {
  field: ConnFormField;
  focused: boolean;
  reveal: boolean;
  editing: boolean;
  width: number;
}) => {
  const shown = clip(reveal ? field.value : '•'.repeat(field.value.length), width - 1);
  // Editing with a blank password keeps the stored secret — say so.
  const unchanged = field.value.length === 0 && editing ? '(unchanged)' : '';
  return (
    <text wrapMode="none" width={width}>
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

const ConnectionFormImpl = ({
  form,
  termRows,
  termCols,
  onFieldInput,
  onFocusRow,
  onButton,
}: Props) => {
  const editing = form.editingId !== null;
  const driverFocused = form.index === DRIVER_ROW;
  const buttonRowIdx = form.fields.length;
  const onButtons = form.index === buttonRowIdx;
  const driverName = dialectLabel(form.driver);
  const arrow = driverFocused ? theme.accent : theme.border;

  const width = Math.max(44, Math.min(termCols - 8, 76));
  const innerW = width - 4; // border (2) + paddingX (2)
  const feedback = form.error !== null || form.probe !== null;
  // header + blank + driver + blank + fields + (blank + feedback) + blank +
  // buttons, inside the border (+2).
  const height = 6 + form.fields.length + (feedback ? 2 : 0) + 2;

  // Explicit value width: the marker+label column and the right-hand hint are
  // reserved so a long value can never paint over its neighbors.
  const valueWidth = (f: ConnFormField): number =>
    innerW - 2 - LABEL_COL - (f.hint ? f.hint.length + 3 : 0);

  return (
    <Overlay termRows={termRows} termCols={termCols} width={width} height={height}>
      <text wrapMode="none">
        <span bg={theme.accent} fg={theme.onAccent} attributes={TextAttributes.BOLD}>
          {' connection '}
        </span>
        <b>{editing ? ' Edit connection' : ' New connection'}</b>
      </text>
      <text> </text>

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
        const w = valueWidth(f);
        return (
          <box key={f.key} flexDirection="row" onMouseDown={() => onFocusRow(i)}>
            <Label text={f.label} focused={focused} />
            {f.secret ? (
              <SecretField
                field={f}
                focused={focused}
                reveal={form.reveal}
                editing={editing}
                width={w}
              />
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
                width={w}
              />
            ) : (
              <text wrapMode="none" width={w} fg={theme.cyan}>
                {clip(f.value, w)}
              </text>
            )}
            {f.hint ? (
              <text wrapMode="none" fg={theme.muted}>
                {` (${f.hint})`}
              </text>
            ) : null}
          </box>
        );
      })}

      {feedback ? <text> </text> : null}
      {form.error ? (
        <text fg={theme.red} wrapMode="none">
          ⚠ {clip(form.error, innerW - 2)}
        </text>
      ) : form.probe ? (
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
          {clip(form.probe.message, innerW - 2)}
        </text>
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
    </Overlay>
  );
};

export const ConnectionForm = React.memo(ConnectionFormImpl);
