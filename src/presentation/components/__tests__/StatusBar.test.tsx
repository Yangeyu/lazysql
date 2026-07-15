import { expect, test } from 'bun:test';
import { appError } from '../../app/appError.ts';
import { renderTest } from '../../testing/renderTest.ts';
import { StatusBar } from '../StatusBar.tsx';

test('a long error is truncated before the reserved key-hint region', async () => {
  const width = 80;
  const h = await renderTest(
    <StatusBar
      width={width}
      status="error"
      error={appError(
        'cannot delete: row is still referenced by insight_card_evidence_cards — tail must not paint',
      )}
      notice={null}
      context="grid"
      flags={{ queryable: true, nlAvailable: false, errorAvailable: true }}
      mode="normal"
      markCount={0}
      filterInitial=""
      filterColumn={null}
      onFilterSubmit={() => {}}
    />,
    { width, height: 1 },
  );

  await h.flush();
  const line = h.frame().split('\n')[0] ?? '';
  expect(line).toContain(' error ');
  expect(line).toContain('…');
  expect(line).toContain('! details');
  expect(line).not.toContain('tail must not paint');
  h.cleanup();
});

test('filter mode keeps a usable input and its primary action at 60 columns', async () => {
  const width = 60;
  const h = await renderTest(
    <StatusBar
      width={width}
      status="ready"
      error={null}
      notice={null}
      context="filter"
      flags={{ queryable: true, nlAvailable: false, errorAvailable: false }}
      mode="filter"
      markCount={0}
      filterInitial="abcdefghijkl"
      filterColumn="updated_at"
      onFilterSubmit={() => {}}
    />,
    { width, height: 1 },
  );

  await h.flush();
  const line = h.frame().split('\n')[0] ?? '';
  expect(line).toContain('updated_at contains');
  expect(line).toContain('abcdefghijkl');
  expect(line).toContain('⏎ apply');
  h.cleanup();
});
