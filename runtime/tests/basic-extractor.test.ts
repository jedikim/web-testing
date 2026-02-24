import { describe, expect, it } from 'vitest';

import {
  extractClickables,
  extractInputs,
  extractState,
  type ExtractorElement
} from '../src/extractor/basic-extractor';

const elements: ExtractorElement[] = [
  { id: 'q', tag: 'input', type: 'text', visible: true, disabled: false, value: 'bag' },
  { id: 'hidden', tag: 'input', type: 'text', visible: false, disabled: false },
  { id: 'memo', tag: 'textarea', visible: true, disabled: false, value: '' },
  { id: 'submit', tag: 'button', visible: true, disabled: false, text: 'Search' },
  { id: 'link', tag: 'a', visible: true, disabled: false, text: 'More' },
  { id: 'off', tag: 'button', visible: true, disabled: true, text: 'Disabled' },
  { id: 'card', tag: 'div', role: 'button', visible: true, disabled: false, text: 'Card CTA' }
];

describe('basic extractor', () => {
  it('extracts visible enabled inputs', () => {
    const inputs = extractInputs(elements);
    expect(inputs.map((x) => x.id)).toEqual(['q', 'memo']);
  });

  it('extracts visible enabled clickables', () => {
    const clickables = extractClickables(elements);
    expect(clickables.map((x) => x.id)).toEqual(['submit', 'link', 'card']);
  });

  it('builds state summary', () => {
    const state = extractState(elements);
    expect(state.visibleCount).toBe(6);
    expect(state.inputCount).toBe(2);
    expect(state.clickableCount).toBe(3);
    expect(state.filledInputCount).toBe(1);
  });
});
