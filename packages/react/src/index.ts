import type {
  Bridge,
  EventMap,
  NativeRequestMap,
  NativeResponseMap,
  ParamInfoMap,
  ParamValueMap,
  SoundorEventMap,
  SoundorNativeMethodRequests,
  SoundorNativeMethodResponses,
  SoundorParamInfoMap,
  SoundorParamValueMap,
} from '@soundor/bridge';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export {
  createMockBridge,
  type BaseParamInfo,
  type Bridge,
  type EventMap,
  type MockBridge,
  type NativeHandler,
  type NativeHandlerMap,
  type NativeRequestMap,
  type NativeResponseMap,
  type ParamInfoMap,
  type ParamValueMap,
  type SoundorEventMap,
  type SoundorNativeMethodRequests,
  type SoundorNativeMethodResponses,
  type SoundorParamInfoMap,
  type SoundorParamValueMap,
  type Unsubscribe,
} from '@soundor/bridge';

const SoundorBridgeContext = createContext<Bridge | null>(null);

export interface SoundorProviderProps<
  Params extends ParamValueMap = SoundorParamValueMap,
  Infos extends ParamInfoMap = SoundorParamInfoMap,
  NativeRequests extends NativeRequestMap = SoundorNativeMethodRequests,
  NativeResponses extends NativeResponseMap = SoundorNativeMethodResponses,
  Events extends EventMap = SoundorEventMap,
> {
  readonly bridge: Bridge<
    Params,
    Infos,
    NativeRequests,
    NativeResponses,
    Events
  >;
  readonly children: ReactNode;
}

export function SoundorProvider<
  Params extends ParamValueMap = SoundorParamValueMap,
  Infos extends ParamInfoMap = SoundorParamInfoMap,
  NativeRequests extends NativeRequestMap = SoundorNativeMethodRequests,
  NativeResponses extends NativeResponseMap = SoundorNativeMethodResponses,
  Events extends EventMap = SoundorEventMap,
>({
  bridge,
  children,
}: SoundorProviderProps<
  Params,
  Infos,
  NativeRequests,
  NativeResponses,
  Events
>) {
  return createElement(
    SoundorBridgeContext,
    { value: bridge as unknown as Bridge },
    children,
  );
}

export function useBridge<
  Params extends ParamValueMap = SoundorParamValueMap,
  Infos extends ParamInfoMap = SoundorParamInfoMap,
  NativeRequests extends NativeRequestMap = SoundorNativeMethodRequests,
  NativeResponses extends NativeResponseMap = SoundorNativeMethodResponses,
  Events extends EventMap = SoundorEventMap,
>(): Bridge<Params, Infos, NativeRequests, NativeResponses, Events> {
  const bridge = useContext(SoundorBridgeContext);
  if (!bridge) throw new Error('SoundorProvider is missing a bridge');
  return bridge as unknown as Bridge<
    Params,
    Infos,
    NativeRequests,
    NativeResponses,
    Events
  >;
}

export function useParam<
  Params extends ParamValueMap = SoundorParamValueMap,
  K extends keyof Params & string = keyof Params & string,
>(id: K): [Params[K], (value: Params[K]) => void | Promise<void>] {
  const bridge = useBridge<Params>();
  const value = useSyncExternalStore(
    useCallback(
      (onStoreChange) =>
        bridge.subscribeParam(id, () => {
          onStoreChange();
        }),
      [bridge, id],
    ),
    () => bridge.getParam(id),
    () => bridge.getParam(id),
  );
  const setValue = useCallback(
    (nextValue: Params[K]) => bridge.setParam(id, nextValue),
    [bridge, id],
  );

  return [value, setValue];
}

export type ParamState<Value> = {
  readonly value: Value;
  readonly set: (value: Value) => void | Promise<void>;
};

export type ParamsState<Params extends ParamValueMap> = {
  readonly [K in keyof Params & string]: ParamState<Params[K]>;
};

export function useParams<
  Params extends ParamValueMap = SoundorParamValueMap,
  Infos extends ParamInfoMap = SoundorParamInfoMap,
>(): ParamsState<Params> {
  const bridge = useBridge<Params, Infos>();
  const ids = useMemo(
    () => bridge.getParamIds() as readonly (keyof Params & string)[],
    [bridge],
  );
  const [, setVersion] = useState(0);

  useEffect(() => {
    const unsubscribes = ids.map((id) =>
      bridge.subscribeParam(id, () => setVersion((version) => version + 1)),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [bridge, ids]);

  return useMemo(() => {
    const entries = ids.map((id) => [
      id,
      {
        value: bridge.getParam(id),
        set: (value: Params[typeof id]) => bridge.setParam(id, value),
      },
    ]);
    return Object.fromEntries(entries) as ParamsState<Params>;
  }, [bridge, ids]);
}

export function useParamInfo<
  Infos extends ParamInfoMap = SoundorParamInfoMap,
  K extends keyof Infos & string = keyof Infos & string,
>(id: K): Infos[K] {
  return useBridge<ParamValueMap, Infos>().getParamInfo(id);
}

export function useNative<
  Requests extends NativeRequestMap = SoundorNativeMethodRequests,
  Responses extends NativeResponseMap = SoundorNativeMethodResponses,
>() {
  const bridge = useBridge<ParamValueMap, ParamInfoMap, Requests, Responses>();
  const call = useCallback(
    <K extends keyof Requests & keyof Responses & string>(
      name: K,
      payload: Requests[K],
    ) => bridge.callNative(name, payload),
    [bridge],
  );

  return useMemo(() => ({ call }), [call]);
}

export function useEvent<
  Events extends EventMap = SoundorEventMap,
  K extends keyof Events & string = keyof Events & string,
>(name: K, handler: (payload: Events[K]) => void) {
  const bridge = useBridge<
    ParamValueMap,
    ParamInfoMap,
    NativeRequestMap,
    NativeResponseMap,
    Events
  >();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(
    () => bridge.subscribeEvent(name, (payload) => handlerRef.current(payload)),
    [bridge, name],
  );
}

export function useEventValue<
  Events extends EventMap = SoundorEventMap,
  K extends keyof Events & string = keyof Events & string,
>(name: K): Events[K] | undefined {
  const [value, setValue] = useState<Events[K]>();

  useEvent(name, setValue);

  return value;
}
