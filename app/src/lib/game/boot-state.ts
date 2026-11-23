export type BootState = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; reason: string };

export type BootEvent = { kind: "drawn" } | { kind: "failed"; reason: string };

const LOADING: BootState = { kind: "loading" };
const READY: BootState = { kind: "ready" };

export function nextBootState(state: BootState, event: BootEvent): BootState {
  if (event.kind === "drawn") return state.kind === "ready" ? state : READY;
  return state.kind === "loading" ? { kind: "failed", reason: event.reason } : state;
}

let currentState: BootState = LOADING;
const listeners = new Set<() => void>();

function dispatchBootEvent(event: BootEvent): void {
  const next = nextBootState(currentState, event);
  if (next === currentState) return;
  currentState = next;
  for (const listener of listeners) listener();
}

export const bootStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): BootState => currentState,
  getServerSnapshot: (): BootState => LOADING,
};

export const reportSceneDrawn = (): void => dispatchBootEvent({ kind: "drawn" });

export const reportSceneFailed = (reason: string): void => dispatchBootEvent({ kind: "failed", reason });
