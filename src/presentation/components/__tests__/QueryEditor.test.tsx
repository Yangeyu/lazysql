/**
 * The editor binds the query text to the native SQL <textarea>. Renders the real
 * component through the OpenTUI test renderer and asserts the bound query value
 * (seeded via the textarea's initialValue) is visible.
 */

import { test, expect } from 'bun:test';
import { renderTest } from '../../testing/renderTest.ts';
import { QueryEditor } from '../QueryEditor.tsx';

const SQL = "SELECT count(*) FROM documents WHERE name = 'x';";

test('renders the bound query text in the SQL editor', async () => {
  const h = await renderTest(
    <QueryEditor
      queryText={SQL}
      editorCaret={SQL.length}
      statement={null}
      focused
      completions={[]}
      completionsOn
      nlMode={false}
      onNlSubmit={() => {}}
      onEditorChange={() => {}}
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
  expect(frame).toContain('count(*)');
  expect(frame).toContain('FROM documents');
  h.cleanup();
});
