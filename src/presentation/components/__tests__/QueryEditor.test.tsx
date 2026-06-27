/**
 * The editor renders its prompt and binds the query text to the native SQL input.
 * Renders the real component through the OpenTUI test renderer and asserts the
 * prompt plus the bound query value are visible.
 */

import React from 'react';
import { test, expect } from 'bun:test';
import { renderTest } from '../../testing/renderTest.ts';
import { QueryEditor } from '../QueryEditor.tsx';

const SQL = "SELECT count(*) FROM documents WHERE name = 'x';";

test('renders the prompt and the bound query text in the SQL input', async () => {
  const h = await renderTest(
    <QueryEditor
      queryText={SQL}
      browsePreview={null}
      focused
      completions={[]}
      nlMode={false}
      onNlSubmit={() => {}}
      onQueryInput={() => {}}
      onQuerySubmit={() => {}}
      generating={false}
      nlExplanation={null}
      nlKind={null}
      error={null}
      height={8}
      innerWidth={80}
      onPaneClick={() => {}}
    />,
    { width: 90, height: 10 },
  );
  await h.flush();
  await h.flush();
  const frame = h.frame();
  expect(frame).toContain('SQL>');
  expect(frame).toContain('count(*)');
  expect(frame).toContain('FROM documents');
  h.cleanup();
});
