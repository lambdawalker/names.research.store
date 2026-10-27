import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// CI builds first; inspect exactly what npm will distribute, including ignored dist.
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--dry-run', '--json'], { encoding: 'utf8' }));
const files = new Set(packed.files.map(file => file.path));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const required = Object.values(manifest.exports).flatMap(entry => Object.values(entry).map(path => path.replace(/^\.\//, '')));
required.push('dist/domain/forms.js', 'dist/domain/research.js', 'dist/inputs.js');
const missing = required.filter(path => !files.has(path));
if (missing.length) throw new Error('Package is missing runtime contracts or entry points: ' + missing.join(', '));
console.log('Package includes all exported entry points and validation contracts.');
