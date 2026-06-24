/**
 * ConnectionPicker — the startup/switch screen listing saved connections.
 * Presentational only; selection and input live in Root.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ConnectionProfile } from '../../domain/connection/ConnectionProfile.ts';

interface Props {
  profiles: ConnectionProfile[];
  index: number;
  connecting: boolean;
  error: string | null;
}

const ConnectionPickerImpl: React.FC<Props> = ({
  profiles,
  index,
  connecting,
  error,
}) => (
  <Box flexDirection="column">
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      width={48}
    >
      <Text bold color="cyan">
        lazysql — connections
      </Text>
      {profiles.length === 0 ? (
        <Text dimColor>
          No connections. Edit ~/.config/lazysql/connections.yml
        </Text>
      ) : (
        profiles.map((p, i) => (
          <Text key={p.id} inverse={i === index} wrap="truncate">
            {i === index ? '▸ ' : '  '}
            {p.name}
            <Text dimColor> ({p.driver})</Text>
          </Text>
        ))
      )}
    </Box>
    {connecting ? (
      <Text color="yellow">Connecting…</Text>
    ) : error ? (
      <Text color="red">error: {error}</Text>
    ) : (
      <Text dimColor>↑/↓ select · ⏎ connect · q quit</Text>
    )}
  </Box>
);

export const ConnectionPicker = React.memo(ConnectionPickerImpl);
