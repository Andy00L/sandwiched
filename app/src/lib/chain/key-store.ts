import { attemptSync } from "./result";

export type KeyStore = {
  isDurable: boolean;
  read: (key: string) => string | null;
  write: (key: string, value: string) => boolean;
  remove: (key: string) => boolean;
  listKeys: (prefix: string) => string[];
};

const findBrowserStorage = (): Storage | null => {
  const found = attemptSync(() => (typeof window === "undefined" ? null : window.localStorage));
  return found.ok ? found.value : null;
};

const listStorageKeys = (storage: Storage): string[] =>
  Array.from({ length: storage.length }, (_unused, index) => storage.key(index)).filter((key) => key !== null);

export const createBrowserKeyStore = (): KeyStore => ({
  isDurable: true,
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
    return storage !== null && attemptSync(() => storage.removeItem(key)).ok;
  },
  listKeys: (prefix) => {
    const storage = findBrowserStorage();
    if (storage === null) return [];
    const listed = attemptSync(() => listStorageKeys(storage).filter((key) => key.startsWith(prefix)));
    return listed.ok ? listed.value : [];
  },
});

export const createMemoryKeyStore = (): KeyStore => {
  const values = new Map<string, string>();
  return {
    isDurable: false,
    read: (key) => values.get(key) ?? null,
    write: (key, value) => {
      values.set(key, value);
      return true;
    },
    remove: (key) => {
      values.delete(key);
      return true;
    },
    listKeys: (prefix) => [...values.keys()].filter((key) => key.startsWith(prefix)),
  };
};
