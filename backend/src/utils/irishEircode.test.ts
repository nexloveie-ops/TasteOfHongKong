import { normalizeIrishEircode } from './irishEircode';

describe('normalizeIrishEircode', () => {
  it('accepts spaced and lower case', () => {
    expect(normalizeIrishEircode('d02 xy43')).toBe('D02 XY43');
  });
  it('accepts compact', () => {
    expect(normalizeIrishEircode('D02XY43')).toBe('D02 XY43');
  });
  it('rejects wrong length', () => {
    expect(normalizeIrishEircode('D02 XY4')).toBeNull();
  });
});
