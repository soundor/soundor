export type Unsubscribe = () => void;

export type ParamValueMap = Record<string, unknown>;
export type NativeRequestMap = Record<string, unknown>;
export type NativeResponseMap = Record<string, unknown>;
export type EventMap = Record<string, unknown>;

export interface BaseParamInfo {
  readonly id: string;
  readonly label: string;
  readonly type: 'float' | 'int' | 'bool' | 'enum';
  readonly default: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
  readonly values?: readonly string[];
  readonly onChange?: string;
}

export type ParamInfoMap = Record<string, BaseParamInfo>;

export interface SoundorParamValueMap extends ParamValueMap {}
export interface SoundorParamInfoMap extends ParamInfoMap {}
export interface SoundorNativeMethodRequests extends NativeRequestMap {}
export interface SoundorNativeMethodResponses extends NativeResponseMap {}
export interface SoundorEventMap extends EventMap {}

export interface Bridge<
  Params extends ParamValueMap = SoundorParamValueMap,
  Infos extends ParamInfoMap = SoundorParamInfoMap,
  NativeRequests extends NativeRequestMap = SoundorNativeMethodRequests,
  NativeResponses extends NativeResponseMap = SoundorNativeMethodResponses,
  Events extends EventMap = SoundorEventMap,
> {
  getParam<K extends keyof Params & string>(id: K): Params[K];
  setParam<K extends keyof Params & string>(
    id: K,
    value: Params[K],
  ): void | Promise<void>;
  subscribeParam<K extends keyof Params & string>(
    id: K,
    listener: (value: Params[K]) => void,
  ): Unsubscribe;
  getParamInfo<K extends keyof Infos & string>(id: K): Infos[K];
  getParamIds(): readonly (keyof Infos & string)[];
  callNative<K extends keyof NativeRequests & keyof NativeResponses & string>(
    name: K,
    payload: NativeRequests[K],
  ): Promise<NativeResponses[K]>;
  subscribeEvent<K extends keyof Events & string>(
    name: K,
    handler: (payload: Events[K]) => void,
  ): Unsubscribe;
}

type ParamValueFromInfo<Info> = Info extends { readonly type: 'bool' }
  ? boolean
  : Info extends { readonly type: 'float' | 'int' }
    ? number
    : Info extends {
          readonly type: 'enum';
          readonly values: readonly (infer Value)[];
        }
      ? Value
      : unknown;

export type ParamValuesFromInfo<Infos extends ParamInfoMap> = {
  [K in keyof Infos & string]: ParamValueFromInfo<Infos[K]>;
};

export type NativeHandler<Request, Response> = (
  payload: Request,
) => Response | Promise<Response>;

export type NativeHandlerMap<
  Requests extends NativeRequestMap,
  Responses extends NativeResponseMap,
> = {
  [K in keyof Requests & keyof Responses & string]?: NativeHandler<
    Requests[K],
    Responses[K]
  >;
};

export interface MockBridge<
  Infos extends ParamInfoMap,
  Params extends ParamValueMap = ParamValuesFromInfo<Infos>,
  NativeRequests extends NativeRequestMap = SoundorNativeMethodRequests,
  NativeResponses extends NativeResponseMap = SoundorNativeMethodResponses,
  Events extends EventMap = SoundorEventMap,
> extends Bridge<Params, Infos, NativeRequests, NativeResponses, Events> {
  updateParam<K extends keyof Params & string>(id: K, value: Params[K]): void;
  emitEvent<K extends keyof Events & string>(name: K, payload: Events[K]): void;
  setNativeHandler<
    K extends keyof NativeRequests & keyof NativeResponses & string,
  >(
    name: K,
    handler: NativeHandler<NativeRequests[K], NativeResponses[K]>,
  ): void;
}

export interface CreateMockBridgeOptions<
  Infos extends ParamInfoMap,
  NativeRequests extends NativeRequestMap = SoundorNativeMethodRequests,
  NativeResponses extends NativeResponseMap = SoundorNativeMethodResponses,
> {
  readonly parameters: Infos;
  readonly nativeMethods?: NativeHandlerMap<NativeRequests, NativeResponses>;
}

export function createMockBridge<
  const Infos extends ParamInfoMap,
  NativeRequests extends NativeRequestMap = SoundorNativeMethodRequests,
  NativeResponses extends NativeResponseMap = SoundorNativeMethodResponses,
  Events extends EventMap = SoundorEventMap,
>(
  options: CreateMockBridgeOptions<Infos, NativeRequests, NativeResponses>,
): MockBridge<
  Infos,
  ParamValuesFromInfo<Infos>,
  NativeRequests,
  NativeResponses,
  Events
> {
  type Params = ParamValuesFromInfo<Infos>;

  const values = new Map<string, unknown>();
  const paramListeners = new Map<string, Set<(value: unknown) => void>>();
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  const nativeHandlers = new Map<string, NativeHandler<unknown, unknown>>();

  for (const [id, info] of Object.entries(options.parameters)) {
    values.set(id, info.default);
  }
  for (const [name, handler] of Object.entries(options.nativeMethods ?? {})) {
    if (handler)
      nativeHandlers.set(name, handler as NativeHandler<unknown, unknown>);
  }

  const notifyParam = (id: string, value: unknown) => {
    for (const listener of paramListeners.get(id) ?? []) listener(value);
  };

  return {
    getParam(id) {
      return values.get(id) as Params[typeof id];
    },
    setParam(id, value) {
      values.set(id, value);
      notifyParam(id, value);
    },
    subscribeParam(id, listener) {
      let listeners = paramListeners.get(id);
      if (!listeners) {
        listeners = new Set();
        paramListeners.set(id, listeners);
      }
      listeners.add(listener as (value: unknown) => void);
      return () => {
        listeners.delete(listener as (value: unknown) => void);
        if (listeners.size === 0) paramListeners.delete(id);
      };
    },
    getParamInfo(id) {
      return options.parameters[id];
    },
    getParamIds() {
      return Object.keys(options.parameters) as readonly (keyof Infos &
        string)[];
    },
    async callNative(name, payload) {
      const handler = nativeHandlers.get(name);
      if (!handler)
        throw new Error(`No mock native handler registered for ${name}`);
      return (await handler(payload)) as NativeResponses[typeof name];
    },
    subscribeEvent(name, handler) {
      let listeners = eventListeners.get(name);
      if (!listeners) {
        listeners = new Set();
        eventListeners.set(name, listeners);
      }
      listeners.add(handler as (payload: unknown) => void);
      return () => {
        listeners.delete(handler as (payload: unknown) => void);
        if (listeners.size === 0) eventListeners.delete(name);
      };
    },
    updateParam(id, value) {
      values.set(id, value);
      notifyParam(id, value);
    },
    emitEvent(name, payload) {
      for (const listener of eventListeners.get(name) ?? []) listener(payload);
    },
    setNativeHandler(name, handler) {
      nativeHandlers.set(name, handler as NativeHandler<unknown, unknown>);
    },
  };
}
