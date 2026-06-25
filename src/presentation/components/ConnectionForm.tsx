/**
 * ConnectionForm — the `n` new-connection modal. A driver selector plus the
 * driver-appropriate fields; navigation and editing live in the store (mode
 * 'connform'), so this only renders the current draft. Submitting persists the
 * profile (and password, kept out of the YAML) via the Workbench.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ConnForm } from '../app/store.ts';

const LABEL_COL = 12;

const ConnectionFormImpl: React.FC<{ form: ConnForm }> = ({ form }) => (
  <Box flexDirection="column" flexGrow={1} alignItems="center">
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      width={54}
    >
      <Text bold color="cyan">
        New connection
      </Text>
      <Text> </Text>
      <Text>
        <Text dimColor>{'Driver'.padEnd(LABEL_COL)}</Text>
        <Text color="yellow">◂ {form.driver} ▸</Text>
      </Text>
      {form.fields.map((f, i) => {
        const selected = i === form.index;
        const shown = f.secret ? '•'.repeat(f.value.length) : f.value;
        return (
          <Text key={f.key} wrap="truncate">
            <Text dimColor>{f.label.padEnd(LABEL_COL)}</Text>
            <Text inverse={selected} color={selected ? 'cyan' : undefined}>
              {shown || ' '}
            </Text>
            {selected ? <Text>▌</Text> : null}
          </Text>
        );
      })}
      {form.error ? <Text color="red">{form.error}</Text> : null}
      <Text> </Text>
      <Text dimColor>↑/↓ field · ←/→ driver · ⏎ save · esc cancel</Text>
    </Box>
  </Box>
);

export const ConnectionForm = React.memo(ConnectionFormImpl);
