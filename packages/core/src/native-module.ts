/**
 * JavaScript in the form Soundor's native runtime (`@soundor/juce-runtime`)
 * runs it: Hermes's interpreter, from bytecode compiled at build time
 * (hermesc) or, in development, from source.
 *
 * - **Modules.** Hermes has no ES modules. A module's file is a script whose
 *   value is its module function, `(function (exports, require, module) {
 *   ... })`, `async` when the module awaits at top level. The runtime calls
 *   it with a `require` that resolves `soundor:*` and the plugin's own
 *   modules; `import()` becomes a `require` in a promise, `import.meta` is
 *   `module.meta` (`{ url }`). Exports are CommonJS's: a namespace object
 *   whose bindings are copied when the exporting module first runs.
 * - **Syntax.** What this Hermes compiles only experimentally or not at all
 *   is lowered: classes with their fields, private members and static
 *   blocks, `let`/`const` block scoping, async functions and generators
 *   (into generators) and `for await`. Everything else (arrow functions,
 *   destructuring, generators, optional chaining...) Hermes runs as it is.
 *   Private members become properties keyed by symbols of their own,
 *   unchecked: fast, but visible to Object.getOwnPropertySymbols(), and
 *   reading one on an object without it gives undefined, not a TypeError.
 */

import {
  transformAsync,
  type InputOptions,
  type PluginAPI,
  type PluginObject,
  type types,
} from '@babel/core';
import asyncGeneratorFunctions from '@babel/plugin-transform-async-generator-functions';
import asyncToGenerator from '@babel/plugin-transform-async-to-generator';
import blockScoping from '@babel/plugin-transform-block-scoping';
import classProperties from '@babel/plugin-transform-class-properties';
import classStaticBlock from '@babel/plugin-transform-class-static-block';
import classes from '@babel/plugin-transform-classes';
import dynamicImport from '@babel/plugin-transform-dynamic-import';
import modulesCommonjs from '@babel/plugin-transform-modules-commonjs';
import privateMethods from '@babel/plugin-transform-private-methods';
import privatePropertyInObject from '@babel/plugin-transform-private-property-in-object';

export interface NativeModuleOptions {
  /** The file's name in diagnostics and the source map. */
  readonly filename?: string;
  /** Produce a source map of the result (to `inputSourceMap`'s sources). */
  readonly sourceMap?: boolean;
  /** The map of `code` to its own sources, composed into the result's. */
  readonly inputSourceMap?: Exclude<InputOptions['inputSourceMap'], boolean>;
  /** No whitespace or comments in the result. */
  readonly compact?: boolean;
  /** Keep every statement on its line in `code`, so lines still match it. */
  readonly retainLines?: boolean;
}

export interface NativeModuleResult {
  readonly code: string;
  readonly map?: object;
}

/** The syntax lowering, in the order Babel needs (class members first). */
const LOWERING = [
  classStaticBlock,
  classProperties,
  privateMethods,
  privatePropertyInObject,
  classes,
  blockScoping,
  asyncGeneratorFunctions,
  asyncToGenerator,
];

/**
 * Wraps the CommonJS module Babel made into the module function the runtime
 * calls, and maps `import.meta` to `module.meta`. Runs after
 * transform-modules-commonjs, which rewrites imports and exports when it
 * leaves the program.
 */
function moduleFunction({ types: t }: PluginAPI): PluginObject {
  let topLevelAwait = false;
  return {
    name: 'soundor:native-module',
    pre() {
      topLevelAwait = false;
    },
    visitor: {
      MetaProperty(path) {
        if (
          path.node.meta.name !== 'import' ||
          path.node.property.name !== 'meta'
        )
          return;
        const program = path.scope.getProgramParent();
        const known = program.getData('soundor:importMeta') as
          | types.Identifier
          | undefined;
        const meta = known ?? program.generateUidIdentifier('importMeta');
        if (known === undefined) {
          program.setData('soundor:importMeta', meta);
          program.push({
            id: meta,
            init: t.memberExpression(
              t.identifier('module'),
              t.identifier('meta'),
            ),
            kind: 'var',
            unique: true,
          });
        }
        path.replaceWith(t.identifier(meta.name));
      },
      AwaitExpression(path) {
        if (path.getFunctionParent() === null) topLevelAwait = true;
      },
      ForOfStatement(path) {
        if (path.node.await && path.getFunctionParent() === null)
          topLevelAwait = true;
      },
      Program: {
        exit(path) {
          // `_classPrivateFieldLooseBase(object, key)[key]` reads `object[key]`
          // after checking that `object` has the private member. In
          // Hermes's interpreter the call costs more than the access; without
          // it, misuse on another object reads undefined instead of
          // throwing.
          path.traverse({
            CallExpression(call) {
              const { callee, arguments: args } = call.node;
              if (
                t.isIdentifier(callee) &&
                /^_classPrivateFieldLooseBase\d*$/.test(callee.name) &&
                args.length === 2 &&
                t.isExpression(args[0])
              ) {
                call.replaceWith(args[0]);
              }
            },
          });
          const { body, directives } = path.node;
          const wrapper = t.functionExpression(
            null,
            [
              t.identifier('exports'),
              t.identifier('require'),
              t.identifier('module'),
            ],
            t.blockStatement(body, directives),
            false,
            topLevelAwait,
          );
          path.node.body = [
            t.expressionStatement(t.parenthesizedExpression(wrapper)),
          ];
          path.node.directives = [];
        },
      },
    },
  };
}

/** Turns an ES module into the module form of Soundor's native runtime. */
export async function toNativeModule(
  code: string,
  options: NativeModuleOptions = {},
): Promise<NativeModuleResult> {
  const result = await transformAsync(code, {
    babelrc: false,
    configFile: false,
    browserslistConfigFile: false,
    sourceType: 'module',
    filename: options.filename ?? 'module.js',
    sourceMaps: options.sourceMap ?? false,
    inputSourceMap: options.inputSourceMap ?? false,
    compact: options.compact ?? false,
    comments: !(options.compact ?? false),
    retainLines: options.retainLines ?? false,
    // Private fields and methods as properties keyed by symbols of their
    // own, which Hermes reads as fast as any property (the spec's WeakMaps
    // cost a lookup per access): not private from reflection
    // (Object.getOwnPropertySymbols), which code that relies on it notices.
    assumptions: { privateFieldsAsSymbols: true },
    plugins: [
      ...LOWERING,
      dynamicImport,
      // Imports that may be cyclic or reassigned read through the namespace,
      // as ES modules' live bindings do.
      [modulesCommonjs, { importInterop: 'babel' }],
      moduleFunction,
    ],
  });
  if (result?.code == null) {
    throw new Error(`${options.filename ?? 'module'}: Babel produced no code`);
  }
  return {
    code: result.code,
    ...(result.map == null ? {} : { map: result.map as object }),
  };
}
