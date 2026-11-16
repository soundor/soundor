/**
 * The controller's part of `src/plugin.rs`: soundor.config's native types
 * as Rust types, its native methods as the `NativeMethods` trait a
 * controller implements (and their dispatch from the runtime's calls), the
 * parameters and persistent state as a `TaskContext` reaches them, and the
 * controller descriptor the runtime checks.
 */
import type { ResolvedParameter, ResolvedSoundorConfig } from '@soundor/config';
import {
  byteLiterals,
  describeController,
  enumeratorName,
  stateJson,
  type NativeApiModel,
  type NativeMethodModel,
  type NativeType,
  type NativeTypeModel,
  type StateSchema,
} from '@soundor/core';

/** The helpers `renderPluginRs` shares. */
export interface RustNames {
  readonly field: (id: string) => string;
  readonly string: (text: string) => string;
  readonly numbers: Readonly<Record<string, string>>;
  readonly parameterType: (parameter: ResolvedParameter) => string;
  readonly checkUnique: (names: [string, string][], what: string) => void;
}

/** The Rust type of a native value, as a method or state field holds it. */
function rustValueType(type: NativeType, names: RustNames): string {
  switch (type.kind) {
    case 'void':
      return '()';
    case 'primitive':
      if (type.name === 'boolean') return 'bool';
      if (type.name === 'string') return 'String';
      return names.numbers[type.name]!;
    case 'declared':
      return `types::${type.name}`;
    case 'array':
      return `Vec<${rustValueType(type.element, names)}>`;
    case 'buffer':
      return `Vec<${names.numbers[type.element]!}>`;
    case 'nullable':
      return `Option<${rustValueType(type.inner, names)}>`;
  }
}

function describeType(type: NativeType): string {
  switch (type.kind) {
    case 'void':
      return 'void';
    case 'primitive':
      return type.name;
    case 'declared':
      return type.name;
    case 'array':
      return `${describeType(type.element)}[]`;
    case 'buffer':
      return `buffer<${type.element}>`;
    case 'nullable':
      return `${describeType(type.inner)}?`;
  }
}

