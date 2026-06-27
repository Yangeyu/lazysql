/**
 * TextField — the editable-text model: a value plus a cursor index into it. This
 * is the single definition of "how editable text behaves", framework-free and
 * pure, so every input in the app (the SQL editor, the filter / edit prompts, the
 * NL ask row) shares one set of semantics and gets mid-string editing for free
 * instead of each re-implementing append-and-backspace on a bare string.
 *
 * Every operation returns a NEW TextField (the store keeps them as state) and
 * keeps `cursor` clamped to `[0, value.length]`, so callers never have to guard.
 */

export interface TextField {
  readonly value: string;
  readonly cursor: number;
}

/** Build a field, cursor at the end by default, always clamped in range. */
export const field = (value = '', cursor = value.length): TextField => ({
  value,
  cursor: Math.max(0, Math.min(cursor, value.length)),
});

/** The shared empty field — every draft resets to this. */
export const EMPTY: TextField = field('');

/** Replace the whole value (cursor jumps to the end) — for history, completion,
 *  generated SQL, pre-filled edits: anything that sets text wholesale. */
export const setValue = (_tf: TextField, value: string): TextField => field(value);

/** Insert text at the cursor and step past it. */
export const insert = (tf: TextField, text: string): TextField =>
  field(tf.value.slice(0, tf.cursor) + text + tf.value.slice(tf.cursor), tf.cursor + text.length);

/** Delete the character before the cursor (no-op at the start). */
export const backspace = (tf: TextField): TextField =>
  tf.cursor === 0
    ? tf
    : field(tf.value.slice(0, tf.cursor - 1) + tf.value.slice(tf.cursor), tf.cursor - 1);

/** Delete the character under the cursor (no-op at the end). */
export const del = (tf: TextField): TextField =>
  tf.cursor >= tf.value.length
    ? tf
    : field(tf.value.slice(0, tf.cursor) + tf.value.slice(tf.cursor + 1), tf.cursor);

export const left = (tf: TextField): TextField =>
  tf.cursor === 0 ? tf : field(tf.value, tf.cursor - 1);

export const right = (tf: TextField): TextField =>
  tf.cursor >= tf.value.length ? tf : field(tf.value, tf.cursor + 1);

export const home = (tf: TextField): TextField => field(tf.value, 0);

export const end = (tf: TextField): TextField => field(tf.value, tf.value.length);

/** Delete back over any whitespace, then the word before the cursor (⌃W). */
export const deleteWordBack = (tf: TextField): TextField => {
  let i = tf.cursor;
  while (i > 0 && /\s/.test(tf.value[i - 1] ?? '')) i--;
  while (i > 0 && !/\s/.test(tf.value[i - 1] ?? '')) i--;
  return i === tf.cursor ? tf : field(tf.value.slice(0, i) + tf.value.slice(tf.cursor), i);
};
