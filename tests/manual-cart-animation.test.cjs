const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const elements = new Map();
const getElementById = id => {
  if (!elements.has(id)) elements.set(id, {innerHTML:'', hidden:false, addEventListener(){}, classList:{add(){},remove(){},toggle(){}}});
  return elements.get(id);
};
const context = vm.createContext({
  document:{getElementById,addEventListener(){},querySelectorAll(){return []},querySelector(){return null}},
  console, URL, Date, setTimeout(){}, clearTimeout(){}, requestAnimationFrame(callback){callback();}
});
vm.runInContext(code.slice(0, code.lastIndexOf('\nloadState().catch(')), context);
vm.runInContext("foodKnowledge=[];manualCartExpanded=true;manualEntryCart=[{id:'1',name:'苹果',quantity:1,unit:'个',location:'冷藏'},{id:'2',name:'香蕉',quantity:2,unit:'根',location:'冷藏'},{id:'3',name:'牛奶',quantity:1,unit:'盒',location:'冷藏'}]", context);
const html = vm.runInContext('manualCartHTML()', context);

assert.match(html, /manual-cart-icon-wrap"><span class="manual-cart-icon">🧺<\/span><strong class="manual-cart-count" aria-live="polite" aria-atomic="true"><b>3<\/b><\/strong><\/span><span class="manual-cart-copy"><span class="manual-cart-label">食材待录入/);
assert.match(html, /class="manual-cart-icon">🧺/);
assert.match(css, /@keyframes manual-cart-count-pop/);
assert.match(css, /@keyframes manual-cart-highlight/);
assert.match(css, /prefers-reduced-motion:reduce/);
assert.match(code, /setTimeout\(\(\)=>cart\.classList\.remove\('just-added'\),820\)/);
assert.match(code, /function flyManualCountToCart\(origin,count\)/);
assert.match(code, /manualEntryFlightOrigin=\{left:rect\.left,top:rect\.top,width:rect\.width,height:rect\.height\}/);
assert.match(css, /\.manual-cart-fly-count\{/);
assert.match(html, /data-cart-quantity="1" data-integer-step type="number" min="1" step="any"/);
assert.equal(vm.runInContext('steppedManualCartQuantity(1,-1)', context),1);
assert.equal(vm.runInContext('steppedManualCartQuantity(1.5,1)', context),2);
assert.equal(vm.runInContext('steppedManualCartQuantity(1.5,-1)', context),1);

console.log('PASS: manual cart emphasizes the live item count and provides motion-safe add feedback.');
