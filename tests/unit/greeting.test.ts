import { describe, expect, it } from 'vitest';
import { firstName, greeting, realName } from '../../src/lib/core/greeting';

describe('greeting', () => {
  it('greets by first name for the time of day', () => {
    expect(greeting(8, 'Jesutoni Aderibigbe')).toBe('Good morning, Jesutoni');
    expect(greeting(14, 'Ada')).toBe('Good afternoon, Ada');
    expect(greeting(21, '')).toBe('Good evening');
  });

  it('treats the email prefix as "no name yet"', () => {
    expect(realName('toni.a', 'toni.a@example.com')).toBe('');
    expect(realName('Toni', 'toni.a@example.com')).toBe('Toni');
    expect(realName('  ', 'x@y.z')).toBe('');
    expect(realName(null)).toBe('');
  });

  it('takes the first word as the first name', () => {
    expect(firstName('  Mary  Jane Watson ')).toBe('Mary');
  });
});
