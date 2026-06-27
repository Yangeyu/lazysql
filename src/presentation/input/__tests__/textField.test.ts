import { test, expect } from 'bun:test';
import {
  field,
  insert,
  backspace,
  del,
  left,
  right,
  home,
  end,
  setValue,
  deleteWordBack,
} from '../textField.ts';

test('field clamps the cursor into range', () => {
  expect(field('abc').cursor).toBe(3); // default: end
  expect(field('abc', 99).cursor).toBe(3);
  expect(field('abc', -5).cursor).toBe(0);
});

test('insert places text at the cursor and steps past it', () => {
  const tf = insert(field('ac', 1), 'b');
  expect(tf.value).toBe('abc');
  expect(tf.cursor).toBe(2);
});

test('backspace and del act on either side of the cursor', () => {
  expect(backspace(field('abc', 2))).toMatchObject({ value: 'ac', cursor: 1 });
  expect(del(field('abc', 1))).toMatchObject({ value: 'ac', cursor: 1 });
  expect(backspace(field('abc', 0))).toMatchObject({ value: 'abc', cursor: 0 }); // no-op
  expect(del(field('abc', 3))).toMatchObject({ value: 'abc', cursor: 3 }); // no-op
});

test('cursor movement stays in range', () => {
  expect(left(field('abc', 0)).cursor).toBe(0);
  expect(right(field('abc', 3)).cursor).toBe(3);
  expect(left(field('abc', 2)).cursor).toBe(1);
  expect(right(field('abc', 1)).cursor).toBe(2);
  expect(home(field('abc', 2)).cursor).toBe(0);
  expect(end(field('abc', 0)).cursor).toBe(3);
});

test('setValue replaces the text and jumps to the end', () => {
  expect(setValue(field('old', 1), 'newer')).toMatchObject({ value: 'newer', cursor: 5 });
});

test('deleteWordBack removes trailing space then the word', () => {
  expect(deleteWordBack(field('select from ', 12))).toMatchObject({ value: 'select ', cursor: 7 });
  expect(deleteWordBack(field('one two', 7))).toMatchObject({ value: 'one ', cursor: 4 });
  expect(deleteWordBack(field('abc', 0))).toMatchObject({ value: 'abc', cursor: 0 }); // no-op
});

test('edits in the middle keep the tail intact', () => {
  // type X between 'a' and 'bc'
  const tf = insert(field('abc', 1), 'X');
  expect(tf.value).toBe('aXbc');
  expect(tf.cursor).toBe(2);
  // backspace there removes the X, not the tail
  expect(backspace(tf).value).toBe('abc');
});
