const prefix = 'listening-studio:';

export function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(prefix + key);
    return value === null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(prefix + key, JSON.stringify(value));
  } catch {
    // Playback remains usable when private browsing or a quota prevents saving.
  }
}