function renderType(type: NativeTypeModel, names: RustNames): string {
  if (type.kind === 'enum') {
    const variants = type.values.map((value) => enumeratorName(value));
    names.checkUnique(
      variants.map((variant, index) => [
        variant,
        `native.types.${type.name}.enum.${index}`,
      ]),
      'a Rust variant',
    );
    return `    /// \`${type.name}\` (\`native.types\`): one of its values.
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
    pub enum ${type.name} {
${type.values.map((value, index) => `        /// ${names.string(value)}.\n${index === 0 ? '        #[default]\n' : ''}        ${variants[index]},`).join('\n')}
    }

    impl ${type.name} {
        /// Every value, in the config's order.
        pub const ALL: [Self; ${variants.length}] = [${variants.map((variant) => `Self::${variant}`).join(', ')}];

        /// Its value in soundor.config, as JavaScript has it.
        pub fn value(self) -> &'static str {
            match self {
${variants.map((variant, index) => `                Self::${variant} => ${names.string(type.values[index]!)},`).join('\n')}
            }
        }

        /// The value named \`value\`.
        pub fn from_value(value: &str) -> Option<Self> {
            Self::ALL.into_iter().find(|candidate| candidate.value() == value)
        }
    }

    impl Wire for ${type.name} {
        fn encode(&self, out: &mut Vec<u8>) {
            (*self as u32).encode(out);
        }
        fn decode(input: &mut Reader<'_>) -> Result<Self, WireError> {
            Self::ALL
                .get(u32::decode(input)? as usize)
                .copied()
                .ok_or(WireError("enum index"))
        }
    }

    impl StateValue for ${type.name} {
        fn write_json(&self, out: &mut String) -> Result<(), JsonError> {
            crate::json::write_string(self.value(), out);
            Ok(())
        }
        fn read_json(value: &Json) -> Result<Self, JsonError> {
            match value {
                Json::String(text) => Self::from_value(text)
                    .ok_or_else(|| JsonError(format!("invalid ${type.name}: {text}"))),
                _ => Err(JsonError("expected a ${type.name}".into())),
            }
        }
    }`;
  }
  const fields = type.fields.map((field) => ({
    ...field,
    rust: names.field(field.name),
  }));
  names.checkUnique(
    fields.map((field) => [
      field.rust,
      `native.types.${type.name}.struct.${field.name}`,
    ]),
    'a Rust field',
  );
  return `    /// \`${type.name}\` (\`native.types\`).
    #[derive(Clone, Debug, Default, PartialEq)]
    pub struct ${type.name} {
${fields.map((field) => `        /// \`${field.name}\`: ${describeType(field.type)}.\n        pub ${field.rust}: ${rustValueType(field.type, names)},`).join('\n')}
    }

    impl Wire for ${type.name} {
        fn encode(&self, out: &mut Vec<u8>) {
${fields.map((field) => `            self.${field.rust}.encode(out);`).join('\n')}
        }
        fn decode(input: &mut Reader<'_>) -> Result<Self, WireError> {
            Ok(Self {
${fields.map((field) => `                ${field.rust}: Wire::decode(input)?,`).join('\n')}
            })
        }
    }

    impl StateValue for ${type.name} {
        fn write_json(&self, out: &mut String) -> Result<(), JsonError> {
            out.push('{');
${fields.map((field, index) => `            ${index > 0 ? "out.push(',');\n            " : ''}crate::json::write_string(${names.string(field.name)}, out);\n            out.push(':');\n            self.${field.rust}.write_json(out)?;`).join('\n')}
            out.push('}');
            Ok(())
        }
        fn read_json(value: &Json) -> Result<Self, JsonError> {
            let Json::Object(members) = value else {
                return Err(JsonError("expected a ${type.name}".into()));
            };
            Ok(Self {
${fields.map((field) => `                ${field.rust}: StateValue::read_json(crate::json::member(members, ${names.string(field.name)})?)?,`).join('\n')}
            })
        }
    }`;
}

interface Method {
  readonly model: NativeMethodModel;
  readonly index: number;
  readonly rust: string;
  readonly context: string;
  readonly args: readonly { readonly rust: string; readonly type: string }[];
  readonly returns: string;
}

function methods(native: NativeApiModel, names: RustNames): Method[] {
  const list = native.methods.map((model, index) => {
    const args = model.args.map((arg) => ({
      rust: names.field(arg.name),
      type: rustValueType(arg.type, names),
    }));
    return {
      model,
      index,
      rust: names.field(model.name),
      context: args.some((arg) => arg.rust === 'ctx') ? 'context' : 'ctx',
      args,
      returns: rustValueType(model.returns, names),
    };
  });
  names.checkUnique(
    list.map((method) => [method.rust, `native.methods.${method.model.name}`]),
    'a Rust method',
  );
  for (const method of list)
    names.checkUnique(
      method.args.map((arg, index) => [
        arg.rust,
        `native.methods.${method.model.name}.args.${method.model.args[index]!.name}`,
      ]),
      'a Rust argument',
    );
  return list;
}

function signature(method: Method): string {
  const args = method.args.map((arg) => `, ${arg.rust}: ${arg.type}`).join('');
  if (method.model.async)
    return `fn ${method.rust}(${method.context}: AsyncTaskContext<Self>${args}) -> impl Future<Output = Result<${method.returns}, Error>> + Send`;
  const returns = method.returns === '()' ? '' : ` -> ${method.returns}`;
  return `fn ${method.rust}(${method.context}: &mut TaskContext<'_, Self>${args})${returns}`;
}

function methodDoc(method: Method): string {
  const args = method.model.args
    .map((arg) => `${arg.name}: ${describeType(arg.type)}`)
    .join(', ');
  const returns = describeType(method.model.returns);
  return method.model.async
    ? `    /// \`${method.model.name}(${args})\`, async: JavaScript awaits a promise of ${returns}, which this future's error rejects.`
    : `    /// \`${method.model.name}(${args})\`: returns ${returns} to JavaScript, synchronously.`;
}

function renderNativeMethods(list: readonly Method[]): string {
  const intro = `/// soundor.config's native methods (\`native.methods\`), which the plugin's
/// controller implements: \`impl NativeMethods for PluginController\`, with
/// \`soundor::export!(PluginProcessor, PluginController)\`. Every method the
/// config declares is required, with its types; JavaScript calls them
/// through \`soundor:native\`.
///
/// A synchronous method runs on the control thread, inside the JavaScript
/// call, with a [\`TaskContext\`] of the call. An \`async: true\` one returns a
/// future the controller's worker polls, with an [\`AsyncTaskContext\`]; it
/// reaches the control thread with \`ctx.schedule()\`.`;
  if (list.length === 0)
    return `${intro}
///
/// The config declares none: every [\`Controller\`] implements it.
pub trait NativeMethods: Controller + Sized {}

impl<C: Controller> NativeMethods for C {}
`;
  return `${intro}
pub trait NativeMethods: Controller + Sized {
${list.map((method) => `${methodDoc(method)}\n    ${signature(method)};`).join('\n\n')}
}
`;
}

