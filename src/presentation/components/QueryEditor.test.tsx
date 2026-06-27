/**
 * Regression test for the editor input layout: a long SQL string must render
 * across the available width (wrapping at word boundaries), NOT collapse to one
 * token per line. Renders the real component through the OpenTUI test renderer at
 * a normal width and asserts contiguous phrases survive on a single line.
 */

import React from 'react';
import { test, expect } from 'bun:test';
import { renderTest } from '../testing/renderTest.ts';
import { QueryEditor } from './QueryEditor.tsx';

const SQL = "SELECT count(*) FROM documents WHERE source_name = '东方财富';";

test('renders the prompt and SQL without collapsing to one token per line', async () => {
  const h = await renderTest(
    <QueryEditor
      queryText={SQL}
      browsePreview={null}
      focused
      completions={[]}
      nlMode={false}
      nlDraft=""
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
  const frame = h.frame();
  expect(frame).toContain('SQL>');
  // If the input width collapsed, "FROM documents" would be split across lines.
  expect(frame).toContain('FROM documents');
  expect(frame).toContain('count(*)');
  h.cleanup();
});
