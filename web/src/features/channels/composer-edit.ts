export type ComposerEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export function wrapComposerSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder: string,
): ComposerEdit {
  const selected = value.slice(start, end) || placeholder;
  const replacement = `${before}${selected}${after}`;
  const selectionStart = start + before.length;
  return {
    value: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    selectionStart,
    selectionEnd: selectionStart + selected.length,
  };
}
