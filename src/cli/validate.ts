import { readResearch, printError } from './read.js';

try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0]!.startsWith('--')) throw new Error('Usage: npm run validate -- <research.json>');
  const record = await readResearch(args[0]!);
  console.log(`Valid ${record.schema_version} record ${record.record_id}: ${record.forms.length} forms. ` +
    'Structural validation does not verify historical claims.');
} catch (error) { printError(error); }
