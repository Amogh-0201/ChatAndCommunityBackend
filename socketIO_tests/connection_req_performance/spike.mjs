import { runProfile } from './runner.mjs';

await runProfile({
  name: 'spike',
  description:
    'Sends two 1,000/s waves, spikes to 8,000/s, then returns to 1,000/s.',
  rounds: [1_000, 1_000, 8_000, 1_000].map((rate) => ({
    attempts: rate,
    requestsPerSecond: rate,
    holdSeconds: 4,
  })),
});
