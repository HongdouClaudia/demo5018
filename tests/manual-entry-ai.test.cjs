const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const elements = new Map();
const getElementById = id => {
  if (!elements.has(id)) elements.set(id, {innerHTML:'', hidden:false, addEventListener(){}, classList:{add(){},remove(){},toggle(){}}});
  return elements.get(id);
};
const context = vm.createContext({
  document:{getElementById,addEventListener(){},querySelectorAll(){return []},querySelector(){return null}},
  console, URL, Date, setTimeout(){}, clearTimeout(){}
});
vm.runInContext(code.slice(0, code.lastIndexOf('\nloadState().catch(')), context);
vm.runInContext("state={inventory:[]};foodKnowledge=[];currentTab='inventory';inventoryEntryView='manual';manualEntrySearch='不存在的食材';headerContent()", context);

const headerHtml = elements.get('app-header').innerHTML;
const pageHtml = vm.runInContext('manualInventoryEntry()', context);
assert.match(headerHtml, /data-action="open-ai-entry">✦ AI录入<\/button>/);
assert.doesNotMatch(headerHtml, /手动录入/);
assert.match(pageHtml, /data-action="open-ai-entry">✦ AI录入<\/button>/);
assert.doesNotMatch(pageHtml, /人工录入/);

console.log('PASS: both manual-entry page fallback actions open AI entry.');
