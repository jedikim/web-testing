export interface ExtractorElement {
  id: string;
  tag: string;
  type?: string;
  role?: string;
  text?: string;
  visible: boolean;
  disabled?: boolean;
  value?: string;
}

export interface ExtractedCandidate {
  id: string;
  tag: string;
  role?: string;
  label: string;
}

export interface ExtractedState {
  visibleCount: number;
  inputCount: number;
  clickableCount: number;
  filledInputCount: number;
}

function isVisibleEnabled(element: ExtractorElement): boolean {
  return element.visible && !element.disabled;
}

function isInputLike(element: ExtractorElement): boolean {
  if (element.role === 'textbox' || element.role === 'combobox') {
    return true;
  }
  return element.tag === 'input' || element.tag === 'textarea' || element.tag === 'select';
}

function isClickableLike(element: ExtractorElement): boolean {
  if (element.role === 'button' || element.role === 'link') {
    return true;
  }
  return element.tag === 'button' || element.tag === 'a';
}

function labelFor(element: ExtractorElement): string {
  return element.text?.trim() || element.value?.trim() || element.id;
}

export function extractInputs(elements: ExtractorElement[]): ExtractedCandidate[] {
  return elements
    .filter((el) => isVisibleEnabled(el) && isInputLike(el))
    .map((el) => ({
      id: el.id,
      tag: el.tag,
      role: el.role,
      label: labelFor(el)
    }));
}

export function extractClickables(elements: ExtractorElement[]): ExtractedCandidate[] {
  return elements
    .filter((el) => isVisibleEnabled(el) && isClickableLike(el))
    .map((el) => ({
      id: el.id,
      tag: el.tag,
      role: el.role,
      label: labelFor(el)
    }));
}

export function extractState(elements: ExtractorElement[]): ExtractedState {
  const visible = elements.filter((el) => el.visible);
  const inputs = extractInputs(elements);
  const clickables = extractClickables(elements);
  const filledInputCount = inputs.filter((input) => {
    const source = elements.find((el) => el.id === input.id);
    return Boolean(source?.value?.trim());
  }).length;

  return {
    visibleCount: visible.length,
    inputCount: inputs.length,
    clickableCount: clickables.length,
    filledInputCount
  };
}
