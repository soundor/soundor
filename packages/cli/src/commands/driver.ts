import { DriverError, type Driver, type Locator } from '@soundor/driver';
import { defineCommand } from 'citty';

import { formatNode, formatTargets, formatTree } from '../driver/format';
import {
  connectionArgs,
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

export const driverCommand = defineCommand({
  meta: {
    name: 'driver',
    description:
      "Soundor Driver: inspect a running plugin's native UI through its DevTools session",
  },
  subCommands: { targets, tree, inspect },
});
