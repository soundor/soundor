import {
  DriverError,
  type Driver,
  type InputResult,
  type Locator,
  type MouseButton,
} from '@soundor/driver';
import { defineCommand } from 'citty';

import { formatNode, formatTargets, formatTree } from '../driver/format';
import {
  connectionArgs,
  numberOption,
  required,
  runDriverCommand,
  type ConnectionArgs,
} from '../driver/run';

/** The query options of commands that act on one node. */
const queryArgs = {
  debugId: {
    type: 'positional',
    required: false,
    description: 'The debugId of the node',
  },
  role: {
    type: 'string',
    description: 'Find the node by accessibility role instead (button, …)',
  },
  name: {
    type: 'string',
    description: 'With --role: its accessible name',
  },
  text: {
    type: 'string',
    description: 'Find the text or input node showing this text instead',
  },
} as const;

interface QueryArgs {
  debugId?: string | undefined;
  role?: string | undefined;
  name?: string | undefined;
  text?: string | undefined;
}

/** The locator the query options describe: exactly one kind of query. */
function locator(args: QueryArgs): (driver: Driver) => Locator {
  const found = optionalLocator(args);
  if (!found)
    throw new DriverError(
      'INVALID_OPTIONS',
      'Name the node by one of: a debugId, --role (with --name), or --text',
    );
  return found;
}

/** The locator of the query options, if they name a node. */
function optionalLocator(
  args: QueryArgs,
): ((driver: Driver) => Locator) | undefined {
  if (
    args.debugId === undefined &&
    args.role === undefined &&
    args.text === undefined &&
    args.name === undefined
  )
    return undefined;
  const kinds = [args.debugId, args.role, args.text].filter(
    (value) => value !== undefined,
  );
  if (kinds.length !== 1)
    throw new DriverError(
      'INVALID_OPTIONS',
      'Name the node by one of: a debugId, --role (with --name), or --text',
    );
  if (args.name !== undefined && args.role === undefined)
    throw new DriverError('INVALID_OPTIONS', '--name goes with --role');
  for (const option of ['debugId', 'role', 'name', 'text'] as const)
    if (args[option] === '')
      throw new DriverError('INVALID_OPTIONS', `${option} is empty`);
  if (args.debugId !== undefined) {
    const debugId = args.debugId;
    return (driver) => driver.getByDebugId(debugId);
  }
  if (args.role !== undefined) {
    const role = args.role;
    const options = args.name === undefined ? {} : { name: args.name };
    return (driver) => driver.getByRole(role, options);
  }
  const text = args.text!;
  return (driver) => driver.getByText(text);
}

const targets = defineCommand({
  meta: {
    name: 'targets',
    description: 'List the Soundor instances connected to the session',
  },
  args: connectionArgs,
  async run({ args }) {
    await runDriverCommand(args as ConnectionArgs, {
      parse: () => undefined,
      work: (driver) => driver.targets(),
      print: formatTargets,
    });
  },
});

const tree = defineCommand({
  meta: {
    name: 'tree',
    description: "Print the target's native UI tree",
  },
  args: connectionArgs,
  async run({ args }) {
    await runDriverCommand(args as ConnectionArgs, {
      parse: () => undefined,
      work: (driver) => driver.getTree(),
      print: formatTree,
    });
  },
});

const inspect = defineCommand({
  meta: {
    name: 'inspect',
    description:
      "Print a node's details: bounds, properties, layout, styles, accessibility",
  },
  args: { ...queryArgs, ...connectionArgs },
  async run({ args }) {
    await runDriverCommand(args as ConnectionArgs, {
      parse: () => locator(args),
      work: (driver, find) => find(driver).getNode(),
      print: formatNode,
    });
  },
});

/** What an input command reached, in a line. */
function described(action: string) {
  return (result: InputResult) =>
    `${action}: ${result.handled ? 'handled' : 'not handled'}${result.node ? ` (node ${result.node.id})` : ''}`;
}

const buttonArg = {
  button: {
    type: 'string',
    description: 'The mouse button: left (default), middle or right',
  },
} as const;

function button(value: unknown): MouseButton | undefined {
  if (value === undefined) return undefined;
  if (value === 'left' || value === 'middle' || value === 'right') return value;
  throw new DriverError('INVALID_OPTIONS', '--button is left, middle or right');
}

const click = defineCommand({
  meta: {
    name: 'click',
    description:
      'Click a node once it is actionable (visible, enabled, not covered), through the engine’s input dispatch',
  },
  args: { ...queryArgs, ...buttonArg, ...connectionArgs },
  async run({ args }) {
    await runDriverCommand(args as ConnectionArgs, {
      parse: () => ({ find: locator(args), button: button(args.button) }),
      work: (driver, { find, button }) =>
        find(driver).click(button ? { button } : {}),
      print: described('clicked'),
    });
  },
});

const hover = defineCommand({
  meta: {
    name: 'hover',
    description: 'Move the pointer over a node once it is actionable',
  },
  args: { ...queryArgs, ...connectionArgs },
  async run({ args }) {
    await runDriverCommand(args as ConnectionArgs, {
      parse: () => locator(args),
      work: (driver, find) => find(driver).hover(),
      print: described('hovered'),
    });
  },
});

