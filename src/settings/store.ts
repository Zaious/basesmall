// The settings in memory, saved to settings.json on every change. Writes go one at a time and
// always carry the newest settings, so a burst of clicks ends with the last state on disk.

import { DEFAULTS, normalize, type Settings } from './schema.ts';

export interface SettingsBackend {
  /** The saved file's text, or null when there is none yet. */
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

export type SettingsListener = (now: Settings, before: Settings) => void;

export class SettingsStore {
  private value: Settings;
  private readonly backend: SettingsBackend;
  private readonly listeners = new Set<SettingsListener>();
  private writing: Promise<void> | null = null;
  private dirty = false;
  /** When false, changes apply in memory only (a checking run must not touch the user's file). */
  persist = true;
  /** Last write error, for diagnostics. */
  lastError: unknown = null;

  constructor(backend: SettingsBackend, initial: Settings = DEFAULTS) {
    this.backend = backend;
    this.value = initial;
  }

  /** Load the saved file. With none, start from `migrate()` and write it out at once. */
  static async open(backend: SettingsBackend, migrate: () => Settings): Promise<SettingsStore> {
    let text: string | null = null;
    try { text = await backend.read(); } catch { /* unreadable: treat as missing */ }
    let parsed: unknown;
    if (text !== null) {
      // Windows editors may save a byte-order mark, which JSON.parse rejects.
      try { parsed = JSON.parse(text.replace(/^﻿/, '')); } catch { parsed = undefined; }
    }
    const store = new SettingsStore(backend, parsed === undefined ? migrate() : normalize(parsed));
    if (text === null) store.save();
    return store;
  }

  get current(): Settings { return this.value; }

  subscribe(fn: SettingsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Change settings. `fn` edits a copy; the result is normalized before it is kept. */
  update(fn: (draft: Settings) => void): void {
    const before = this.value;
    const draft = structuredClone(before);
    fn(draft);
    const next = normalize(draft);
    if (JSON.stringify(next) === JSON.stringify(before)) return;
    this.value = next;
    this.save();
    for (const l of this.listeners) l(next, before);
  }

  /** Resolves once everything changed so far is on disk. */
  async flushed(): Promise<void> {
    while (this.writing) await this.writing;
  }

  private save(): void {
    if (!this.persist) return;
    this.dirty = true;
    if (this.writing) return;
    this.writing = (async () => {
      while (this.dirty) {
        this.dirty = false;
        try { await this.backend.write(`${JSON.stringify(this.value, null, 2)}\n`); this.lastError = null; } catch (e) { this.lastError = e; }
      }
      this.writing = null;
    })();
  }
}
