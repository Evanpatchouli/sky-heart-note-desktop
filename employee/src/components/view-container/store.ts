import { useSyncExternalStore } from 'react';

type ViewContainerStoreState = {
  gap: number | string
}

let storeState: ViewContainerStoreState = {
  gap: 0
}
let listeners: Array<Function> = [];

const setState = (newState: Partial<ViewContainerStoreState>) => {
  storeState = {
    ...storeState,
    ...newState
  }
  emitChange();
};

export const viewContainerStore = {
  set(newState: Partial<ViewContainerStoreState>) {
    setState(newState);
  },
  setGap(gap: number | string) {
    setState({ gap });
  },
  subscribe(listener: Function) {
    listeners = [...listeners, listener];
    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  },
  getSnapshot() {
    return storeState;
  }
};

function emitChange() {
  for (let listener of listeners) {
    listener();
  }
}

export const useViewContainerStore = () => {
  const state = useSyncExternalStore(viewContainerStore.subscribe, viewContainerStore.getSnapshot);
  return {
    state,
    set: viewContainerStore.set,
    setGap: viewContainerStore.setGap
  }
}