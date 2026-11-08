// Guard the agreed boundary: the homepage may change, main's other modules must not.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const git = process.env.GIT_BIN || 'git';
const base = process.env.HOMEPAGE_BASE_REF || '4941b5bb668d9c6725b12a58b2c5c229e934c894';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const original = file => execFileSync(git, ['show', `${base}:${file}`], {cwd:root, encoding:'utf8'});
const baseline = original('app.js');
const current = read('app.js');
const homePattern = /function home\(\)\{[\s\S]*?(?=function agentPanel\()/;
const withoutHomepage = current.replace(/\/\/ BEGIN HOMEPAGE-ONLY MODULE[\s\S]*?\/\/ END HOMEPAGE-ONLY MODULE\n\n/, '');
assert.equal(withoutHomepage.replace(homePattern, ''), baseline.replace(homePattern, ''), 'Non-home JS must match main exactly');
const css = read('styles.css'), baseCss = original('styles.css');
assert.ok(css.startsWith(baseCss), 'Existing main styles must remain byte-for-byte unchanged');
const addedCss = css.slice(baseCss.length).replace(/\/\*[\s\S]*?\*\//g, '');
for (const match of addedCss.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
  for (const selector of match[1].trim().split(',')) {
    assert.ok(selector.trim().startsWith('.home-page '), `Unscoped selector: ${selector}`);
  }
}
// The recipe integration deliberately extends server routes and HTML script tags.
// Keep the original homepage scope contract for the protected main files.
if (fs.existsSync(path.join(root, 'recipe-host.js'))) {
  const integratedBase = process.env.COMPATIBILITY_BASE_REF || '572091eb076539b0eb4ed81a9e82536796d4e61d';
  for (const file of ['app.js', 'styles.css', 'seed.json', 'food_knowledge.json', 'scripts/build_food_knowledge.rb']) {
    assert.equal(read(file), execFileSync(git, ['show', `${integratedBase}:${file}`], {cwd:root,encoding:'utf8'}), `${file} must match protected main`);
  }
} else {
const staticRoute = "    elsif req.path.match?(%r{\\A/assets/recipes/[a-z0-9-]+\\.jpg\\z})\n      file_path = File.join(ROOT, req.path.sub(%r{\\A/}, ''))\n";
assert.equal(read('server.rb').replace(staticRoute, '').replace("file_path.end_with?('.jpg') ? 'image/jpeg' : ", ''), original('server.rb'), 'Only homepage image delivery may change on the server');
for (const file of ['index.html', '.env.example', '.gitignore', 'seed.json', 'food_knowledge.json', 'scripts/build_food_knowledge.rb']) {
  assert.equal(read(file), original(file), `${file} must match main`);
}
}
const seed = JSON.parse(read('seed.json'));
seed.recipes = [{id:'recipe-test', title:'番茄鸡蛋', imageEmoji:'🍳', imageKey:'tomato-egg', tags:['临期优先'], duration:15, difficulty:'简单', servings:2, ingredients:[{name:'番茄',quantity:2,unit:'个',available:true}], steps:['烹饪示例']}];
seed.favorites = ['recipe-test'];
const knowledge = JSON.parse(read('food_knowledge.json')).foods;
function context(code) {
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, {innerHTML:'', hidden:false, listeners:[], addEventListener(type,handler){this.listeners.push({type,handler});}, classList:{add(){},remove(){},toggle(){}}});
    return elements.get(id);
  };
  const sandbox = vm.createContext({document:{getElementById,addEventListener(){},querySelectorAll(){return []},querySelector(){return null}}, console, URL, Date, setTimeout(){}, clearTimeout(){}});
  vm.runInContext(code.slice(0, code.lastIndexOf('\nloadState().catch(')), sandbox);
  vm.runInContext(`state=${JSON.stringify(seed)};foodKnowledge=${JSON.stringify(knowledge)};`, sandbox);
  sandbox.__app = getElementById('app');
  return sandbox;
}
const before = context(baseline), after = context(current);
const same = (expression, setup='') => {
  for (const c of [before,after]) vm.runInContext(setup,c);
  assert.equal(vm.runInContext(expression,after),vm.runInContext(expression,before),expression);
};
for (const location of ['冷藏','冷冻']) same('inventory()', `inventoryLocation=${JSON.stringify(location)};`);
for (const category of ['全部','蔬果','肉蛋','海鲜','其他']) same('inventoryList(inventoryLocation)', `inventoryCategory=${JSON.stringify(category)};`);
same('inventory()', "inventoryManageMode=true;selectedInventoryIds=new Set(['inv-egg']);");
for (const view of ['manual','photo']) same('inventory()',`inventoryEntryView=${JSON.stringify(view)};`);
for (const mode of ['临期优先','现有食材','补购模式']) same('recipes()',`recipeMode=${JSON.stringify(mode)};`);
same('recipes()', 'selectedRecipe=state.recipes[0];');
same('profile()');
same('shopping()');
for (const tab of ['inventory','recipes','profile','shopping']) {
  same('headerContent(); header.innerHTML',`currentTab=${JSON.stringify(tab)};inventoryEntryView=null;selectedRecipe=null;returnTab='profile';`);
}
const beforeState=vm.runInContext('JSON.stringify(state)',after);
vm.runInContext("currentTab='home';home();",after);
assert.equal(vm.runInContext('JSON.stringify(state)',after),beforeState,'Viewing home must not mutate inventory, recipes or profile data');
assert.match(vm.runInContext('home()',after),/class="home-page"/);
assert.match(vm.runInContext('home()',after),/assets\/recipes\/tomato-egg.jpg/);
async function testHomepageShopping() {
  const c = context(current);
  const click = c.__app.listeners.find(listener => listener.type === 'click').handler;
  const button = {disabled:false};
  const event = {target:{closest(){return button;}}};
  vm.runInContext("currentTab='inventory';persist=async()=>{throw new Error('must not run')}",c);
  const initial = vm.runInContext('JSON.stringify(state)',c);
  await click(event);
  assert.equal(vm.runInContext('JSON.stringify(state)',c),initial,'Homepage handler must ignore other tabs');
  vm.runInContext("currentTab='home';persist=async()=>{throw new Error('offline')}",c);
  await click(event);
  assert.equal(vm.runInContext('JSON.stringify(state)',c),initial,'Failed homepage save must roll back additions');
  assert.equal(button.disabled,false,'Retry must be available after save failure');
  vm.runInContext('persist=async()=>{}',c);
  await click(event);
  const result = JSON.parse(vm.runInContext('JSON.stringify(state)',c));
  assert.ok(result.shopping.length>seed.shopping.length,'Homepage shopping suggestion must add items');
  for (const field of ['inventory','recipes','profile','preferences','favorites','history']) assert.deepEqual(result[field],seed[field],`${field} must not change when adding a suggestion`);
}
testHomepageShopping().then(()=>console.log('PASS: non-home main code/styles and page outputs preserved; home renders read-only; suggestions respect tab boundaries and roll back failed saves.')).catch(error=>{console.error(error);process.exitCode=1;});