const focus = defineCommand({
  meta: {
    name: 'focus',
    description: 'Give a focusable node keyboard focus',
  },
  args: { ...queryArgs, ...connectionArgs },
  async run({ args }) {
    await runDriverCommand(args as ConnectionArgs, {
      parse: () => locator(args),
      work: async (driver, find) => {
        await find(driver).focus();
        return { focused: true };
      },
      print: () => 'focused',
    });
  },
});

const move = defineCommand({
  meta: {
    name: 'move',
    description: 'Move the pointer to a point of the view, in logical pixels',
  },
  args: {
    x: { type: 'string', description: 'From the left of the view' },
    y: { type: 'string', description: 'From the top of the view' },
    ...connectionArgs,
  },
  async run({ args }) {
    await runDriverCommand(args as ConnectionArgs, {
      parse: () => ({
        x: numberOption(args.x, '--x'),
        y: numberOption(args.y, '--y'),
      }),
      work: (driver, { x, y }) => driver.pointer.move(x, y),
      print: described('moved'),
    });
  },
});

const drag = defineCommand({
  meta: {
    name: 'drag',
    description:
      'Press on a node, move by --dx/--dy in steps, and release (a knob, a slider)',
  },
  args: {
    ...queryArgs,
    dx: { type: 'string', description: 'Logical pixels to the right' },
    dy: { type: 'string', description: 'Logical pixels down (negative: up)' },
    steps: { type: 'string', description: 'Pointer moves on the way (5)' },
    ...connectionArgs,
  },
  async run({ args }) {
    await runDriverCommand(args as ConnectionArgs, {
      parse: () => ({
        find: locator(args),
        deltaX: numberOption(args.dx, '--dx', 0),
        deltaY: numberOption(args.dy, '--dy', 0),
        steps: numberOption(args.steps, '--steps', 5),
      }),
      work: (driver, { find, ...options }) => find(driver).drag(options),
      print: described('dragged'),
    });
  },
});

const scroll = defineCommand({
  meta: {
    name: 'scroll',
    description:
      'Scroll the wheel over a node, or at --x/--y, by --dx/--dy pixels',
  },
  args: {
    ...queryArgs,
    x: { type: 'string', description: 'Where, without a node' },
    y: { type: 'string', description: 'Where, without a node' },
    dx: { type: 'string', description: 'Pixels to scroll right' },
    dy: { type: 'string', description: 'Pixels to scroll down (negative: up)' },
    ...connectionArgs,
  },
  async run({ args }) {
    await runDriverCommand(args as ConnectionArgs, {
      parse: () => {
        const find = optionalLocator(args);
        const deltas = {
          deltaX: numberOption(args.dx, '--dx', 0),
          deltaY: numberOption(args.dy, '--dy', 0),
        };
        if (find) return { find, ...deltas };
        return {
          x: numberOption(args.x, '--x'),
          y: numberOption(args.y, '--y'),
          ...deltas,
        };
      },
      work: (driver, params) =>
        'find' in params
          ? params.find(driver).scroll({
              deltaX: params.deltaX,
              deltaY: params.deltaY,
            })
          : driver.pointer.wheel(params),
      print: described('scrolled'),
    });
  },
});

const focusTarget = {
  'debug-id': {
    type: 'string',
    description: 'Focus the node with this debugId first',
  },
} as const;

const key = defineCommand({
  meta: {
    name: 'key',
    description:
      'Press a key in the focused node: Enter, ArrowUp, a, Control+a, Shift+Tab',
  },
  args: {
    key: {
      type: 'positional',
      required: false,
      description: 'A KeyboardEvent key, with modifiers joined by +',
    },
    ...focusTarget,
    ...connectionArgs,
  },
  async run({ args }) {
    await runDriverCommand(args as ConnectionArgs, {
      parse: () => ({
        key: required(args.key, 'the key'),
        debugId: args['debug-id'],
      }),
      work: (driver, { key, debugId }) =>
        debugId === undefined
          ? driver.keyboard.press(key)
          : driver.getByDebugId(debugId).press(key),
      print: described('pressed'),
    });
  },
});

const type = defineCommand({
  meta: {
    name: 'type',
    description: 'Type text into the focused node, a key press per character',
  },
  args: {
    text: {
      type: 'positional',
      required: false,
      description: 'The text',
    },
    ...focusTarget,
    ...connectionArgs,
  },
  async run({ args }) {
    await runDriverCommand(args as ConnectionArgs, {
      parse: () => ({
        text: required(args.text, 'the text'),
        debugId: args['debug-id'],
      }),
      work: async (driver, { text, debugId }) => {
        if (debugId === undefined) await driver.keyboard.type(text);
        else await driver.getByDebugId(debugId).type(text);
        return { typed: [...text].length };
      },
      print: ({ typed }) => `typed ${typed} characters`,
    });
  },
});

export const driverCommand = defineCommand({
  meta: {
    name: 'driver',
    description:
      "Soundor Driver: inspect and control a running plugin's native UI through its DevTools session",
  },
  subCommands: {
    targets,
    tree,
    inspect,
    click,
    hover,
    focus,
    move,
    drag,
    scroll,
    key,
    type,
  },
});
