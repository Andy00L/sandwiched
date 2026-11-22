import { spyOn } from "bun:test";

type FetchHandler = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function stubFetch(handler: FetchHandler) {
  return spyOn(globalThis, "fetch").mockImplementation(Object.assign(handler, { preconnect: globalThis.fetch.preconnect }));
}

export function hangUntilAborted(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
}
