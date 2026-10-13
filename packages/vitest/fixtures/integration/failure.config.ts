import base from './vitest.config';
export default {
  ...base,
  test: { ...base.test, include: ['failure.case.ts'] },
};
