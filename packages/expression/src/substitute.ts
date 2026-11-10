import type { Expression, ExpressionNode } from './ast';

/**
 * `node` with each input named in `replacements` replaced by that
 * expression, of the same type. The variables `node` binds are renamed (with
 * `suffix`), so they never capture a variable of a replacement.
 */
export function substituteInputs<T extends Expression>(
  node: T,
  replacements: Readonly<Record<string, Expression>>,
  suffix = 's',
): T {
  return rewrite(node, replacements, suffix) as T;
}

function rewrite(
  node: ExpressionNode,
  replacements: Readonly<Record<string, Expression>>,
  suffix: string,
): ExpressionNode {
  const go = (child: ExpressionNode) => rewrite(child, replacements, suffix);
  let result: ExpressionNode;
  switch (node.kind) {
    case 'literal':
      return node;
    case 'input': {
      const replacement = replacements[node.name];
      if (replacement === undefined) return node;
      if (replacement.type !== node.type)
        throw new TypeError(
          `Input '${node.name}' is a '${node.type}', its replacement a '${replacement.type}'`,
        );
      return replacement;
    }
    case 'variable':
      result = { ...node, name: `${node.name}_${suffix}` };
      break;
    case 'unary':
    case 'convert':
    case 'fixed':
    case 'parse':
    case 'isNull':
      result = { ...node, operand: go(node.operand) } as ExpressionNode;
      break;
    case 'binary':
      result = { ...node, left: go(node.left), right: go(node.right) };
      break;
    case 'if':
      result = {
        ...node,
        condition: go(node.condition),
        then: go(node.then),
        else: go(node.else),
      };
      break;
    case 'concat':
      result = { ...node, operands: Object.freeze(node.operands.map(go)) };
      break;
    case 'coalesce':
      result = {
        ...node,
        operand: go(node.operand),
        fallback: go(node.fallback),
      };
      break;
    case 'map':
      result = {
        ...node,
        operand: go(node.operand),
        variable: `${node.variable}_${suffix}`,
        body: go(node.body),
      };
      break;
    case 'let':
      result = {
        ...node,
        value: go(node.value),
        variable: `${node.variable}_${suffix}`,
        body: go(node.body),
      };
      break;
  }
  return Object.freeze(result);
}
