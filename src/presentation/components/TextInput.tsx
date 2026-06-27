/**
 * TextInput — the single-line editable-text view. Renders a TextField by
 * splitting its value at the cursor and dropping the shared <Caret> between the
 * two halves, so the caret sits exactly where editing happens (mid-string, not
 * only at the end) with no coordinate maths. Returns an inline span fragment so
 * it composes inside any parent <text> run — the filter and edit prompts in the
 * status bar, the NL ask row in the editor. (The multi-line SQL body wraps over
 * the same TextField via wrapWithCursor; this primitive is for the one-liners.)
 */

import { Caret } from './Caret.tsx';
import type { TextField } from '../input/textField.ts';

interface Props {
  field: TextField;
  focused: boolean;
  /** Foreground of the text on both sides of the caret. */
  fg?: string;
}

export const TextInput = ({ field, focused, fg }: Props) => {
  const before = field.value.slice(0, field.cursor);
  const after = field.value.slice(field.cursor);
  return (
    <>
      <span fg={fg}>{before}</span>
      <Caret focused={focused} />
      <span fg={fg}>{after}</span>
    </>
  );
};
