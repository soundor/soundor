// Throws while being evaluated to exercise the load-failure path.
throw new Error('boom');

// oxlint-disable-next-line no-unreachable
export default { runtimes: [], parameters: [] };
