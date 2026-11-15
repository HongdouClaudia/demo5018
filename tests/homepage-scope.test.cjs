// Main owns these pages and their shared food knowledge. Recipe integration must preserve them.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const base = process.env.COMPATIBILITY_BASE_REF || '5ece0a19077fc23b208cc94efe59cec806bb8980';
const git = process.env.GIT_BIN || 'git';
const protectedFiles = [
  'app.js', 'styles.css', 'index.html', 'seed.json',
  'food_knowledge.json', 'food_knowledge_supplement.json', 'scripts/build_food_knowledge.rb'
];

for (const file of protectedFiles) {
  const expected = execFileSync(git, ['show', `${base}:${file}`], {cwd:root});
  const actual = fs.readFileSync(path.join(root, file));
  assert.ok(actual.equals(expected), `${file} must match GitHub main (${base})`);
}

console.log('PASS: homepage, inventory, profile and shared food knowledge match the verified GitHub main.');
