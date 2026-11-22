import { attemptSync } from "./result";

export type KeyStore = {
  read: (key: string) => string | null;
  write: (key: string, value: string) => boolean;
  remove: (key: string) => void;
};

const findBrowserStorage = (): Storage | null => {
  const found = attemptSync(() => (typeof window === "undefined" ? null : window.localStorage));
  return found.ok ? found.value : null;
};

export const createBrowserKeyStore = (): KeyStore => ({
  read: (key) => {
    const storage = findBrowserStorage();
    if (storage === null) return null;
    const read = attemptSync(() => storage.getItem(key));
    return read.ok ? read.value : null;
  },
  write: (key, value) => {
    const storage = findBrowserStorage();
    return storage !== null && attemptSync(() => storage.setItem(key, value)).ok;
  },
  remove: (key) => {
    const storage = findBrowserStorage();
    if (storage !== null) attemptSync(() => storage.removeItem(key));
  },
});

export const createMemoryKeyStore = (): KeyStore => {
  const values = new Map<string, string>();
  return {
    read: (key) => values.get(key) ?? null,
    write: (key, value) => {
      values.set(key, value);
      return true;
    },
    remove: (key) => {
      values.delete(key);
    },
  };
};
