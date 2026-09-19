import { describe, it, expect } from 'vitest';
import { hello } from './index.js';

describe('hello', () => {
  it('greets by name', () => {
    expect(hello('world')).toBe('Hello, world!');
  });
});
