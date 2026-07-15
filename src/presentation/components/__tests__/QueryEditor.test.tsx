/**
 * The editor binds the query text to the native SQL <textarea>. Renders the real
 * component through the OpenTUI test renderer and asserts the bound query value
 * (seeded via the textarea's initialValue) is visible.
 */

import { useState } from 'react';
import { test, expect } from 'bun:test';
import type { TextareaRenderable } from '@opentui/core';
import { renderTest } from '../../testing/renderTest.ts';
import { QueryEditor } from '../QueryEditor.tsx';

const SQL = "SELECT count(*) FROM documents WHERE name = 'x';";

test('renders the bound query text in the SQL editor', async () => {
  const h = await renderTest(
    <QueryEditor
      expanded
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

test('a visible-flip (the gear mechanism) preserves the native undo history', async () => {
  // ADR 0013 hides the textarea with `visible` instead of unmounting it exactly
  // so EditBuffer state (undo, selection, scroll) survives the gear flip. This
  // pins that OpenTUI mechanism: were the flip a remount, undo() would find a
  // fresh buffer and return false.
  const taRef: { current: TextareaRenderable | null } = { current: null };
  let setVisible: (v: boolean) => void = () => {};
  const Fixture = () => {
    const [visible, sv] = useState(true);
    setVisible = sv;
    return (
      <box width={40} height={8}>
        <textarea
          ref={(r: TextareaRenderable | null) => { taRef.current = r; }}
          visible={visible}
          focused={visible}
          initialValue=""
        />
      </box>
    );
  };

  const h = await renderTest(<Fixture />, { width: 40, height: 8 });
  await h.type('KEEP GONE');
  await h.until((f) => f.includes('KEEP GONE'));

  setVisible(false);
  await h.flush();
  setVisible(true);
  await h.flush();

  const ta = taRef.current;
  if (!ta) throw new Error('textarea ref was not set');
  expect(ta.plainText).toBe('KEEP GONE'); // buffer survived the flip
  expect(ta.undo()).toBe(true); // and so did its history
  expect(ta.plainText).not.toBe('KEEP GONE');
  h.cleanup();
});

test('collapsed, it echoes the statement behind the grid and flags a kept draft', async () => {
  const h = await renderTest(
    <QueryEditor
      expanded={false}
      queryText="SELECT 1 -- half-written"
      editorCaret={0}
      statement="SELECT * FROM users LIMIT 200"
      focused={false}
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
      height={3}
      innerWidth={80}
      onPaneClick={() => {}}
    />,
    { width: 90, height: 6 },
  );
  await h.flush();
  await h.flush();
  const frame = h.frame();
  expect(frame).toContain('SQL> SELECT * FROM users LIMIT 200');
  expect(frame).toContain('(draft)');
  expect(frame).not.toContain('half-written'); // the draft itself stays hidden
  expect(frame).not.toContain('✦ ask'); // no ask row in the echo bar
  h.cleanup();
});
