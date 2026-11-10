/**
 * Test support: a parameter store from declarations, resolved and compiled as
 * `soundor gen` does for a project, so client tests run the real behavior.
 */

import { resolveConfig, semanticsInputs } from '@soundor/runtime-sdk';
import { compileJsFunction } from '@soundor/runtime-sdk/expression/js';

import { webManifest } from '../../codegen';
import {
  createParameterStore,
  type ParameterBehavior,
  type ParameterStore,
} from '../parameters';

/** The declarations' manifest infos and generated behavior. */
export function compileParameters(declarations: Record<string, unknown>) {
  const config = resolveConfig({
    plugin: { id: 'com.example.test', name: 'Test' },
    runtimes: [],
    parameters: declarations,
  });
  const behaviors = config.parameters.map((parameter): ParameterBehavior => {
    const { semantics } = parameter;
    const inputs = semanticsInputs(semantics.valueType);
    const fn = (expression: unknown, i: object) =>
      compileJsFunction(expression, i as never) as never;
    return {
      toValue: fn(semantics.toValue, inputs.toValue),
      toNormalized: fn(semantics.toNormalized, inputs.toNormalized),
      constrain: fn(semantics.constrain, inputs.constrain),
      format: fn(semantics.format, inputs.format),
      parse: fn(semantics.parse, inputs.parse),
    };
  });
  return { infos: webManifest(config).parameters, behaviors };
}

/** A store of the declared parameters. */
export function storeOf(declarations: Record<string, unknown>): ParameterStore {
  const { infos, behaviors } = compileParameters(declarations);
  return createParameterStore(infos, behaviors);
}
