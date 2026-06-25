/**
 * Regression test for the editor input layout: a long generated SQL string must
 * render across the available width (wrapping at word boundaries), NOT collapse
 * to one token per line. Renders the real component through ink-testing-library
 * at a normal width and asserts contiguous phrases survive on a single line.
 */

import React from 'react';
import { test, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { QueryEditor } from './QueryEditor.tsx';

const SQL = "SELECT count(*) FROM documents WHERE source_name = '东方财富';";

const renderEditor = () =>
  render(
    <QueryEditor
      queryText={SQL}
      editorFocused
      resultFocused={false}
      result={null}
      error={null}
      elapsedMs={null}
      gridRow={0}
      completions={[]}
      loading={false}
      nlMode={false}
      nlDraft=""
      generating={false}
      nlExplanation={null}
      nlKind={null}
      viewportRows={8}
      viewportCols={80}
    />,
  );

test('renders the prompt and SQL without collapsing to one token per line', () => {
  const { lastFrame, unmount } = renderEditor();
  const frame = lastFrame() ?? '';
  expect(frame).toContain('SQL>');
  // If the input width collapsed, "FROM documents" would be split across lines.
  expect(frame).toContain('FROM documents');
  expect(frame).toContain('count(*)');
  unmount();
});
