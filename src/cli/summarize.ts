import { summarizeResearch } from '../domain/summary.js';
import { readResearch, printError } from './read.js';

try {
  const args = process.argv.slice(2);
  if (!args[0] || args[0].startsWith('--') || args.length > 2 ||
      (args[1] !== undefined && args[1] !== '--include-unverified')) {
    throw new Error('Usage: npm run summarize -- <research.json> [--include-unverified]');
  }
  const record = await readResearch(args[0]);
  console.log(JSON.stringify(summarizeResearch(record, { includeUnverified: args[1] === '--include-unverified' }), null, 2));
} catch (error) { printError(error); }
