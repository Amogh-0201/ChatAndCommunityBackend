import { runProfile } from './runner.mjs';

await runProfile({
  name: 'load',
  description:
    'Sends eleven independent 1,000-connection waves at 1,000 requests per second.',
  rounds: Array.from({ length: 11 }, () => ({
    attempts: 1_000,
    requestsPerSecond: 1_000,
    holdSeconds: 2,
  })),
});
