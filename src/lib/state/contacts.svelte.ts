// Contacts (people you can send to) and their devices. Refreshed on start,
// when the app regains focus, every couple of minutes, after every change,
// and when presence shows a contact's device we haven't loaded yet.

import * as api from '../services/contactsApi';
import { listContactDevices } from '../services/devices';
import { onSessionReady, session } from './session.svelte';

export const contacts = $state<{ list: api.Contact[]; loaded: boolean }>({
  list: [],
  loaded: false,
});

const REFRESH_MS = 2 * 60_000;
const listeners = new Set<(acceptedIds: string[]) => void>();

/** Called with the accepted contacts' user ids after every refresh. */
export function onContactsChanged(fn: (acceptedIds: string[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let inflight: Promise<void> | null = null;

export function refreshContacts(): Promise<void> {
  inflight ??= (async () => {
    try {
      const list = await api.listContacts();
      const accepted = list.filter((c) => c.status === 'accepted');
      const ids = accepted.map((c) => c.userId);
      const devices = await listContactDevices(ids);
      if (!session.userId) return;
      contacts.list = list;
      contacts.loaded = true;
      session.contactNames = Object.fromEntries(accepted.map((c) => [c.userId, c.name]));
      session.contactDevices = devices;
      for (const fn of listeners) fn(ids);
    } catch (e) {
      console.warn('[contacts] refresh failed', (e as Error)?.message);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Presence can show a contact's new device many times a second; reload at most every 5 s.
let lastRequested = 0;
export function requestContactsRefresh(): void {
  if (Date.now() - lastRequested < 5000) return;
  lastRequested = Date.now();
  void refreshContacts();
}

async function after<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  await refreshContacts();
  return r;
}

export const requestContact = (email: string) => after(api.requestContact(email));
export const respondContact = (id: string, accept: boolean) =>
  after(api.respondContact(id, accept));
export const removeContact = (id: string) => after(api.removeContact(id));
export const acceptInvite = (token: string) => after(api.acceptInvite(token));
export const createInvite = api.createInvite;

onSessionReady(() => {
  void refreshContacts();
  const onVisible = () => document.visibilityState === 'visible' && void refreshContacts();
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => void refreshContacts(), REFRESH_MS);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
    contacts.list = [];
    contacts.loaded = false;
  };
});
