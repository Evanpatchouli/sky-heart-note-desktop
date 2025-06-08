import { EventEmitter } from 'ahooks/lib/useEventEmitter';
import { useSyncExternalStore } from 'react';

type EmitterStoreState = {
  instance: EventEmitter<{
    type: string;
    payload: any;
    id?: string;
  }> | null;
}

let storeState: EmitterStoreState = {
  instance: null
}
let listeners: Array<Function> = [];

const setState = (newState: Partial<EmitterStoreState>) => {
  storeState = {
    ...storeState,
    ...newState
  }
  emitChange();
};

export const emitterStore = {
  set(newState: Partial<EmitterStoreState>) {
    setState(newState);
  },
  setInstance(instance: EventEmitter<{
    type: string;
    payload: any;
  }>) {
    setState({ instance });
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

export const useEmitterStore = () => {
  const state = useSyncExternalStore(emitterStore.subscribe, emitterStore.getSnapshot);
  return {
    state,
    set: emitterStore.set,
    setInstance: emitterStore.setInstance
  }
}

type Subscription<T> = (event: T) => void;

export default function useEmitter() {
  const { state, setInstance } = useEmitterStore();
  if (!state.instance) {
    const emitter = new EventEmitter<{
      type: string;
      payload: any;
      id?: string;
    }>();
    setInstance(emitter);
    return {
      emit: emitter.emit,
      useSubscription: <P = unknown>(type: string, callback: Subscription<{
        type: string;
        payload: P;
        id?: string;
      }>) => {
        emitter.useSubscription((e) => {
          if (e.type === type) {
            callback(e);
          }
        })
      }
    }
  } else {
    return {
      emit: state.instance.emit,
      useSubscription: <P = unknown>(type: string, callback: Subscription<{
        type: string;
        payload: P;
        id?: string;
      }>) => {
        state.instance?.useSubscription((e) => {
          if (e.type === type) {
            callback(e);
          }
        })
      }
    }
  }
}