function renderDispatch(list: readonly Method[]): string {
  const reads = (method: Method) =>
    method.args
      .map(
        (arg, index) =>
          `            let a${index} = <${arg.type} as Wire>::decode(&mut input)?;\n`,
      )
      .join('');
  const args = (method: Method) =>
    method.args.map((_, index) => `, a${index}`).join('');
  const sync = list.filter((method) => !method.model.async);
  const async = list.filter((method) => method.model.async);
  const wrong = (others: readonly Method[]) =>
    others.length > 0
      ? `        ${others.map((method) => method.index).join(' | ')} => Err(CallError::WrongKind),\n`
      : '';
  return `/// The config's native methods, in the order the runtime numbers them
/// (by name): each one's name and whether it is async.
pub(crate) const METHODS: [(&str, bool); ${list.length}] = [${list.map((method) => `(${JSON.stringify(method.model.name)}, ${method.model.async})`).join(', ')}];

/// A synchronous method's call: its arguments decoded, its result encoded.
pub(crate) fn call<C: NativeMethods>(method: u32, ctx: &mut TaskContext<'_, C>, args: &[u8]) -> Result<Vec<u8>, CallError> {
    let mut input = Reader::new(args);
    match method {
${sync
  .map(
    (method) => `        ${method.index} => {
${reads(method)}            input.finish()?;
            Ok(crate::wire::to_bytes(&C::${method.rust}(ctx${args(method)})))
        }
`,
  )
  .join('')}${wrong(async)}        _ => Err(CallError::NoSuchMethod),
    }
}

/// An async method's future: its arguments decoded, its result encoded.
pub(crate) fn start<C: NativeMethods>(method: u32, ctx: AsyncTaskContext<C>, args: &[u8]) -> Result<NativeFuture, CallError> {
    let mut input = Reader::new(args);
    match method {
${async
  .map(
    (method) => `        ${method.index} => {
${reads(method)}            input.finish()?;
            let future = C::${method.rust}(ctx${args(method)});
            Ok(Box::pin(async move { future.await.map(|value| crate::wire::to_bytes(&value)) }))
        }
`,
  )
  .join('')}${wrong(sync)}        _ => Err(CallError::NoSuchMethod),
    }
}
`;
}

function renderParameterAccess(
  config: ResolvedSoundorConfig,
  names: RustNames,
): string {
  const fields = config.parameters.map((parameter, index) => {
    const type = names.parameterType(parameter);
    const kind =
      parameter.access === 'readOnly' ? 'ReadOnlyParameter' : 'Parameter';
    return { parameter, index, rust: names.field(parameter.id), type, kind };
  });
  return `/// The parameters, as a controller reaches them on the control thread:
/// typed as soundor.config declares them.
pub struct ParameterAccess<'a> {
${fields.map((field) => `    /// ${names.string(field.parameter.label)} (\`${field.parameter.id}\`)${field.kind === 'ReadOnlyParameter' ? ', read-only: the processing publishes it' : ''}.\n    pub ${field.rust}: ${field.kind}<'a, ${field.type}>,`).join('\n')}
    _host: PhantomData<&'a Host>,
}

impl<'a> ParameterAccess<'a> {
    pub(crate) fn new(host: &'a Host) -> Self {
        let _ = host;
        Self {
${fields.map((field) => `            ${field.rust}: ${field.kind}::new(host, ${field.index}),`).join('\n')}
            _host: PhantomData,
        }
    }
}
`;
}

function renderStateAccess(state: StateSchema, names: RustNames): string {
  const fields = state.fields.map((field, index) => ({
    field,
    index,
    rust: names.field(field.name),
    type: rustValueType(field.type, names),
  }));
  return `/// The persistent state (soundor.config's \`state\`), as a controller
/// reaches it on the control thread: every field, typed as declared, through
/// the runtime's state store.
pub struct StateAccess<'a> {
${fields.map((field) => `    /// \`${field.field.name}\`: ${describeType(field.field.type)}${field.field.maxLength === undefined ? '' : `, up to ${field.field.maxLength} elements`}.\n    pub ${field.rust}: StateField<'a, ${field.type}>,`).join('\n')}
    _host: PhantomData<&'a Host>,
}

impl<'a> StateAccess<'a> {
    pub(crate) fn new(host: &'a Host) -> Self {
        let _ = host;
        Self {
${fields.map((field) => `            ${field.rust}: StateField::new(host, ${field.index}, ${names.string(field.field.name)}),`).join('\n')}
            _host: PhantomData,
        }
    }
}

