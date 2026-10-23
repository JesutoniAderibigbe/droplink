export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'error';
  action?: { label: string; href?: string; onClick?: () => void };
}

export const toasts = $state<{ list: Toast[] }>({ list: [] });
let nextId = 1;

export function toast(
  text: string,
  opts: Partial<Omit<Toast, 'id' | 'text'>> & { ms?: number } = {},
): void {
  const t: Toast = { id: nextId++, text, kind: opts.kind ?? 'info', action: opts.action };
  toasts.list = [...toasts.list.slice(-3), t];
  setTimeout(() => dismiss(t.id), opts.ms ?? 5000);
}

export function dismiss(id: number): void {
  toasts.list = toasts.list.filter((t) => t.id !== id);
}
