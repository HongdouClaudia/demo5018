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
vm.runInContext(`
  foodKnowledge=[];
  state={inventory:[
    {id:'fresh-new',name:'苹果',location:'冷藏',purchaseDate:'2026-11-14',quantity:1,unit:'个'},
    {id:'soon-middle',name:'香蕉',location:'冷藏',purchaseDate:'2026-11-12',quantity:1,unit:'根'},
    {id:'unsafe-old',name:'菠菜',location:'冷藏',purchaseDate:'2026-11-01',quantity:1,unit:'把'}
  ]};
`, context);

const order = sort => vm.runInContext(`inventorySort=${JSON.stringify(sort)};state.inventory.slice().sort(compareInventoryItems).map(item=>item.id).join(',')`, context);
assert.equal(order('date'), 'fresh-new,soon-middle,unsafe-old');
assert.equal(order('freshness'), 'fresh-new,soon-middle,unsafe-old');

const html = vm.runInContext("inventorySort='freshness';inventory()", context);
assert.match(html, /class="inventory-toolbar"/);
assert.ok(html.indexOf('data-category="其他"') < html.indexOf('data-action="inventory-sort"'));
assert.match(html, /<option value="freshness" selected>新鲜度<\/option>/);
assert.match(html, /<option value="date" >存入日期<\/option>/);
assert.doesNotMatch(html, /正序|倒序/);

console.log('PASS: inventory sort defaults to newest date or fresh-to-unsafe and renders after 其他.');