/// Every state field's name, in the order the runtime numbers them.
pub(crate) const STATE_FIELDS: [&str; ${fields.length}] = [${fields.map((field) => names.string(field.field.name)).join(', ')}];
/// Every state field's default, as state JSON.
pub(crate) const STATE_DEFAULTS: [&str; ${fields.length}] = [${fields.map((field) => names.string(stateJson(field.field.default))).join(', ')}];
/// Every state field's \`maxLength\`, if it has one.
pub(crate) const STATE_MAX_LENGTHS: [Option<usize>; ${fields.length}] = [${fields.map((field) => (field.field.maxLength === undefined ? 'None' : `Some(${field.field.maxLength})`)).join(', ')}];
`;
}

/**
 * A controller for `soundor init` to scaffold: every native method the config
 * declares, implemented with its type's default, so that the crate compiles
 * and the plugin runs until the user writes them.
 */
export function renderControllerScaffold(
  native: NativeApiModel,
  names: RustNames,
): string {
  const list = methods(native, names);
  const stub = (method: Method): string => {
    const unused: Method = {
      ...method,
      context: `_${method.context}`,
      args: method.args.map((arg) => ({
        ...arg,
        rust: `_${arg.rust.replace(/^r#/, '')}`,
      })),
    };
    const head = signature(unused)
      .replace("&mut TaskContext<'_, Self>", '&mut TaskContext<Self>')
      .replace(
        /-> impl Future<Output = (Result<.*, Error>)> \+ Send$/,
        '-> $1',
      );
    const body = method.model.async
      ? 'Ok(Default::default())'
      : method.returns === '()'
        ? ''
        : 'Default::default()';
    const doc = methodDoc(method).replace(/^    /, '');
    return `    ${doc}
    ${method.model.async ? 'async ' : ''}${head} {${body ? `\n        // TODO: implement it.\n        ${body}\n    ` : '\n        // TODO: implement it.\n    '}}`;
  };
  return `//! The plugin's controller: the Rust behind \`soundor:native\`'s methods,
//! on the control thread beside the UI. Each method soundor.config declares
//! is one here, typed as declared (the compiler checks every one of them,
//! from the generated \`NativeMethods\`); a synchronous one gets a
//! \`TaskContext\`, an \`async: true\` one an \`AsyncTaskContext\`.

use soundor::prelude::*;

/// What the controller keeps on the control thread, between calls: one per
/// plugin instance, for as long as it lives. Not saved with the plugin; use
/// soundor.config's \`state\` for that.
#[derive(Default)]
pub struct LocalStore {}

/// What async tasks share with the control thread, from any thread.
#[derive(Default)]
pub struct SharedStore {}

/// The plugin's controller. Soundor never constructs it: its methods take
/// their context, and keep what lasts in the stores.
pub struct PluginController;

impl Controller for PluginController {
    type Local = LocalStore;
    type Shared = SharedStore;
}

impl NativeMethods for PluginController {
${list.map(stub).join('\n\n')}
}
`;
}

/** The controller's part of `src/plugin.rs`. */
export function renderControllerRs(
  config: ResolvedSoundorConfig,
  native: NativeApiModel,
  state: StateSchema,
  names: RustNames,
): string {
  const list = methods(native, names);
  const descriptor = describeController(
    native,
    state,
    config.parameters.length,
  );
  names.checkUnique(
    state.fields.map((field) => [
      names.field(field.name),
      `state.${field.name}`,
    ]),
    'a Rust field',
  );
  const choiceValues = config.parameters
    .filter((parameter) => parameter.type === 'choice')
    .map((parameter) => {
      const type = names.parameterType(parameter);
      return `impl ParameterValue for ${type} {
    fn from_plain(plain: f64) -> Self {
        Self::from_index(plain.max(0.0).round() as u32)
    }
    fn to_plain(self) -> f64 {
        f64::from(self.index())
    }
}
`;
    });
  return [
    `// ── The controller ──────────────────────────────────────────────────────\n`,
    `use std::future::Future;`,
    `use std::marker::PhantomData;\n`,
    `use crate::controller::{AsyncTaskContext, CallError, Controller, NativeFuture, Parameter, ParameterValue, ReadOnlyParameter, StateField, TaskContext};`,
    `use crate::error::Error;`,
    `use crate::host::Host;`,
    `use crate::json::{Json, JsonError, StateValue};`,
    `use crate::wire::{Reader, Wire, WireError};\n`,
    `/// The ids of the config's factory presets (\`presets\`), in its order.`,
    `pub const PRESET_IDS: &[&str] = &[${(config.presets ?? []).map((preset) => names.string(preset.id)).join(', ')}];\n`,
    `/// The config's native types (\`native.types\`), as native methods and`,
    `/// persistent state hold them.`,
    `pub mod types {`,
    `    use super::*;\n`,
    native.types.map((type) => renderType(type, names)).join('\n\n'),
    `}\n`,
    choiceValues.join('\n'),
    renderNativeMethods(list),
    renderDispatch(list),
    renderParameterAccess(config, names),
    renderStateAccess(state, names),
    `/// The controller's descriptor (\`describeController()\`): its methods,`,
    `/// types, parameters and state, which the runtime checks against its own.`,
    `pub(crate) const DESCRIPTOR: &[u8] = &[`,
    byteLiterals(descriptor, '    '),
    `];`,
  ].join('\n');
}
