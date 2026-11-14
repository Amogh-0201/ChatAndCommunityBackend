import { runProfile } from './runner.mjs';

await runProfile({
  name: 'stress',
  description: 'Raises the offered connection-request rate across four waves.',
  rounds: [1_000, 2_000, 4_000, 4_000].map((rate) => ({
    attempts: rate,
    requestsPerSecond: rate,
    holdSeconds: 3,
  })),
});
