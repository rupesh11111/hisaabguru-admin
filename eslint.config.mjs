// eslint-config-next v16 ships a native flat config array — no FlatCompat needed.
import next from 'eslint-config-next';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...next,
];

export default config;
