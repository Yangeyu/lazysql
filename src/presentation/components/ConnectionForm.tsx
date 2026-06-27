/**
 * ConnectionForm — the `n` new-connection modal. A driver selector plus the
 * driver-appropriate fields; navigation and editing live in the store (mode
 * 'connform'), so this only renders the current draft. Submitting persists the
 * profile (and password, kept out of the YAML) via the Workbench.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
import type { ConnForm } from '../app/store.ts';
import { theme, CARET } from '../theme/theme.ts';

const LABEL_COL = 12;

const ConnectionFormImpl = ({ form }: { form: ConnForm }) => {
  const editing = form.editingId !== null;
  return (
    <box flexDirection="column" flexGrow={1} alignItems="center">
      <box
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
        width={54}
      >
        <text attributes={TextAttributes.BOLD} fg="cyan">
          {editing ? 'Edit connection' : 'New connection'}
        </text>
        <text> </text>
        <text>
          <span fg={theme.muted}>{'Driver'.padEnd(LABEL_COL)}</span>
          <span fg="yellow">◂ {form.driver} ▸</span>
        </text>
        {form.fields.map((f, i) => {
          const selected = i === form.index;
          const shown = f.secret ? '•'.repeat(f.value.length) : f.value;
          // When editing, an empty password keeps the stored one — say so.
          const placeholder =
            f.secret && editing && f.value.length === 0 ? '(unchanged)' : '';
          return (
            <text key={f.key} wrapMode="none">
              <span fg={theme.muted}>{f.label.padEnd(LABEL_COL)}</span>
              <span
                attributes={selected ? TextAttributes.INVERSE : undefined}
                fg={selected ? 'cyan' : undefined}
              >
                {shown || ' '}
              </span>
              {placeholder ? <span fg={theme.muted}> {placeholder}</span> : null}
              {selected ? <span fg={theme.accent}>{CARET}</span> : null}
            </text>
          );
        })}
        {form.error ? <text fg="red">{form.error}</text> : null}
        <text> </text>
        <text fg={theme.muted}>↑/↓ field · ←/→ driver · ⏎ save · esc cancel</text>
      </box>
    </box>
  );
};

export const ConnectionForm = React.memo(ConnectionFormImpl);
