// "Good morning, Toni". Accounts created before sign-up asked for a name have
// the email prefix as their display name; those get no name (and a prompt).

export const MAX_NAME_LENGTH = 80;

export function partOfDay(hour: number): string {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** The user's real name, or '' when we only have the email prefix (or nothing). */
export function realName(displayName: string | null | undefined, email?: string | null): string {
  const name = (displayName ?? '').trim();
  if (!name) return '';
  if (email && name.toLowerCase() === email.split('@')[0].toLowerCase()) return '';
  return name;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

export function greeting(hour: number, name: string): string {
  const first = firstName(name);
  return first ? `${partOfDay(hour)}, ${first}` : partOfDay(hour);
}
