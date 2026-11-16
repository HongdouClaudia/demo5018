const app = document.getElementById('app');
const header = document.getElementById('app-header');
const modalLayer = document.getElementById('modal-layer');
const toastNode = document.getElementById('toast');
let state = null;
let currentTab = 'home';
let recipeMode = '临期优先';
let shoppingTab = 'pending';
let selectedRecipe = null;
let agentResult = null;
let agentLoading = false;
let agentQuickMode = '';
let recommendationShoppingDraft = [];
let returnTab = null;
let foodKnowledge = [];
let inventoryLocation = '冷藏';
let inventoryCategory = '全部';
let inventorySort = 'date';
let inventoryManageMode = false;
let selectedInventoryIds = new Set();
let inventorySwipeGesture = null;
let inventoryEntryView = null;
let manualEntryCategory = '蔬菜';
let photoPreviewUrl = '';
let cameraStream = null;
let aiEntryDestination = 'inventory';
let manualEntrySearch = '';
let manualEntryCart = [];
let manualEntryFlightOrigin = null;
let manualCartExpanded = false;
let homeContext={city:'',province:'',region:'',weather:'',temperature:null,weatherIcon:'📍',loading:true,error:false};

const icons = {番茄:'🍅',鸡蛋:'🥚',鸡胸肉:'🍗',西兰花:'🥦',大米:'🍚',胡萝卜:'🥕',生抽:'🥣',牛奶:'🥛',香蕉:'🍌'};
const esc = (value='') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const foodIcon = name => findFoodKnowledge(name)?.icon || icons[name] || '🍽️';
const today = new Date().toLocaleDateString('en-CA');
const commonUnits = ['克','斤','个','颗','根','块','片','把','盘','碗','杯','瓶','盒','袋','罐','勺','ml','只','条','份','枚','朵','串','段','节','头','瓣','房','张','包','支','排'];
function findFoodKnowledge(name){return foodKnowledge.find(food=>food.canonical_name===name||food.common_names?.includes(name)||food.name===name||food.aliases.includes(name));}
function inventoryCategoryFor(name){
  const food=findFoodKnowledge(name);
  const tag=food?.category_tag;
  if(['蔬菜','菌菇','水果'].includes(tag))return '蔬果';
  if(['肉类','蛋类'].includes(tag))return '肉蛋';
  if(tag==='海鲜')return '海鲜';
  return '其他';
}
function inventoryAgeDays(item){
  const storedDate=item.purchaseDate||item.createdAt||today;
  const elapsed=Date.parse(`${today}T12:00:00`)-Date.parse(`${storedDate}T12:00:00`);
  return Number.isFinite(elapsed)?Math.max(0,Math.floor(elapsed/86400000)):0;
}
function freshnessFor(item){
  const storageKey=item.location==='冷冻'?'frozen':'refrigerated';
  const standard=findFoodKnowledge(item.name)?.freshness_standard?.[storageKey];
  const fallback=item.location==='冷冻'
    ? {fresh:{max_days:21},consume_soon:{max_days:60}}
    : /炒|炖|烧|煮|蒸|汤|粥|饭|面/.test(item.name)
      ? {fresh:{max_days:1},consume_soon:{max_days:4}}
      : {fresh:{max_days:1},consume_soon:{max_days:4}};
  const rules=standard||fallback;
  const age=inventoryAgeDays(item);
  const calculated=age<=rules.fresh.max_days?{key:'fresh',label:'新鲜'}:age<=rules.consume_soon.max_days?{key:'soon',label:'尽快食用'}:{key:'unsafe',label:'不宜食用'};
  const ai={新鲜:{key:'fresh',label:'新鲜'},尽快食用:{key:'soon',label:'尽快食用'},不宜食用:{key:'unsafe',label:'不宜食用'}}[item.aiFreshness];
  if(!ai)return calculated;
  return {fresh:0,soon:1,unsafe:2}[ai.key]>{fresh:0,soon:1,unsafe:2}[calculated.key]?ai:calculated;
}
function freshnessBadge(item){const freshness=freshnessFor(item);return `<span class="freshness-badge ${freshness.key}">${freshness.label}</span>`;}
function compareInventoryItems(a,b){
  if(inventorySort==='freshness'){
    const freshnessRank={fresh:0,soon:1,unsafe:2};
    const difference=(freshnessRank[freshnessFor(a).key]??3)-(freshnessRank[freshnessFor(b).key]??3);
    if(difference)return difference;
  }
  const left=String(a.purchaseDate||a.createdAt||''),right=String(b.purchaseDate||b.createdAt||'');
  const dateDifference=left.localeCompare(right);
  if(dateDifference)return -dateDifference;
  return String(a.name||'').localeCompare(String(b.name||''),'zh-CN');
}
function inventoryItemGrams(item,canonicalName){
  if(['g','克'].includes(item.unit))return Number(item.quantity);
  const gramsPerUnit=findFoodKnowledge(canonicalName)?.units?.[item.unit];
  return gramsPerUnit?Number(item.quantity)*gramsPerUnit:null;
}
function mergeInventoryItems(items){
  const groups=new Map();
  items.forEach(source=>{
    const canonicalName=findFoodKnowledge(source.name)?.canonical_name||source.name;
    const item={...source,name:canonicalName};
    const key=`${canonicalName}::${item.location||'冷藏'}`;
    const existing=groups.get(key);
    if(!existing){groups.set(key,item);return;}
    if(existing.unit===item.unit){existing.quantity=Number(existing.quantity)+Number(item.quantity);}
    else{
      const existingGrams=inventoryItemGrams(existing,canonicalName);
      const itemGrams=inventoryItemGrams(item,canonicalName);
      if(existingGrams!==null&&itemGrams!==null){existing.quantity=Math.round((existingGrams+itemGrams)*10)/10;existing.unit='g';}
      else{groups.set(`${key}::${item.unit}::${item.id}`,item);return;}
    }
    existing.purchaseDate=[existing.purchaseDate||existing.createdAt,item.purchaseDate||item.createdAt].filter(Boolean).sort()[0]||today;
    existing.createdAt=[existing.createdAt,item.createdAt].filter(Boolean).sort()[0]||today;
    if(item.freshness==='即将到期')existing.freshness='即将到期';
    existing.mergedFromIds=[...new Set([...(existing.mergedFromIds||[existing.id]),...(item.mergedFromIds||[item.id])])];
  });
  const mergedItems=[...groups.values()];
  return {items:mergedItems,changed:JSON.stringify(mergedItems)!==JSON.stringify(items)};
}
function estimatedWeight(item){
  if(['g','克'].includes(item.unit))return '';
  if(Number(item.estimatedGrams)>0)return `约 ${Math.round(Number(item.estimatedGrams))}g`;
  const food=findFoodKnowledge(item.name);
  if(['乳制品','烘焙'].includes(food?.category_tag))return '';
  const perUnit=food?.units?.[item.unit];
  return perUnit?`约 ${Math.round(Number(item.quantity)*perUnit)}g`:'';
}

async function api(url, options={}) {
  const response = await fetch(url, {headers:{'Content-Type':'application/json'}, ...options});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败，请重试。');
  return data;
}

const weatherLabels={0:['☀️','晴'],1:['🌤️','大致晴朗'],2:['⛅','多云'],3:['☁️','阴'],45:['🌫️','有雾'],48:['🌫️','雾凇'],51:['🌦️','小毛毛雨'],53:['🌦️','毛毛雨'],55:['🌧️','较强毛毛雨'],61:['🌦️','小雨'],63:['🌧️','中雨'],65:['🌧️','大雨'],71:['🌨️','小雪'],73:['❄️','中雪'],75:['❄️','大雪'],80:['🌦️','阵雨'],81:['🌧️','较强阵雨'],82:['⛈️','强阵雨'],95:['⛈️','雷雨'],96:['⛈️','雷雨伴冰雹'],99:['⛈️','强雷雨伴冰雹']};
function chineseFestival(date=new Date()){
  const fixed={"1-1":'元旦',"5-1":'劳动节',"10-1":'国庆节'}[`${date.getMonth()+1}-${date.getDate()}`];
  if(fixed)return fixed;
  try{
    const parts=new Intl.DateTimeFormat('en-u-ca-chinese',{month:'numeric',day:'numeric'}).formatToParts(date);
    const month=Number(parts.find(part=>part.type==='month')?.value),day=Number(parts.find(part=>part.type==='day')?.value);
    return {'1-1':'春节','1-15':'元宵节','5-5':'端午节','7-7':'七夕节','8-15':'中秋节','9-9':'重阳节','12-8':'腊八节'}[`${month}-${day}`]||'';
  }catch{return '';}
}
const solarTermNames=['小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种','夏至','小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至'];
const solarTermConstants=[5.4055,20.12,3.87,18.73,5.63,20.646,4.81,20.1,5.52,21.04,5.678,21.37,7.108,22.83,7.5,23.13,7.646,23.042,8.318,23.438,7.438,22.36,7.18,21.94];
function solarTermFor(date=new Date()){
  const year=date.getFullYear(),shortYear=year%100,terms=[];
  solarTermNames.forEach((name,index)=>{const month=Math.floor(index/2);const day=Math.floor(shortYear*.2422+solarTermConstants[index])-Math.floor((shortYear-1)/4);terms.push({name,date:new Date(year,month,day)});});
  const previous=[...terms].reverse().find(term=>term.date<=date)||{name:'冬至',date:new Date(year-1,11,21)};
  return previous.name;
}
function regionForPlace(place=''){
  if(/黑龙江|吉林|辽宁|东北/.test(place))return '东北';
  if(/北京|天津|河北|山东|山西|内蒙古/.test(place))return '华北';
  if(/上海|江苏|浙江|安徽|福建|江西/.test(place))return '华东';
  if(/广东|广西|海南|香港|澳门/.test(place))return '华南';
  if(/河南|湖北|湖南/.test(place))return '华中';
  if(/四川|重庆|云南|贵州|西藏/.test(place))return '西南';
  if(/陕西|甘肃|宁夏|青海|新疆/.test(place))return '西北';
  return '';
}
function geoPosition(){return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('浏览器不支持定位'));navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:6500,maximumAge:30*60*1000});});}
async function weatherAt(latitude,longitude){
  const weatherData=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`).then(response=>{if(!response.ok)throw new Error('天气服务暂不可用');return response.json();});
  const code=Number(weatherData?.current?.weather_code),weather=weatherLabels[code]||['🌡️','实时天气'];
  return {weather:weather[1],weatherIcon:weather[0],temperature:Number.isFinite(Number(weatherData?.current?.temperature_2m))?Math.round(Number(weatherData.current.temperature_2m)):null};
}
function saveHomeContext(next){homeContext={...homeContext,...next,loading:false,error:false,savedAt:Date.now()};localStorage.setItem('home-context-cache',JSON.stringify(homeContext));if(state&&currentTab==='home')render();}
async function loadHomeContext(force=false){
  if(!force){try{const cached=JSON.parse(localStorage.getItem('home-context-cache')||'null');if(cached){homeContext={...homeContext,...cached,loading:false,error:false};if(state&&currentTab==='home')render();return;}}catch{}}
  if(!force&&localStorage.getItem('home-location-attempted')){homeContext={...homeContext,loading:false,error:true};if(state&&currentTab==='home')render();return;}
  localStorage.setItem('home-location-attempted','1');
  homeContext={...homeContext,loading:true,error:false};if(state&&currentTab==='home')render();
  try{
    let latitude,longitude,locationData;
    try{const position=await geoPosition();latitude=position.coords.latitude;longitude=position.coords.longitude;}catch{}
    const locationUrl=latitude==null?'https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=zh':`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&localityLanguage=zh`;
    locationData=await fetch(locationUrl).then(response=>{if(!response.ok)throw new Error('定位服务暂不可用');return response.json();});
    latitude=Number(latitude??locationData.latitude);longitude=Number(longitude??locationData.longitude);
    const weather=Number.isFinite(latitude)&&Number.isFinite(longitude)?await weatherAt(latitude,longitude):{weather:'实时天气',weatherIcon:'🌡️',temperature:null};
    const city=locationData.city||locationData.locality||locationData.principalSubdivision||'当前位置';
    const province=locationData.principalSubdivision||'';
    saveHomeContext({city,province,region:regionForPlace(`${province}${city}`),...weather,source:'auto'});
  }catch{homeContext={...homeContext,loading:false,error:true,weatherIcon:'📍'};}
  if(state&&currentTab==='home')render();
}
async function chooseChinaCity(name){
  const query=String(name||'').trim();if(!query)throw new Error('请输入城市名称');
  const url=`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=zh&format=json&countryCode=CN`;
  const data=await fetch(url).then(response=>{if(!response.ok)throw new Error('城市查询失败');return response.json();});
  const place=(data.results||[]).find(item=>item.country_code==='CN'||item.country==='中国');
  if(!place)throw new Error('没有找到这个中国城市');
  const weather=await weatherAt(place.latitude,place.longitude),city=place.name||query,province=place.admin1||'';
  saveHomeContext({city,province,region:regionForPlace(`${province}${city}`),...weather,source:'manual'});
}
async function loadState(){const [saved,knowledge]=await Promise.all([api('/api/state'),api('/food_knowledge.json')]);state=saved;foodKnowledge=knowledge.foods||[];const merged=mergeInventoryItems(state.inventory||[]);state.inventory=merged.items;if(merged.changed)await persist();render();loadHomeContext();}
async function persist(){state.inventory=mergeInventoryItems(state.inventory||[]).items;state=await api('/api/state',{method:'PUT',body:JSON.stringify({state})});}
function toast(message){ toastNode.textContent=message; toastNode.classList.add('show'); setTimeout(()=>toastNode.classList.remove('show'),2600); }
function headerContent(){
  const titles={home:['食光管家','今天，先吃掉家里的好食材'],inventory:['我的冰箱','食材台账'],recipes:['智能菜谱','按库存做饭'],shopping:['采购清单','按需补购'],profile:['我的','偏好与饮食记录']};
  let [title,sub]=titles[currentTab];
  if(currentTab==='inventory'&&inventoryEntryView){title=inventoryEntryView==='manual'?'手动录入':'拍照录入';sub='食材录入';}
  if(currentTab==='inventory'&&inventoryEntryView==='manual'){
    header.innerHTML=`<div class="manual-entry-header-row"><button class="manual-header-back" data-action="back-to-inventory">‹ 返回冰箱</button></div><div class="manual-entry-title-row"><h1>食材录入</h1><button class="manual-header-custom" data-action="open-ai-entry">✦ AI录入</button></div>`;
    return;
  }
  if(currentTab==='home'){
    const now=new Date(),festival=chineseFestival(now),rawName=String(state?.profile?.name||'朋友').trim();
    const name=/厨房|用户/.test(rawName)?'朋友':rawName;
    const dateText=`今天是${now.getMonth()+1}月${now.getDate()}日！${festival?`是${festival}！`:''}`;
    const weatherDetail=homeContext.loading?'正在定位…':homeContext.error?'点击重新定位':`${homeContext.weatherIcon} ${esc(homeContext.weather)}${homeContext.temperature===null?'':` ${homeContext.temperature}°`}`;
    header.innerHTML=`<div class="home-header"><div class="home-brand"><p class="eyebrow">今天，先吃掉家里的好食材</p><h1>食光管家</h1></div><button type="button" class="home-weather" data-action="open-city-location" aria-label="修改城市定位"><strong>您好，${esc(name)}！</strong><small>${dateText}</small><span>⌖ ${esc(homeContext.city||'当前位置')} · ${weatherDetail}</span></button></div>`;
    return;
  }
  const headerAction=currentTab==='inventory'&&inventoryEntryView?'<button class="header-back-action" data-action="back-to-inventory">‹ 返回冰箱</button>':currentTab==='recipes'&&returnTab==='profile'&&!selectedRecipe?'<button class="header-back-action" data-action="back-to-profile">‹ 返回我的</button>':'';
  header.innerHTML=`<div class="topline"><div><p class="eyebrow">${sub}</p><h1>${title}</h1></div>${headerAction}</div>`;
}
function tags(tags=[]){return `<div class="tag-row">${tags.map((tag,i)=>`<span class="tag ${i===0?'green':''}">${esc(tag)}</span>`).join('')}</div>`;}
function recipeCard(recipe){return `<button class="recipe-card" data-action="open-recipe" data-id="${esc(recipe.id)}"><div class="recipe-visual">${esc(recipe.imageEmoji||'🍲')}</div><div class="recipe-body"><h3>${esc(recipe.title)}</h3><div class="meta"><span>${esc(recipe.duration||30)} 分钟</span><span>·</span><span>${esc(recipe.difficulty||'简单')}</span><span>·</span><span>${esc(recipe.servings||2)} 人</span></div>${tags(recipe.tags||[])}</div></button>`;}
// BEGIN HOMEPAGE-ONLY MODULE
const homepage = (() => {
const foodProfiles = {
  // Serving units are practical household estimates, not laboratory nutrient measurements.
  '大米':{group:'谷薯主食',per:{g:50,kg:.05,斤:.1},count:{碗:1,杯:1}},'面条':{group:'谷薯主食',per:{g:50},count:{把:1,份:1}},'燕麦':{group:'谷薯主食',per:{g:40},count:{袋:1,份:1}},'全麦面包':{group:'谷薯主食',per:{g:50},count:{片:1}},'土豆':{group:'谷薯主食',per:{g:100},count:{个:1}},'红薯':{group:'谷薯主食',per:{g:100},count:{个:1,根:1}},
  '番茄':{group:'蔬菜',per:{g:100},count:{个:1,颗:1}},'西兰花':{group:'蔬菜',per:{g:100},count:{颗:3,个:3}},'胡萝卜':{group:'蔬菜',per:{g:100},count:{根:1,个:1}},'菠菜':{group:'蔬菜',per:{g:100},count:{把:1}},'生菜':{group:'蔬菜',per:{g:100},count:{颗:3,棵:3}},'黄瓜':{group:'蔬菜',per:{g:100},count:{根:2,条:2}},'青椒':{group:'蔬菜',per:{g:100},count:{个:1}},'洋葱':{group:'蔬菜',per:{g:100},count:{个:1}},'白菜':{group:'蔬菜',per:{g:100},count:{颗:4,棵:4}},'蘑菇':{group:'蔬菜',per:{g:100},count:{盒:2}},
  '香蕉':{group:'水果',per:{g:150},count:{根:1,个:1}},'苹果':{group:'水果',per:{g:150},count:{个:1}},'橙子':{group:'水果',per:{g:150},count:{个:1}},'梨':{group:'水果',per:{g:150},count:{个:1}},
  '鸡蛋':{group:'蛋白质',per:{g:50},count:{个:1,枚:1}},'鸡胸肉':{group:'蛋白质',per:{g:100},count:{块:1}},'鸡肉':{group:'蛋白质',per:{g:100}},'牛肉':{group:'蛋白质',per:{g:100}},'猪肉':{group:'蛋白质',per:{g:100}},'鱼':{group:'蛋白质',per:{g:100},count:{条:2}},'三文鱼':{group:'蛋白质',per:{g:100}},'豆腐':{group:'蛋白质',per:{g:100},count:{盒:2}},'豆浆':{group:'蛋白质',per:{ml:250},count:{杯:1}},
  '牛奶':{group:'奶类',per:{ml:250},count:{盒:1,瓶:1,杯:1}},'酸奶':{group:'奶类',per:{g:200},count:{杯:1,盒:1}},'奶酪':{group:'奶类',per:{g:30},count:{片:1}}
};
const nutritionGroups=['谷薯主食','蔬菜','水果','蛋白质','奶类'];
const foodAliases={'西红柿':'番茄','小番茄':'番茄','猪肋排':'排骨','猪小排':'排骨','肋排':'排骨','猪排骨':'排骨','猪里脊':'猪肉','瘦肉':'猪肉','鸡腿肉':'鸡肉','鸡翅':'鸡肉','鸡腿':'鸡肉','鸡蛋液':'鸡蛋','西兰花菜':'西兰花','牛乳':'牛奶','无糖酸奶':'酸奶'};
const categoryDefaults={
  '谷薯主食':{per:{g:50,kg:.05,斤:.1,两:1},count:{碗:1,杯:1,袋:2,份:1,片:1}},
  '蔬菜':{per:{g:100,kg:.1,斤:.2,两:2},count:{个:1,根:1,条:1,颗:1,棵:1,把:1,份:1,包:1,盒:1}},
  '水果':{per:{g:150,kg:.15,斤:.3,两:3},count:{个:1,颗:1,根:1,份:1}},
  '蛋白质':{per:{g:100,kg:.1,斤:.2,两:2},count:{个:1,枚:1,块:1,根:1,条:1,片:1,份:1,盒:2,袋:2}},
  '奶类':{per:{g:200,kg:.2,ml:250,l:.25,斤:.4},count:{杯:1,盒:1,瓶:1,份:1}}
};
function resolveFoodProfile(name){const normalized=String(name||'').trim().toLowerCase().replace(/[\s·•,，。/／()（）_-]/g,'').replace(/(冷藏|冷冻|新鲜|有机)$/,'');const alias=foodAliases[normalized]||normalized;let profile=foodProfiles[alias];let group=profile?.group;if(!profile){if(/牛奶|酸奶|奶酪|乳酪|奶粉|牛乳/.test(normalized))group='奶类';else if(/米|面条|面粉|燕麦|麦片|面包|馒头|玉米|藜麦|荞麦|土豆|马铃薯|红薯|紫薯/.test(normalized))group='谷薯主食';else if(/香蕉|苹果|橙|柑|橘|梨|桃|葡萄|草莓|蓝莓|西瓜|哈密瓜|猕猴桃|芒果|火龙果|柚子|柠檬/.test(normalized))group='水果';else if(/鸡蛋|鸭蛋|鹌鹑蛋|鸡肉|鸡胸|鸡腿|鸡翅|鸭肉|猪肉|排骨|肋排|牛肉|牛腩|牛排|羊肉|肉末|肉馅|鱼|虾|蟹|贝|鱿鱼|豆腐|豆浆|豆奶|黄豆|黑豆|红豆|绿豆|鹰嘴豆|扁豆|花生|核桃|杏仁|腰果|坚果/.test(normalized))group='蛋白质';else if(/番茄|西兰花|胡萝卜|菠菜|生菜|黄瓜|青椒|洋葱|白菜|蘑菇|香菇|金针菇|茄子|西葫芦|南瓜|芹菜|菜心|油麦菜|生姜|大蒜|土豆/.test(normalized))group='蔬菜';if(group)profile={group};}if(!profile)return null;const defaults=categoryDefaults[group];return {...defaults,...profile,per:{...defaults.per,...profile.per},count:{...defaults.count,...profile.count}};}
const recipeImageAssets = {
  'tomato-chicken-broccoli':'assets/recipes/tomato-chicken-broccoli.jpg',
  'tomato-egg':'assets/recipes/tomato-egg.jpg',
  'tomato-egg-broccoli-soup':'assets/recipes/tomato-egg-broccoli-soup.jpg',
  'garlic-broccoli':'assets/recipes/garlic-broccoli.jpg',
  'tomato-egg-rice':'assets/recipes/tomato-egg-rice.jpg',
  'chicken-broccoli-rice':'assets/recipes/chicken-broccoli-rice.jpg',
  'chicken-broccoli':'assets/recipes/chicken-broccoli.jpg',
  'tomato-chicken-broccoli-soup':'assets/recipes/tomato-chicken-broccoli-soup.jpg'
};
function recipeImage(recipe){
  if(/^assets\/generated\/[a-f0-9]{64}\.jpg$/.test(recipe.imageUrl||''))return recipe.imageUrl;
  if(recipe.imageUrl){try{const imageUrl=new URL(recipe.imageUrl);if(imageUrl.protocol==='https:'&&(imageUrl.hostname==='serpapi.com'||imageUrl.hostname.endsWith('.serpapi.com')||imageUrl.hostname.endsWith('.gstatic.com')||imageUrl.hostname.endsWith('.googleusercontent.com')))return imageUrl.href;}catch{}}
  if(recipeImageAssets[recipe.imageKey])return recipeImageAssets[recipe.imageKey];
  const ingredients=(recipe.ingredients||[]).map(item=>item.name||'').join(' ');
  const text=`${recipe.title||''} ${recipe.subtitle||''} ${ingredients}`;
  const tomato=/番茄|西红柿/.test(text),egg=/鸡蛋|鸡蛋液|蛋花/.test(text),broccoli=/西兰花/.test(text),chicken=/鸡胸肉|鸡肉/.test(text),rice=/大米|米饭|盖饭|米/.test(text),soup=/汤|羹|煲/.test(recipe.title||'');
  let key='';
  if(tomato&&chicken&&broccoli&&soup)key='tomato-chicken-broccoli-soup';
  else if(tomato&&chicken&&broccoli)key='tomato-chicken-broccoli';
  else if(tomato&&egg&&broccoli)key='tomato-egg-broccoli-soup';
  else if(chicken&&broccoli&&rice)key='chicken-broccoli-rice';
  else if(chicken&&broccoli)key='chicken-broccoli';
  else if(tomato&&egg&&rice)key='tomato-egg-rice';
  else if(tomato&&egg)key='tomato-egg';
  else if(broccoli&&/蒜蓉|大蒜|蒜/.test(text))key='garlic-broccoli';
  return recipeImageAssets[key]||'';
}
function recipeCard(recipe){const image=recipeImage(recipe);return `<button type="button" class="recipe-card" data-home-action="open-daily-recommendation-preview" data-id="${esc(recipe.id)}"><div class="recipe-visual">${image?`<img class="recipe-image" src="${image}" alt="${esc(recipe.title)}" loading="lazy">`:`<span class="recipe-emoji">${esc(recipe.imageEmoji||'🍲')}</span>`}<span class="recipe-visual-label">按库存推荐</span></div><div class="recipe-body"><h3>${esc(recipe.title)}</h3><div class="meta"><span>${esc(recipe.duration||30)} 分钟</span><span>·</span><span>${esc(recipe.difficulty||'简单')}</span><span>·</span><span>${esc(recipe.servings||2)} 人</span></div>${tags(recipe.tags||[])}</div></button>`;}
function inventoryBalance(inventory){
  let included=0;
  const countedItems=new Set();
  const groups=Object.fromEntries(nutritionGroups.map(group=>[group,{servings:0,foods:new Set(),items:[]} ]));
  for(const item of inventory){
    const profile=resolveFoodProfile(item.name);
    if(!profile)continue;
    const amount=Number(item.quantity),rawUnit=String(item.unit||'').trim();
    const unit=({'克':'g','千克':'kg','毫升':'ml','升':'l'})[rawUnit]||rawUnit;
    if(!(amount>0))continue;
    const servings=profile.per?.[unit]?amount/profile.per[unit]:profile.count?.[unit]?amount*profile.count[unit]:0;
    if(!servings)continue;
    included++;countedItems.add(item);
    groups[profile.group].servings+=servings;
    groups[profile.group].foods.add(item.name);
    groups[profile.group].items.push({...item,estimatedServings:servings});
  }
  const confidence=inventory.length?included/inventory.length:0;
  return {confidence,included,total:inventory.length,groups,uncounted:inventory.filter(item=>!countedItems.has(item))};
}
const nutritionColors=['#e8755b','#78a2d9','#8dbf79','#f2c864','#af91c6'];
const nutrientColors=['#e8755b','#e3a44f','#78a2d9','#8dbf79','#5cae9f','#d9829a','#8794a8'];
const nutrientDefinitions=[
  {key:'energy',label:'能量',unit:'kcal',target:2000,kind:'range'},
  {key:'carbs',label:'碳水化合物',unit:'g',target:300,kind:'range'},
  {key:'protein',label:'蛋白质',unit:'g',target:60,kind:'minimum'},
  {key:'fat',label:'脂肪',unit:'g',target:60,kind:'upper'},
  {key:'fiber',label:'膳食纤维',unit:'g',target:25,kind:'minimum'},
  {key:'addedSugar',label:'添加糖',unit:'g',target:25,kind:'upper'},
  {key:'sodium',label:'钠',unit:'mg',target:2000,kind:'upper'}
];
const baseNutrients={energy:0,carbs:0,protein:0,fat:0,saturatedFat:0,fiber:0,addedSugar:0,sodium:0};
function nutrientProfileFor(name){
  const value=String(name||'').trim().replace(/冷藏|冷冻|新鲜|有机/g,'');
  if(/白砂糖|绵白糖|冰糖|红糖|砂糖|蔗糖/.test(value))return {energy:400,carbs:100,addedSugar:100};
  if(/食盐|盐$/.test(value))return {sodium:39300};
  if(/生抽|老抽|酱油/.test(value))return {energy:60,carbs:7,protein:5,sodium:5600};
  if(/油$|橄榄油|花生油|菜籽油/.test(value))return {energy:900,fat:100,saturatedFat:15};
  if(/大米|米饭/.test(value))return {energy:346,carbs:77.9,protein:7.4,fat:.8,saturatedFat:.2,fiber:.7,sodium:3};
  if(/鸡蛋|鸭蛋/.test(value))return {energy:144,carbs:2.8,protein:13.3,fat:8.8,saturatedFat:2.6,fiber:0,sodium:131};
  if(/鸡胸|鸡肉/.test(value))return {energy:118,carbs:0,protein:24.6,fat:1.9,saturatedFat:.5,fiber:0,sodium:46};
  if(/排骨|猪肉/.test(value))return {energy:278,carbs:0,protein:16.7,fat:23.1,saturatedFat:8.5,fiber:0,sodium:62};
  if(/西兰花/.test(value))return {energy:36,carbs:4.3,protein:4.1,fat:.6,saturatedFat:.1,fiber:1.6,sodium:18};
  if(/番茄|西红柿/.test(value))return {energy:15,carbs:3.3,protein:.9,fat:.2,saturatedFat:0,fiber:1,sodium:5};
  if(/胡萝卜/.test(value))return {energy:39,carbs:8.8,protein:1,fat:.2,saturatedFat:0,fiber:2.8,sodium:71};
  if(/牛奶|酸奶/.test(value))return {energy:60,carbs:5,protein:3,fat:3.2,saturatedFat:2,fiber:0,sodium:50};
  if(/香蕉/.test(value))return {energy:93,carbs:22,protein:1.4,fat:.2,saturatedFat:0,fiber:1.2,sodium:1};
  const group=resolveFoodProfile(value)?.group;
  return {
    '谷薯主食':{energy:350,carbs:75,protein:8,fat:2,saturatedFat:.4,fiber:3,sodium:10},
    '蔬菜':{energy:30,carbs:5,protein:2,fat:.3,saturatedFat:.05,fiber:2.5,sodium:20},
    '水果':{energy:55,carbs:13,protein:.8,fat:.3,saturatedFat:.05,fiber:2,sodium:3},
    '蛋白质':{energy:150,carbs:3,protein:20,fat:7,saturatedFat:2,fiber:1,sodium:80},
    '奶类':{energy:60,carbs:5,protein:3,fat:3,saturatedFat:1.8,fiber:0,sodium:50}
  }[group]||null;
}
function consumedGrams(item,quantity){
  const amount=Number(quantity),unit=String(item?.unit||'').trim();
  if(!(amount>0))return null;
  if(['g','克'].includes(unit))return amount;
  if(unit==='kg'||unit==='千克')return amount*1000;
  if(unit==='斤')return amount*500;
  if(unit==='两')return amount*50;
  if(['ml','毫升'].includes(unit))return amount;
  if(unit==='l'||unit==='升')return amount*1000;
  const perUnit=findFoodKnowledge(item?.name)?.units?.[unit];
  if(perUnit)return amount*perUnit;
  const totalGrams=Number(item?.estimatedGrams),totalQuantity=Number(item?.quantity);
  return totalGrams>0&&totalQuantity>0?totalGrams*amount/totalQuantity:null;
}
function sevenDayNutrients(){
  const totals={...baseNutrients};
  const dates=new Set();let recognized=0;
  const cutoff=Date.parse(`${today}T12:00:00`)-6*86400000;
  for(const operation of state.cookOperations||[]){
    const date=String(operation.createdAt||'').slice(0,10),time=Date.parse(`${date}T12:00:00`);
    if(operation.undone||!Number.isFinite(time)||time<cutoff)continue;
    for(const line of operation.consumption||[]){
      const item=line.item,grams=consumedGrams(item,Number(line.quantity)),profile=nutrientProfileFor(item?.name);
      if(!profile||!grams)continue;
      nutrientDefinitions.forEach(metric=>{totals[metric.key]+=Number(profile[metric.key]||0)*grams/100;});
      recognized++;dates.add(date);
    }
  }
  const daily=Object.fromEntries(nutrientDefinitions.map(metric=>[metric.key,totals[metric.key]/7]));
  return {totals,daily,recognized,daysRecorded:dates.size};
}
function estimatedPortions(item, quantity=Number(item.quantity)){
  const profile=resolveFoodProfile(item.name);
  if(!profile||!Number.isFinite(quantity)||quantity<=0)return null;
  const raw=String(item.unit||'').trim();
  const unit=({'克':'g','千克':'kg','毫升':'ml','升':'l'})[raw]||raw;
  const servings=profile.per?.[unit]?quantity/profile.per[unit]:profile.count?.[unit]?quantity*profile.count[unit]:0;
  return servings>0?{group:profile.group,servings}:null;
}
function todayRecordedPortions(){
  const amounts=Object.fromEntries(nutritionGroups.map(group=>[group,0]));
  let recognized=0;
  for(const operation of state.cookOperations||[]){
    if(operation.undone||String(operation.createdAt||'').slice(0,10)!==today)continue;
    for(const line of operation.consumption||[]){
      const snapshot=line.item;
      if(!snapshot)continue;
      const portion=estimatedPortions(snapshot,Number(line.quantity));
      if(!portion)continue;
      amounts[portion.group]+=portion.servings;
      recognized++;
    }
  }
  return {amounts,recognized};
}
function nutritionBreakdown(){
  const recorded=sevenDayNutrients();
  const ratios=nutrientDefinitions.map(metric=>recorded.recognized?Math.min(1.5,recorded.daily[metric.key]/metric.target):0);
  const ratioTotal=ratios.reduce((sum,value)=>sum+value,0);let position=0;
  const shares=ratios.map(value=>ratioTotal?value/ratioTotal*100:0);
  const arcs=shares.map((share,index)=>{const start=position;position+=share;return share>0?`${nutrientColors[index]} ${start.toFixed(2)}% ${position.toFixed(2)}%`:null;}).filter(Boolean);
  const chart=arcs.length?`conic-gradient(${arcs.join(',')})`:'#eee9e4';
  const rows=nutrientDefinitions.map((metric,index)=>{
    const value=recorded.daily[metric.key];
    let status='暂无数据',statusClass='neutral';
    if(recorded.recognized){
      const ratio=value/metric.target;
      const met=metric.kind==='upper'?ratio<=1:metric.kind==='minimum'?ratio>=.8:ratio>=.8&&ratio<=1.2;
      status=met?'达标':metric.kind==='upper'&&ratio>1?'偏高':'不足';statusClass=met?'met':'unmet';
    }
    const shown=metric.unit==='mg'?Math.round(value):Number(value.toFixed(1));
    return `<div class="nutrition-metric ${statusClass}"><i style="background:${nutrientColors[index]}"></i><span><strong>${metric.label}</strong><small>${recorded.recognized?`${shown}${metric.unit}/日 · 占图 ${Math.round(shares[index])}%`:'尚无可计算记录'}</small></span><b>${status}</b></div>`;
  }).join('');
  return `<div class="nutrition-breakdown"><div class="nutrition-donut" style="background:${chart}" role="img" aria-label="过去七天主要营养成分参考值归一化占比"><span>近7天<br>营养构成</span></div><div class="nutrition-metric-list">${rows}</div></div><p class="nutrition-chart-note">环图按各项日均摄入相对参考值换算后展示，便于比较不同单位的营养成分；未记录的餐食不计入。</p>`;
}
function dietGuideReferenceModal(){
  const balance=inventoryBalance(state.inventory||[]);
  const currentTotal=nutritionGroups.reduce((sum,group)=>sum+(Number(balance.groups[group]?.servings)||0),0);
  const guideServings={'谷薯主食':6.5,'蔬菜':3,'水果':275/150,'蛋白质':1.6,'奶类':1.2};
  const guideTotal=nutritionGroups.reduce((sum,group)=>sum+guideServings[group],0);
  const gradientFor=(values,total)=>{
    if(!total)return '#eee9e4';
    let position=0;
    const stops=nutritionGroups.map((group,index)=>{
      const share=values[group]/total*100;
      const start=position;position+=share;
      return share>0?`${nutritionColors[index]} ${start.toFixed(2)}% ${position.toFixed(2)}%`:null;
    }).filter(Boolean);
    return stops.length?`conic-gradient(${stops.join(',')})`:'#eee9e4';
  };
  const currentValues=Object.fromEntries(nutritionGroups.map(group=>[group,Number(balance.groups[group]?.servings)||0]));
  const currentGradient=gradientFor(currentValues,currentTotal);
  const guideGradient=gradientFor(guideServings,guideTotal);
  const rows=nutritionGroups.map((group,index)=>{
    const current=currentTotal?Math.round(currentValues[group]/currentTotal*100):0;
    const guide=Math.round(guideServings[group]/guideTotal*100);
    return `<div class="guide-reference-row"><i style="background:${nutritionColors[index]}"></i><span>${group}</span><b>库存 ${current}%</b><em>参考 ${guide}%</em></div>`;
  }).join('');
  modal(`<h2>官方推荐占比参考</h2><p class="guide-reference-intro">将当前库存结构与膳食指南建议量放在一起，方便观察类别差异。</p><div class="guide-donut-compare"><div><strong>当前库存</strong><div class="nutrition-donut" style="background:${currentGradient}"><span>库存<br>构成</span></div></div><div><strong>指南参考</strong><div class="nutrition-donut" style="background:${guideGradient}"><span>建议量<br>换算</span></div></div></div><div class="guide-reference-list">${rows}</div><div class="guide-reference-source"><strong>换算依据</strong><p>成年人每日：谷类 200～300g、薯类 50～100g；蔬菜不少于 300g；水果 200～350g；鱼禽肉蛋 120～200g；奶制品相当于液态奶 300ml 以上。图中取区间中值或最低建议量，再按本页“份”口径归一化，属于对照换算，并非指南发布的原始百分比。</p><a href="https://dg.cnsoc.org/article/04/J4-AsD_DR3OLQMnHG0-jZA.html" target="_blank" rel="noopener">来源：《中国居民膳食指南（2022）》</a></div><div class="modal-actions"><button type="button" class="primary-button" data-action="close-modal">知道了</button></div>`);
}
function nutritionHealthCard() {
  return `<section class="card health-card">
    <div class="health-heading"><div><span class="eyebrow">基于已确认的烹饪消耗</span><h2>近7天营养构成</h2></div></div>
    ${nutritionBreakdown()}
    <p class="nutrition-source">参考：《食品安全国家标准 预包装食品营养标签通则》《中国居民膳食营养素参考摄入量》</p>
    <p class="nutrition-disclaimer">脂肪数值包含饱和脂肪；食材营养值为估算，仅供日常观察，不替代专业营养评估。</p>
  </section>`;
}
function recentConsumptionByGroup(days=14){
  const totals=Object.fromEntries(nutritionGroups.map(group=>[group,0]));
  const cutoff=Date.parse(`${today}T12:00:00`)-days*86400000;
  for(const operation of state.cookOperations||[]){
    const date=String(operation.createdAt||'').slice(0,10);
    const time=Date.parse(`${date}T12:00:00`);
    if(operation.undone||!Number.isFinite(time)||time<cutoff)continue;
    for(const line of operation.consumption||[]){
      if(!line.item)continue;
      const portion=estimatedPortions(line.item,Number(line.quantity));
      if(portion)totals[portion.group]+=portion.servings;
    }
  }
  return totals;
}
function seasonalDishTip(){
  const term=solarTermFor(new Date()),region=homeContext.region||'',city=homeContext.city||'';
  const north=['东北','华北','西北'].includes(region),south=['华东','华南','西南'].includes(region);
  const index=solarTermNames.indexOf(term),season=index>=2&&index<=7?'spring':index>=8&&index<=13?'summer':index>=14&&index<=19?'autumn':'winter';
  const choices={
    spring:north?['韭菜鸡蛋','菠菜豆腐汤']:['春笋炒肉','荠菜鸡蛋羹'],
    summer:north?['凉拌黄瓜','冬瓜丸子汤']:['冬瓜薏米汤','清蒸时蔬'],
    autumn:north?['莲藕排骨汤','南瓜小米粥']:['山药木耳','莲藕炖鸡'],
    winter:north?['白菜豆腐煲','萝卜炖牛肉']:['白萝卜排骨汤','菌菇青菜煲']
  }[season];
  const avoided=[...(state.preferences?.avoid||[]),...(state.preferences?.allergies||[])].map(String).filter(Boolean);
  const dish=choices.find(item=>!avoided.some(food=>item.includes(food)))||'温热的时令蔬菜汤';
  const place=city?`${city}`:north?'北方':south?'南方':'当地';
  const weather=homeContext.temperature===null?'':homeContext.temperature<=10?'天气偏凉，':homeContext.temperature>=28?'天气偏热，':'';
  return `${term}时节，${place}${weather}可以试试${dish}。`;
}
function nutritionRecommendation(balance,shopping=[]){
  const month=new Date().getMonth()+1;
  const season=month>=3&&month<=5?'春日':month>=6&&month<=8?'夏天':month>=9&&month<=11?'秋日':'冬日';
  const labels={'谷薯主食':'主食类','蔬菜':'蔬菜类','水果':'水果类','蛋白质':'蛋白质类','奶类':'奶类'};
  const preferences=state.preferences||{};
  const flavors=(preferences.flavors||[]).map(String).filter(Boolean);
  const needs=(preferences.needs||[]).map(String);
  const avoid=[...(preferences.avoid||[]),...(preferences.allergies||[])].map(String);
  const preferenceText=[...flavors,...needs].join(' ');
  const avoidText=avoid.join(' ');
  if(!balance.included||balance.confidence<.6){
    const preferenceHint=flavors[0]?`，也会照顾你喜欢的${flavors[0]}口味`:'';
    return {text:balance.total?`🫘 ${seasonalDishTip()} 把食材数量补完整${preferenceHint}，提醒会更贴心。`:`🫘 ${seasonalDishTip()} 录入库存后，还会结合你的偏好继续调整。`};
  }

  const planned=new Set(shopping.filter(item=>item.status==='pending').map(item=>resolveFoodProfile(item.name)?.group).filter(Boolean));
  const expiring=new Set((state.inventory||[]).filter(item=>freshnessFor(item).key==='soon').map(item=>resolveFoodProfile(item.name)?.group).filter(Boolean));
  const recent=recentConsumptionByGroup(14);
  const maxRecent=Math.max(1,...Object.values(recent));
  const seasonalGroups={
    '春日':['蔬菜','水果'],
    '夏天':['蔬菜','水果','奶类'],
    '秋日':['蔬菜','水果','谷薯主食'],
    '冬日':['谷薯主食','蛋白质','蔬菜']
  }[season]||[];
  const blockedGroups=new Set();
  if(/牛奶|乳制品|乳糖|奶类/.test(avoidText))blockedGroups.add('奶类');
  if(/蛋|鸡蛋/.test(avoidText)&&/肉|海鲜|豆/.test(avoidText))blockedGroups.add('蛋白质');

  const ranked=nutritionGroups
    .filter(group=>!planned.has(group)&&!blockedGroups.has(group))
    .map(group=>{
      const servings=Number(balance.groups[group]?.servings)||0;
      const gap=Math.max(0,3-servings)/3;
      const usage=recent[group]/maxRecent;
      const seasonBoost=seasonalGroups.includes(group)?0.18:0;
      let preferenceBoost=0;
      if(/高蛋白|增肌|健身/.test(preferenceText)&&group==='蛋白质')preferenceBoost+=0.35;
      if(/素食/.test(preferenceText)&&['蔬菜','蛋白质'].includes(group))preferenceBoost+=0.2;
      if(/控糖|低碳/.test(preferenceText)&&['蔬菜','蛋白质'].includes(group))preferenceBoost+=0.18;
      if(/均衡|营养/.test(preferenceText))preferenceBoost+=0.08;
      const expiryPenalty=expiring.has(group)?0.45:0;
      return {group,score:gap*0.55+usage*0.22+seasonBoost+preferenceBoost-expiryPenalty};
    })
    .sort((a,b)=>b.score-a.score);
  const picks=ranked.filter(item=>item.score>0.12).slice(0,2).map(item=>item.group);

  if(!picks.length){
    return {text:`🫘 ${seasonalDishTip()} 采购安排已经很周到啦，先把清单里的食材买齐就好。`};
  }

  const categoryText=picks.map(group=>labels[group]).join('和');
  const preferenceLead=flavors[0]?`按你喜欢的${flavors[0]}口味来搭配，`:'';
  const expiryLead=expiring.size?'家里还有临期食材，记得先安排进这几餐哦！':'';
  const variants=[
    `🫘 ${season}可以吃得更丰富些呀！${preferenceLead}下次采购可优先看看${categoryText}。`,
    `🫘 给下一餐添点新变化吧！${preferenceLead}${categoryText}会是不错的补充。`,
    `🫘 最近的饮食节奏已经记下啦！下次采购优先补充${categoryText}，搭配起来会更均衡。`
  ];
  const seed=[today,...picks,...flavors,...needs].join('').split('').reduce((sum,char)=>sum+char.charCodeAt(0),0);
  const main=variants[seed%variants.length];
  return {text:`🫘 ${seasonalDishTip()} ${expiryLead||main}`};
}
function renderHome(){
  const expiring=state.inventory.filter(item=>freshnessFor(item).key==='soon');
  const pending=state.shopping.filter(item=>item.status==='pending');
  const recipes=dailyRecommendationRecipes();
  const balance=inventoryBalance(state.inventory);
  const tip=nutritionRecommendation(balance,pending);
  const nearestExpiring=[...expiring].sort((a,b)=>inventoryAgeDays(b)-inventoryAgeDays(a)).slice(0,2);
  const expiryRows=nearestExpiring.map(item=>`<span class="expiry-item"><strong>${esc(item.name)}</strong><small>${esc(freshnessFor(item).label)}</small></span>`).join('');
  return `<div class="home-page"><div class="home-shortcuts"><button class="home-shortcut expiry-shortcut" data-tab-go="inventory"><span class="shortcut-icon">◷</span><span><strong>需优先处理</strong>${expiring.length?`<span class="expiry-preview">${expiryRows||'<small>查看库存记录</small>'}</span>`:'<small>暂时没有需优先处理的食材</small>'}</span><b>›</b></button><button class="home-shortcut shopping-shortcut" data-tab-go="shopping"><span class="shortcut-icon">🧺</span><span><strong>采购清单</strong><small>${pending.length?`还有 ${pending.length} 项待买`:'清单目前为空'}</small></span><b>›</b></button></div>
  <section class="card agent-card"><div class="agent-intro"><div class="agent-avatar">✦</div><div><strong>问问厨房管家</strong><p>我会优先为你消耗现有和临期食材</p></div></div><form class="ask-row" id="ask-form"><input id="agent-question" required placeholder="例如：30 分钟做两人晚餐" /><button type="submit">提问</button></form><div class="quick-chips">${['优先用掉快过期食材','30 分钟做两人晚餐','看看我还缺什么'].map((q,i)=>`<button class="chip" data-action="quick-ask" data-quick-mode="${['expiry','dinner','shopping'][i]}" data-question="${q}">${q}</button>`).join('')}</div></section>
  ${agentLoading?'<section class="card loading"><span class="spinner"></span>厨房管家正在分析你的库存与偏好…</section>':''}
  ${agentResult?agentPanel(agentResult):''}
  ${nutritionHealthCard()}
  <div class="section-title"><h2>每日推荐</h2></div>
  ${recipes.length?`<div class="recipe-scroll daily-recommendation-scroll">${recipes.map(recipeCard).join('')}</div>`:'<section class="card empty daily-empty"><span class="empty-icon">🍳</span><b>今天吃点什么？</b><span>当前还没有合适的菜品推荐。</span></section>'}
  <button type="button" class="dinner-wheel-entry" data-action="open-dinner-wheel">不知道吃什么？点击这里！</button>
  <div class="section-title"><h2>饮食小提示</h2></div><section class="card diet-tip-card"><p class="result-summary diet-tip-text">${tip.text}</p><p class="meta diet-tip-note">按库存整理，仅供参考</p><button class="tip-shopping-button" data-tab-go="shopping">进入采购</button></section></div>`;
}
return {render:renderHome,recipeImage,openGuideReference:dietGuideReferenceModal};
})();
// END HOMEPAGE-ONLY MODULE

function home(){
  return homepage.render();
}
function libraryRecipeFor(recipe){
  const title=String(recipe?.title||'').trim().replace(/\s+/g,'');
  return (typeof recipeLibrary==='undefined'?[]:recipeLibrary).find(item=>item.id===recipe?.id||item.title.replace(/\s+/g,'')===title)||null;
}
function canonicalFoodName(name){
  const value=String(name||'').trim();
  return findFoodKnowledge(value)?.canonical_name||value;
}
function usableStockFor(name){
  const canonical=canonicalFoodName(name);
  return (state.inventory||[]).filter(item=>Number(item.quantity)>0&&(!item.expiryDate||item.expiryDate>=today)&&freshnessFor(item).key!=='unsafe'&&canonicalFoodName(item.name)===canonical);
}
function recipeMissingItems(recipe){
  const ingredients=(libraryRecipeFor(recipe)?.ingredients||recipe?.ingredients||[]).filter(item=>item&&item.name&&item.optional!==true);
  const missing=new Map();
  ingredients.forEach(item=>{
    const name=canonicalFoodName(item.name);
    const stock=usableStockFor(name);
    const needed=Number(item.quantity);
    const unit=String(item.unit||'个');
    let enough=stock.length>0;
    if(enough&&Number.isFinite(needed)&&needed>0){
      const requiredGrams=['g','克'].includes(unit)?needed:findFoodKnowledge(name)?.units?.[unit]*needed;
      const grams=stock.map(entry=>inventoryItemGrams(entry,name));
      if(requiredGrams&&grams.every(value=>value!==null))enough=grams.reduce((sum,value)=>sum+value,0)>=requiredGrams;
      else if(stock.every(entry=>entry.unit===unit))enough=stock.reduce((sum,entry)=>sum+Number(entry.quantity),0)>=needed;
    }
    if(!enough&&!missing.has(name)){
      const category=inventoryCategoryFor(name);
      missing.set(name,{name,unit,category:category==='肉蛋'?'肉禽':category==='海鲜'?'水产':category,source:recipe.title,suggestedQuantity:Number.isFinite(needed)&&needed>0?needed:1});
    }
  });
  return [...missing.values()];
}
function recipeExpiryPriority(recipe){
  const names=new Set((libraryRecipeFor(recipe)?.ingredients||recipe?.ingredients||[]).map(item=>canonicalFoodName(item.name)));
  const soon=(state.inventory||[]).filter(item=>names.has(canonicalFoodName(item.name))&&Number(item.quantity)>0&&(!item.expiryDate||item.expiryDate>=today)&&freshnessFor(item).key==='soon');
  const earliest=soon.reduce((days,item)=>Math.min(days,item.expiryDate?Math.max(0,Math.round((Date.parse(item.expiryDate)-Date.parse(today))/86400000)):999),999);
  return {count:soon.length,earliest};
}
function festivalBanquetScore(recipe){
  const festival=chineseFestival(new Date());if(!festival)return 0;
  const text=[recipe.title,recipe.subtitle,...(recipe.tags||[]),...(recipe.mealTypes||[]),recipe.region].flat().join(' ');
  const keywords={春节:/家宴|年夜|饺子|鱼|年糕|鸡|团圆/,元宵节:/汤圆|元宵|家宴/,端午节:/粽|家宴|蒸鱼|排骨/,中秋节:/家宴|团圆|芋头|鸭|鱼/,重阳节:/家宴|蒸菜|菊花|糕/}[festival];
  return keywords?.test(text)?2:/家宴|团圆/.test(text)?1:0;
}
function regionalRecipeScore(recipe){
  const region=homeContext.region;if(!region)return 0;
  const declared=[recipe.region,...(recipe.regions||[]),...(recipe.tags||[])].flat().join(' ');
  if(declared.includes(region))return 3;
  const text=`${recipe.title||''} ${recipe.subtitle||''} ${declared}`;
  const patterns={东北:/东北|锅包|地三鲜|乱炖|酸菜/,华北:/京味|北京|津味|鲁菜|山东|山西|河北|面食|饺子/,华东:/江浙|本帮|上海|苏式|杭帮|宁波|徽菜|福建|闽菜/,华南:/粤菜|广式|潮汕|客家|海南|广西/,华中:/湘菜|湖南|湖北|河南|楚味/,西南:/川菜|重庆|云南|贵州|酸汤|麻辣/,西北:/陕西|西安|甘肃|宁夏|青海|新疆|羊肉/};
  return patterns[region]?.test(text)?2:0;
}
function sortAgentRecipes(recipes){
  return [...recipes].sort((left,right)=>{
    const a=recipeExpiryPriority(left),b=recipeExpiryPriority(right);
    const missingDifference=recipeMissingItems(left).length-recipeMissingItems(right).length;
    return festivalBanquetScore(right)-festivalBanquetScore(left)||b.count-a.count||a.earliest-b.earliest||regionalRecipeScore(right)-regionalRecipeScore(left)||missingDifference||recipeStockMatchCount(right)-recipeStockMatchCount(left);
  });
}
function recipeStockMatchCount(recipe){
  return (libraryRecipeFor(recipe)?.ingredients||recipe?.ingredients||[]).filter(item=>item?.name&&usableStockFor(item.name).length>0).length;
}
function dailyRecommendationRecipes(){
  const avoided=[...(state.preferences?.allergies||[]),...(state.preferences?.avoid||[])].map(canonicalFoodName).filter(Boolean);
  const safe=recipe=>(recipe.ingredients||[]).every(item=>{
    const name=canonicalFoodName(item.name);
    return !avoided.some(food=>name.includes(food)||food.includes(name));
  })&&!avoided.some(food=>canonicalFoodName(recipe.title).includes(food));
  const library=typeof recipeLibrary==='undefined'?[]:recipeLibrary;
  const source=library.length?library:(state.recipes||[]);
  return sortAgentRecipes(source.filter(safe)).slice(0,5).map(recipe=>({
    ...recipe,
    tags:[...(festivalBanquetScore(recipe)?['节日家宴']:[]),...(regionalRecipeScore(recipe)?[`${homeContext.region}风味`]:[]),...(recipeExpiryPriority(recipe).count?['临期优先']:[]),recipeMissingItems(recipe).length?'少量补购':'库存充足'],
    ingredients:(recipe.ingredients||[]).map(item=>({...item,available:usableStockFor(item.name).length>0}))
  }));
}
function dinnerWheelModal(){
  modal('<div class="dinner-wheel-modal"><button type="button" class="modal-close" aria-label="关闭" data-action="close-modal">×</button><p class="eyebrow">今天吃什么</p><h2>随机转盘</h2><p class="dinner-wheel-copy">转盘内容正在准备中，先试试今天的手气吧！</p><div class="dinner-wheel" aria-label="晚餐随机转盘"><span class="wheel-option option-one">选项一</span><span class="wheel-option option-two">选项二</span><span class="wheel-option option-three">选项三</span><span class="wheel-option option-four">选项四</span><i class="wheel-pointer"></i><button type="button" data-action="spin-dinner-wheel">转一下</button></div><p class="dinner-wheel-result" id="dinner-wheel-result">准备好了吗？</p></div>');
}
function fallbackAgentResult(mode,previousTitles=[]){
  const avoided=[...(state.preferences?.allergies||[]),...(state.preferences?.avoid||[])].map(canonicalFoodName).filter(Boolean);
  const safe=recipe=>(recipe.ingredients||[]).every(item=>{
    const name=canonicalFoodName(item.name);
    return !avoided.some(food=>name.includes(food)||food.includes(name));
  })&&!avoided.some(food=>canonicalFoodName(recipe.title).includes(food));
  const allCandidates=(typeof recipeLibrary==='undefined'?[]:recipeLibrary).filter(safe);
  let candidates=[...allCandidates],usedExpiryMatch=false;
  if(mode==='dinner')candidates=candidates.filter(recipe=>(recipe.mealTypes||[]).includes('dinner')&&Number(recipe.duration)<=30);
  if(mode==='expiry'){
    const expiryMatches=candidates.filter(recipe=>recipeExpiryPriority(recipe).count>0);
    if(expiryMatches.length){candidates=expiryMatches;usedExpiryMatch=true;}
    else candidates=[...allCandidates];
  }
  candidates=sortAgentRecipes(candidates);
  if(previousTitles.length){
    const different=candidates.filter(recipe=>!previousTitles.includes(recipe.title));
    if(different.length)candidates=different;
  }
  const recipes=candidates.slice(0,2).map(recipe=>{
    const missing=recipeMissingItems(recipe);
    return {...recipe,reason:usedExpiryMatch?'优先使用仍可食用的临期食材。':'结合所在地域和你的饮食偏好推荐。',tags:[...(recipeExpiryPriority(recipe).count?['临期优先']:[]),...(regionalRecipeScore(recipe)?[`${homeContext.region}风味`]:[]),missing.length?'需要补购':'库存充足'],ingredients:(recipe.ingredients||[]).map(item=>({...item,available:usableStockFor(item.name).length>0}))};
  });
  const emptyMessage=mode==='expiry'?'菜谱库暂时没有符合忌口条件的菜谱，可以调整偏好后再试试。':'暂时没有合适的两人晚餐菜谱，可以换个条件试试。';
  return {recipes,alerts:[],shopping:recipes.length?recipeMissingItems(recipes[0]).map(item=>({...item,quantity:item.suggestedQuantity})):[],emptyMessage};
}
function recommendationShoppingModal(recipe){
  recommendationShoppingDraft=recipe?recipeMissingItems(recipe):(agentResult?.shopping||[]).map(item=>({...item,suggestedQuantity:Number(item.quantity)||1,unit:item.unit||'个',category:item.category||'其他'}));
  if(!recommendationShoppingDraft.length){toast('这道菜无需补购');return;}
  const pending=new Map((state.shopping||[]).filter(item=>item.status==='pending').map(item=>[canonicalFoodName(item.name),item]));
  const rows=recommendationShoppingDraft.map((item,index)=>{
    const existing=pending.get(canonicalFoodName(item.name));
    return '<section class="recommendation-shopping-item"><strong>食材 '+(index+1)+'</strong><label>食材名称</label><input name="name-'+index+'" readonly value="'+esc(item.name)+'"><div class="recommendation-shopping-fields"><div><label>数量</label><input name="quantity-'+index+'" type="number" min="0.1" step="0.1" required '+(existing?'value="'+esc(existing.quantity)+'"':'placeholder="请填写数量"')+'></div><div><label>单位</label><input name="unit-'+index+'" required value="'+esc(existing?.unit||item.unit)+'"></div></div><p class="meta">'+(existing?'已在采购清单中，可调整数量':'建议约 '+esc(item.suggestedQuantity)+' '+esc(item.unit)+'，请按实际采购调整')+'</p></section>';
  }).join('');
  modal('<div class="recommendation-shopping-modal"><h2>确认采购食材</h2><p class="meta">食材名称已填好，填写数量后加入采购清单。</p><form id="recommendation-shopping-form"><div class="recommendation-shopping-list">'+rows+'</div><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存到采购清单</button></div></form></div>');
}
function recommendationCard(recipe,index){
  const library=libraryRecipeFor(recipe);
  const image=homepage.recipeImage(library||recipe);
  const visual=image?'<img class="recipe-image" src="'+esc(image)+'" alt="'+esc(recipe.title)+'" loading="lazy">':'<span class="recipe-emoji">'+esc(recipe.imageEmoji||'🍲')+'</span>';
  return '<button type="button" class="recipe-card" data-home-action="open-recommendation-preview" data-index="'+index+'"><div class="recipe-visual">'+visual+'<span class="recipe-visual-label">为你推荐</span></div><div class="recipe-body"><h3>'+esc(recipe.title)+'</h3><div class="meta"><span>'+esc(recipe.duration||30)+' 分钟</span><span>·</span><span>'+esc(recipe.difficulty||'简单')+'</span></div>'+tags(recipe.tags||[])+'</div></button>';
}
function recommendationPreview(recipe,sourceLabel='为你推荐'){
  const library=libraryRecipeFor(recipe);
  const details=library||recipe;
  const image=homepage.recipeImage(details);
  const ingredients=Array.isArray(details.ingredients)?details.ingredients:[];
  const steps=Array.isArray(details.steps)?details.steps:[];
  const ingredientNames=ingredients.map(item=>typeof item==='string'?item:item?.name).filter(Boolean).slice(0,8);
  const method=steps.map(step=>typeof step==='string'?step:step?.text||step?.title).filter(Boolean).slice(0,3).join(' ');
  const photo=image?'<img src="'+esc(image)+'" alt="'+esc(recipe.title)+'" loading="lazy">':'<span aria-label="菜品图片待补充">'+esc(recipe.imageEmoji||'🍲')+'</span>';
  const buy=recipeMissingItems(recipe).length?'<button type="button" class="primary-button" data-action="open-recommendation-shopping" data-recipe-id="'+esc(recipe.id)+'">采购缺少食材</button>':'';
  const next=(library?'<button type="button" class="primary-button" data-action="open-recipe" data-id="'+esc(library.id)+'">查看完整菜谱 ›</button>':'<p>这道菜暂未录入菜谱，先看看上面的简要做法吧。</p>')+buy;
  modal('<div class="home-recommendation-modal"><button type="button" class="modal-close" aria-label="关闭" data-action="close-modal">×</button><p class="eyebrow">'+esc(sourceLabel)+'</p><h2>'+esc(recipe.title||'这道菜')+'</h2><div class="home-recommendation-copy"><strong>需要的食材</strong><p>'+esc(ingredientNames.length?ingredientNames.join('、'):'食材信息暂未补齐')+'</p><strong>做法概览</strong><p>'+esc(method||'做法信息暂未补齐')+'</p></div><div class="home-recommendation-footer"><div class="home-recommendation-image">'+photo+'</div><div class="home-recommendation-next">'+next+'</div></div></div>');
}
function agentPanel(result){
  const suggestions=Array.isArray(result.recipes)?result.recipes:[];
  const first=suggestions[0];
  const second=suggestions[1];
  const advice=first?(second?'今天可以做'+first.title+'，也可以试试'+second.title+'！都是常见家常菜，做起来不复杂。':'今天推荐'+first.title+'！这道菜做法家常，适合在家做。'):(result.emptyMessage||'这次还没找到合适的做法，可以换个口味再试试。');
  const recommendations=suggestions.length?'<div class="recipe-scroll">'+suggestions.map(recommendationCard).join('')+'</div>':'<p class="agent-empty-recipes">这次暂时没有合适的菜谱，换个做法再问问我吧。</p>';
  const alerts=result.alerts?.length?'<div class="section-title"><h2>预警</h2><button data-tab-go="inventory">去处理</button></div>'+result.alerts.map(a=>'<div class="alert-row"><span class="alert-dot"></span><div><strong>'+esc(a.name)+'</strong><p>'+esc(a.message)+'</p></div></div>').join(''):'';
  const shoppingItems=first?recipeMissingItems(first):(result.shopping||[]);
  const shopping=shoppingItems.length?'<div class="section-title"><h2>建议补购</h2><button data-action="open-recommendation-shopping" '+(first?'data-recipe-id="'+esc(first.id)+'"':'')+'>填写采购数量</button></div>'+shoppingItems.map(i=>'<div class="alert-row"><span>＋</span><div><strong>'+esc(i.name)+'</strong><p>用于 '+esc(i.source||first?.title||'推荐菜谱')+'</p></div></div>').join(''):'';
  return '<section class="card agent-result" id="agent-result"><p class="result-summary agent-advice"><strong>管家建议：</strong>'+esc(advice)+'</p><div class="section-title"><h2>为你推荐</h2></div>'+recommendations+alerts+shopping+'</section>';
}
app.addEventListener('click', event => {
  const button=event.target.closest('.home-page [data-home-action]');
  if(currentTab!=='home'||!button)return;
  if(button.dataset.homeAction==='open-recommendation-preview'){
    const recipe=agentResult?.recipes?.[Number(button.dataset.index)];
    if(recipe)recommendationPreview(recipe,'为你推荐');
    return;
  }
  if(button.dataset.homeAction==='open-daily-recommendation-preview'){
    const recipe=findRecipe(button.dataset.id);
    if(recipe)recommendationPreview(recipe,'每日推荐');
  }
});
// Saved daily recommendations and AI recommendations share one purchase flow.
// Resolve the recipe from either source before the legacy handler runs.
document.addEventListener('click', event => {
  const button=event.target.closest('[data-action="open-recommendation-shopping"][data-recipe-id]');
  if(!button)return;
  const recipe=findRecipe(button.dataset.recipeId);
  if(!recipe)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  recommendationShoppingModal(recipe);
}, true);
function homeShopping(){const pending=state.shopping.filter(item=>item.status==='pending');const bought=state.shopping.filter(item=>item.status==='bought');return `<div class="section-title"><h2>采购清单</h2><span class="meta">待买 ${pending.length} 项</span></div><section class="card">${pending.length?pending.map(shoppingRow).join(''):`<div class="empty"><span class="empty-icon">🧺</span><b>待买清单是空的</b><span>从菜谱导入缺料，或手动新增食材。</span></div>`}<div class="bottom-action"><button class="secondary-button" data-action="add-shopping">＋ 新增食材</button>${bought.length?'<button class="primary-button" data-action="sync-shopping">一键同步入库</button>':'<button class="secondary-button" data-tab-go="recipes">去菜谱补货</button>'}</div></section>`;}
function inventory(){
  if(inventoryEntryView==='manual')return manualInventoryEntry();
  if(inventoryEntryView==='photo')return photoInventoryEntry();
  const locations=['冷藏','冷冻'];
  const categories=['全部','蔬果','肉蛋','海鲜','其他'];
  const selectedCount=selectedInventoryIds.size;
  return `<div class="tab-switch">${locations.map(loc=>`<button class="${inventoryLocation===loc?'active':''}" data-action="inventory-location" data-location="${loc}">${loc}</button>`).join('')}</div>
  <div class="inventory-toolbar"><div class="inventory-category-tabs">${categories.map(category=>`<button class="${inventoryCategory===category?'active':''}" data-action="inventory-category" data-category="${category}">${category}</button>`).join('')}</div><label class="inventory-sort-control"><span class="sr-only">库存排序</span><select aria-label="库存排序" data-action="inventory-sort"><option value="date" ${inventorySort==='date'?'selected':''}>存入日期</option><option value="freshness" ${inventorySort==='freshness'?'selected':''}>新鲜度</option></select></label></div>
  <div id="inventory-list">${inventoryList(inventoryLocation)}</div>
  <div class="inventory-actions ${inventoryManageMode?'managing':''}">
    <button class="secondary-button" data-action="${inventoryManageMode?'cancel-inventory-management':'open-inventory'}">${inventoryManageMode?'完成管理':'＋ 食材录入'}</button>
    <button class="${inventoryManageMode?'danger-button':'primary-button'}" data-action="${inventoryManageMode?'batch-delete-inventory':'manage-inventory'}" ${inventoryManageMode&&selectedCount===0?'disabled':''}>${inventoryManageMode?`删除${selectedCount?`（${selectedCount}）`:''}`:'批量管理'}</button>
  </div>`;
}
function manualEntryCategoryFor(food){
  if(['蔬菜','菌菇'].includes(food.category_tag))return '蔬菜';
  if(food.category_tag==='水果')return '水果';
  if(['肉类','蛋类'].includes(food.category_tag))return '肉蛋';
  if(food.category_tag==='海鲜')return '海鲜';
  return food.category_tag;
}
function manualEntryFoods(){
  const allowed=['蔬菜','水果','肉蛋','海鲜','豆制品','烘焙','乳制品'];
  const query=manualEntrySearch.trim().toLowerCase();
  return foodKnowledge.filter(food=>{
    const category=manualEntryCategoryFor(food);
    if(!allowed.includes(category))return false;
    if(query)return (food.common_names||[food.canonical_name]).some(name=>name.toLowerCase().includes(query));
    return category===manualEntryCategory;
  }).sort((a,b)=>a.canonical_name.localeCompare(b.canonical_name,'zh-CN'));
}
function manualFoodListHTML(){
  const foods=manualEntryFoods();
  if(!foods.length)return '<div class="manual-entry-empty"><span>没有找到相关食材</span><button data-action="open-ai-entry">✦ AI录入</button></div>';
  return foods.map(food=>{const aliases=(food.common_names||[]).filter(name=>name!==food.canonical_name).slice(0,2);const unit=Object.keys(food.units||{})[0]||'个';return `<div class="entry-food-item"><span class="entry-food-icon">${food.icon}</span><div><strong>${esc(food.canonical_name)}</strong><small>${aliases.length?esc(aliases.join(' / ')):esc(food.category_tag)}</small></div><button aria-label="添加${esc(food.canonical_name)}" data-action="add-knowledge-food" data-name="${esc(food.canonical_name)}" data-unit="${esc(unit)}">+</button></div>`;}).join('');
}
function addToManualEntryCart(item){
  const canonicalName=findFoodKnowledge(item.name)?.canonical_name||item.name;
  if(!item.gramsPerUnit&&Number(item.estimatedGrams)>0&&Number(item.quantity)>0)item.gramsPerUnit=Number(item.estimatedGrams)/Number(item.quantity);
  const existing=manualEntryCart.find(entry=>entry.name===canonicalName&&entry.unit===item.unit&&entry.location===item.location);
  if(existing)existing.quantity=Number(existing.quantity)+Number(item.quantity||1);
  else manualEntryCart.push({...item,id:`cart-${Date.now()}-${Math.random().toString(16).slice(2)}`,name:canonicalName,quantity:Number(item.quantity||1)});
}
function steppedManualCartQuantity(value,delta){const current=Math.max(1,Number(value)||1);return Number(delta)>0?Math.floor(current)+1:Math.max(1,Math.ceil(current)-1);}
function manualCartHTML(){
  const itemCount=manualEntryCart.length;
  const rows=manualEntryCart.map(item=>{const food=findFoodKnowledge(item.name);return `<div class="manual-cart-item"><span>${foodIcon(item.name)}</span><strong>${esc(item.name)}</strong><div class="manual-cart-quantity"><button data-action="manual-cart-step" data-id="${item.id}" data-delta="-1">−</button><input aria-label="${esc(item.name)}数量" data-cart-quantity="${item.id}" data-integer-step type="number" min="1" step="any" value="${esc(item.quantity)}"><button data-action="manual-cart-step" data-id="${item.id}" data-delta="1">+</button></div><select aria-label="${esc(item.name)}单位" data-cart-unit="${item.id}">${manualEntryUnitOptions(food,item.unit)}</select><button class="manual-cart-remove" aria-label="移除${esc(item.name)}" data-action="remove-manual-cart-item" data-id="${item.id}">×</button></div>`;}).join('');
  return `<section class="manual-cart ${manualCartExpanded?'expanded':''}">${manualCartExpanded&&itemCount?`<div class="manual-cart-items">${rows}</div>`:''}<div class="manual-cart-bar"><button class="manual-cart-summary" data-action="toggle-manual-cart"><span class="manual-cart-icon-wrap"><span class="manual-cart-icon">🧺</span><strong class="manual-cart-count" aria-live="polite" aria-atomic="true"><b>${itemCount}</b></strong></span><span class="manual-cart-copy"><span class="manual-cart-label">食材待录入</span><small>${manualCartExpanded?'收起':'查看并修改'}</small></span></button><button class="manual-cart-complete" data-action="complete-manual-entry" ${itemCount?'':'disabled'}>完成录入</button></div></section>`;
}
function animateManualCart(){requestAnimationFrame(()=>{const cart=document.querySelector('.manual-cart');if(!cart)return;cart.classList.add('just-added');setTimeout(()=>cart.classList.remove('just-added'),820);});}
function flyManualCountToCart(origin,count){
  const target=document.querySelector('.manual-cart-icon-wrap');
  if(!origin||!target||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){animateManualCart();return;}
  const destination=target.getBoundingClientRect(),bubble=document.createElement('span');
  bubble.className='manual-cart-fly-count';bubble.textContent=String(count);
  bubble.style.left=`${origin.left+origin.width/2-12}px`;bubble.style.top=`${origin.top+origin.height/2-12}px`;document.body.appendChild(bubble);
  const dx=destination.left+destination.width/2-(origin.left+origin.width/2),dy=destination.top+destination.height/2-(origin.top+origin.height/2);
  if(!bubble.animate){bubble.remove();animateManualCart();return;}
  const motion=bubble.animate([{transform:'translate(0,0) scale(.72)',opacity:.9},{transform:`translate(${dx*.42}px,${dy*.42-72}px) scale(1.12)`,opacity:1,offset:.46},{transform:`translate(${dx}px,${dy}px) scale(.55)`,opacity:.25}],{duration:1000,easing:'cubic-bezier(.2,.72,.25,1)',fill:'forwards'});
  const bounceTimer=setTimeout(animateManualCart,350);
  motion.onfinish=()=>bubble.remove();motion.oncancel=()=>{clearTimeout(bounceTimer);bubble.remove();};
}
function manualInventoryEntry(){
  const categories=['蔬菜','水果','肉蛋','海鲜','豆制品','烘焙','乳制品'];
  return `<label class="manual-entry-search"><span>🔍</span><input id="manual-food-search" value="${esc(manualEntrySearch)}" placeholder="搜索食材名称或常用叫法"></label><div class="manual-entry-layout"><aside class="entry-sidebar">${categories.map(category=>`<button class="${manualEntryCategory===category&&!manualEntrySearch?'active':''}" data-action="manual-entry-category" data-category="${category}">${category}</button>`).join('')}</aside><section class="entry-food-panel"><p class="entry-panel-note">${manualEntrySearch?'搜索结果':'点击 + 加入待录入清单'}</p><div class="entry-food-list" id="manual-entry-food-list">${manualFoodListHTML()}</div></section></div>${manualCartHTML()}`;
}
function photoInventoryEntry(){return `<section class="photo-entry-card"><div class="photo-entry-icon">⌑</div><h2>拍摄或选择食材照片</h2><p>电脑和手机均可申请摄像头权限，也可以从相册或文件中选择图片。</p><div class="photo-entry-actions"><button class="photo-entry-button" data-action="start-camera">📷 打开摄像头</button><label class="photo-entry-button secondary">▧ 选择图片<input class="food-photo-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp"></label></div>${photoPreviewUrl?`<img class="photo-entry-preview" src="${esc(photoPreviewUrl)}" alt="待识别食材照片"><button class="primary-button photo-confirm-button" data-action="identify-photo">AI识别食材</button>`:`<div class="camera-stage" id="camera-stage"><video id="camera-preview" autoplay playsinline muted></video><div class="photo-entry-placeholder">点击“打开摄像头”开始实时取景</div><button class="primary-button camera-capture-button" data-action="capture-camera" hidden>拍摄照片</button></div>`}<p class="photo-entry-hint">浏览器会先请求摄像头权限；识别结果确认后才会加入待录入清单。</p></section>`;}
function inventoryList(location){
  const items=state.inventory.filter(item=>item.location===location&&(inventoryCategory==='全部'||inventoryCategoryFor(item.name)===inventoryCategory)).sort(compareInventoryItems);
  return items.length?`<section class="card inventory-card ${inventoryManageMode?'manage-mode':''}">${items.map(item=>`<div class="inventory-swipe ${inventoryManageMode?'batch-mode':''}">
    ${inventoryManageMode?'':`<div class="inventory-swipe-actions"><button class="edit" data-action="edit-inventory" data-id="${esc(item.id)}">编辑</button><button class="delete" data-action="delete-inventory" data-id="${esc(item.id)}">删除</button></div>`}
    <div class="inventory-item inventory-swipe-content ${selectedInventoryIds.has(item.id)?'selected':''}">
    ${inventoryManageMode?`<input class="inventory-select" aria-label="选择${esc(item.name)}" type="checkbox" ${selectedInventoryIds.has(item.id)?'checked':''} data-action="toggle-inventory-selection" data-id="${esc(item.id)}">`:''}
    <div class="food-icon">${foodIcon(item.name)}</div>
    <div class="item-main"><div class="item-name-row"><strong>${esc(item.name)}</strong>${freshnessBadge(item)}</div><p>${esc(item.location)} · ${esc(item.purchaseDate||item.createdAt||today)}存入</p></div>
    <div class="item-side"><strong>${esc(item.quantity)} ${esc(item.unit)}</strong><small>${esc(estimatedWeight(item))}</small></div>
  </div></div>`).join('')}</section>`:'<section class="card empty"><span class="empty-icon">🧊</span><b>这里还没有食材</b><span>点击下方“食材录入”添加库存吧。</span></section>';
}
function recipes(){const recipes=state.recipes||[];return `${selectedRecipe ? recipeDetail(selectedRecipe) : `<div class="tab-switch">${['临期优先','现有食材','补购模式'].map(m=>`<button class="${recipeMode===m?'active':''}" data-action="recipe-mode" data-mode="${m}">${m}</button>`).join('')}</div>${recipes.length ? `<div class="recipe-list">${filterRecipes(recipes).map(recipeCard).join('')}</div>` : '<section class="card empty"><span class="empty-icon">🍲</span><b>还没有生成菜谱</b><span>去首页问问厨房管家，它会根据你的真实库存推荐。</span><div class="bottom-action"><button class="primary-button" data-tab-go="home">去问厨房管家</button></div></section>'}`}`;}
function filterRecipes(list){if(recipeMode==='临期优先')return [...list].sort((a,b)=>(b.tags||[]).includes('临期优先')-(a.tags||[]).includes('临期优先'));if(recipeMode==='补购模式')return [...list].sort((a,b)=>(b.tags||[]).includes('需要补购')-(a.tags||[]).includes('需要补购'));return [...list].sort((a,b)=>(b.tags||[]).includes('库存充足')-(a.tags||[]).includes('库存充足'));}
function recipeDetail(recipe){const favorite=state.favorites.includes(recipe.id);return `<section class="detail-hero"><button class="back-button" data-action="back-recipes">‹ 返回</button><button class="icon-button fav" data-action="toggle-favorite" data-id="${recipe.id}">${favorite?'♥':'♡'}</button><div class="dish-emoji">${esc(recipe.imageEmoji||'🍲')}</div><h2>${esc(recipe.title)}</h2><p>${esc(recipe.subtitle||recipe.reason||'')}</p><div class="detail-meta"><span>${recipe.duration||30} 分钟</span><span>${esc(recipe.difficulty||'简单')}</span><span>${(recipe.appliances||[]).join('、')||'家常厨具'}</span></div></section><section class="serving-control"><span>用餐人数</span><div><button class="circle-button" data-action="serving" data-delta="-1">−</button><strong class="servings-value"> ${recipe.servings||2} 人 </strong><button class="circle-button" data-action="serving" data-delta="1">＋</button></div></section><div class="section-title"><h2>食材准备</h2></div><section class="card">${recipe.ingredients.map(ingredientRow).join('')}</section>${recipe.steps?.length?`<div class="section-title"><h2>做法预览</h2><button class="text-button">完整步骤</button></div><section class="card">${recipe.steps.map((s,i)=>`<div class="step"><span class="step-number">${i+1}</span><p>${esc(s)}</p></div>`).join('')}</section>`:''}<div class="sticky-actions"><button class="secondary-button" data-action="add-recipe-shopping">加入采购清单</button><button class="primary-button" data-action="start-cooking">开始制作</button></div>`;}
function ingredientRow(item){const missing=!item.available;return `<div class="inventory-item"><div class="food-icon">${foodIcon(item.name)}</div><div class="item-main"><strong>${esc(item.name)}</strong><p>${missing?'缺少食材':`冰箱已有 ${esc(item.quantity)}${esc(item.unit)}`}${item.substitutes?.length?` · 可替换：${esc(item.substitutes[0])}`:''}</p></div><div class="item-side"><strong>${esc(item.quantity)} ${esc(item.unit)}</strong><small class="${missing?'expiry':''}">${missing?'需要补购':'已有食材'}</small></div></div>`;}
function shopping(){const pending=state.shopping.filter(i=>i.status==='pending'), bought=state.shopping.filter(i=>i.status==='bought');const list=shoppingTab==='pending'?pending:bought;return `<div class="tab-switch"><button class="${shoppingTab==='pending'?'active':''}" data-action="shopping-tab" data-status="pending">待买项 ${pending.length}</button><button class="${shoppingTab==='bought'?'active':''}" data-action="shopping-tab" data-status="bought">已买项 ${bought.length}</button></div>${shoppingTab==='pending'?`<section class="card"><strong>待买 ${pending.length} 项</strong><p class="meta">从菜谱导入的缺料会显示来源</p></section>`:''}<section class="card">${list.length?list.map(shoppingRow).join(''):`<div class="empty"><span class="empty-icon">🧺</span><b>${shoppingTab==='pending'?'采购清单是空的':'还没有已买食材'}</b><span>${shoppingTab==='pending'?'去菜谱页生成缺料清单吧。':'完成采购后在这里同步入库。'}</span></div>`}</section>${shoppingTab==='bought'&&bought.length?'<div class="bottom-action"><button class="primary-button" data-action="sync-shopping">一键同步入库</button></div>':''}<div class="bottom-action"><button class="secondary-button" data-action="add-shopping">＋ 新增食材</button><button class="secondary-button" data-action="clear-shopping">清空</button></div>`;}
function shoppingRow(item){return `<div class="shopping-item"><input class="shopping-check" type="checkbox" ${item.status==='bought'?'checked':''} data-action="toggle-shopping" data-id="${item.id}"><div class="item-main ${item.status==='bought'?'strike':''}"><strong>${esc(item.name)}</strong><p>${esc(item.source||'手动新增')} ${item.completedAt?`· ${esc(item.completedAt)}`:''}</p></div><div class="item-side"><strong>${esc(item.quantity)} ${esc(item.unit)}</strong><small>${esc(item.category||'其他')}</small></div><button class="text-button" data-action="delete-shopping" data-id="${item.id}">删除</button></div>`;}
function profile(){
  const p=state.preferences;
  const user=state.profile||{};
  const profileName=user.name||'我的厨房';
  const profileAvatar=user.avatar?'<img src="'+esc(user.avatar)+'" alt="用户头像">':'👩🏻‍🍳';
  const favorites=(state.recipes||[]).filter(r=>state.favorites.includes(r.id));
  const history=(state.history||[]).filter(h=>h.type!=='cook'||h.recipeId);
  const cooked=history.filter(h=>h.type==='cook'&&h.recipeId).length;
  const preferenceTags=[...(p.flavors||[]),...(p.needs||[])].slice(0,4);
  const avoidTags=p.avoid||[];
  const allergyTags=p.allergies||[];
  return `<section class="profile-cover">
    <div class="profile-cover-top"><span class="profile-kicker">食光管家</span><button class="profile-more" aria-label="编辑个人资料" data-action="open-profile-settings">···</button></div>
    <div class="profile-person"><div class="profile-avatar">${profileAvatar}</div><div><h2>${esc(profileName)}</h2><p class="profile-signature">${esc(user.signature??'让每一餐都更合心意')}</p></div></div>
    <div class="profile-summary"><div><b>${cooked}</b><span>完成烹饪</span></div><i></i><div><b>${favorites.length}</b><span>收藏菜谱</span></div></div>
  </section>
  <section class="profile-preferences-card">
    <div class="profile-card-heading"><div><span class="profile-icon">✦</span><div><h2>偏好记忆</h2><p>这些信息会帮助管家安排更适合你的菜谱</p></div></div><button data-action="edit-preferences">编辑</button></div>
    <div class="preference-group"><span>喜欢的口味</span><div class="preference-tags">${preferenceTags.length?preferenceTags.map(tag=>'<em>'+esc(tag)+'</em>').join(''):'<small>暂未设置</small>'}</div></div>
    <div class="preference-group"><span>忌口 / 不想吃</span><div class="preference-tags muted">${avoidTags.length?avoidTags.map(tag=>'<em>'+esc(tag)+'</em>').join(''):'<small>暂未设置</small>'}</div></div>
    <div class="preference-group"><span>过敏提示</span><div class="preference-tags danger">${allergyTags.length?allergyTags.map(tag=>'<em>'+esc(tag)+'</em>').join(''):'<small>暂未设置</small>'}</div></div>
    <div class="reminder-row"><div><strong>临期预警</strong><span>临期食材优先提醒</span></div><input class="switch" aria-label="临期预警" type="checkbox" ${p.reminder?'checked':''} data-action="toggle-reminder"></div>
  </section>
  <div class="section-title profile-section-title"><h2>我的收藏</h2></div>
  <section class="card profile-favorites">${favorites.length?favorites.slice(0,3).map(r=>'<div class="inventory-item"><div class="food-icon">'+esc(r.imageEmoji||'🍲')+'</div><div class="item-main"><strong>'+esc(r.title)+'</strong><p>'+esc(r.duration||30)+' 分钟 · '+esc(r.difficulty||'简单')+'</p></div><span class="row-arrow">›</span></div>').join(''):'<div class="profile-empty"><span>♡</span><div><b>还没有收藏菜谱</b><p>喜欢的菜谱，点按爱心就会保存在这里。</p></div><button data-tab-go="recipes" data-return-tab="profile">去发现</button></div>'}</section>
  <div class="section-title profile-section-title"><h2>最近记录</h2><span class="meta">${history.length} 条</span></div>
  <section class="card profile-history">${history.length?history.slice(0,4).map(h=>'<div class="history-row"><span class="history-icon '+esc(h.type||'other')+'">'+(h.type==='cook'?'⌁':'＋')+'</span><div><strong>'+esc(h.title)+'</strong><p>'+esc(h.detail||'')+' '+esc(h.date||'')+'</p></div></div>').join(''):'<div class="empty"><span class="empty-icon">◷</span><b>还没有记录</b><span>完成烹饪或采购入库后会显示在这里。</span></div>'}</section>
  <section class="profile-menu-card"><h2>历史</h2><button class="profile-menu-row" data-action="open-cooking-history"><span class="menu-icon warm">▤</span><span>烹饪历史</span><b>›</b></button><button class="profile-menu-row" data-action="open-consumption-review"><span class="menu-icon warm">▭</span><span>消耗复盘</span><b>›</b></button></section>
  <section class="profile-menu-card"><h2>设置</h2><button class="profile-menu-row" data-action="open-reminder-settings"><span class="menu-icon">⚙</span><span>提醒设置</span><b>›</b></button><button class="profile-menu-row" data-action="edit-preferences"><span class="menu-icon">▤</span><span>偏好记忆</span><b>›</b></button><button class="profile-menu-row" data-action="open-privacy-data"><span class="menu-icon">⚙</span><span>隐私与数据管理</span><b>›</b></button></section>`;
}
function render(){if(!state)return;if(inventoryEntryView!=='photo')stopCamera();headerContent();app.innerHTML=currentTab==='home'?home():currentTab==='inventory'?inventory():currentTab==='recipes'?recipes():currentTab==='shopping'?shopping():profile();document.querySelectorAll('.nav-item').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===currentTab));}
function findRecipe(id){return (state.recipes||[]).find(r=>r.id===id)||agentResult?.recipes?.find(r=>r.id===id)||(typeof recipeLibrary==='undefined'?[]:recipeLibrary).find(r=>r.id===id);}
function modal(content){modalLayer.hidden=false;modalLayer.innerHTML=`<div class="modal">${content}</div>`;}
function closeModal(){modalLayer.hidden=true;modalLayer.innerHTML='';}
function cityLocationModal(){
  const cities=['北京','上海','天津','重庆','广州','深圳','杭州','南京','苏州','成都','武汉','西安','长沙','郑州','济南','青岛','沈阳','大连','长春','哈尔滨','福州','厦门','南昌','合肥','石家庄','太原','呼和浩特','南宁','海口','贵阳','昆明','拉萨','兰州','西宁','银川','乌鲁木齐','宁波','无锡','佛山','东莞','珠海','温州','泉州','烟台','洛阳','桂林','三亚'];
  modal(`<div class="city-location-modal"><h2>修改所在城市</h2><p class="meta">仅支持中国城市，修改后会同步更新天气、地域推荐和节气提示。</p><form id="city-location-form"><label>城市</label><input name="city" list="china-city-list" required autocomplete="off" placeholder="搜索中国城市" value="${esc(homeContext.city||'')}"><datalist id="china-city-list">${cities.map(city=>`<option value="${city}"></option>`).join('')}</datalist><div class="modal-actions"><button type="button" class="secondary-button" data-action="use-current-location">使用当前位置</button><button class="primary-button" type="submit">确认城市</button></div></form></div>`);
}
function inventoryEntryChoiceModal(){modal(`<h2>选择录入方式</h2><div class="entry-method-grid"><button data-action="open-ai-entry"><span>✦</span><div><strong>AI录入</strong><small>用一句话批量识别食材信息</small></div></button><button data-action="open-photo-entry"><span>⌑</span><div><strong>拍照录入</strong><small>拍摄或选择食材照片</small></div></button><button data-action="open-manual-entry"><span>▤</span><div><strong>手动录入</strong><small>从知识库分类选择食材</small></div></button></div><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button></div>`);}
function manualEntryUnitOptions(food,selected){return [...new Set(['克','斤',...Object.keys(food?.units||{}),selected,...commonUnits])].map(unit=>`<option ${unit===selected?'selected':''}>${unit}</option>`).join('');}
function manualEntryEstimatedWeight(name,quantity,unit){const grams=unit==='克'?1:findFoodKnowledge(name)?.units?.[unit];return grams?`预计约 ${Math.round(Number(quantity||0)*grams)}g`:'暂无可用的克数估算';}
function manualFoodConfirmModal(name='',custom=false){
  const food=findFoodKnowledge(name),unit=Object.keys(food?.units||{})[0]||'个',location=food?.default_storage==='frozen'?'冷冻':'冷藏';
  modal(`<h2>${custom?'人工录入食材':'确认食材信息'}</h2><form id="manual-food-confirm-form" data-custom="${custom?'true':'false'}"><label>食材名称</label><input name="name" required ${custom?'placeholder="输入食材名称"':'readonly'} value="${esc(name)}"><div class="manual-confirm-row"><div><label>数量</label><input name="quantity" type="number" min="0.1" step="0.1" required value="1"></div><div><label>计量单位</label><select name="unit">${manualEntryUnitOptions(food,unit)}</select></div></div><p class="manual-estimated-weight">${manualEntryEstimatedWeight(name,1,unit)}</p><label>预估储存位置</label><select name="location"><option ${location==='冷藏'?'selected':''}>冷藏</option><option ${location==='冷冻'?'selected':''}>冷冻</option></select><label>存入日期</label><input name="purchaseDate" type="date" required value="${today}"><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">加入待录入</button></div></form>`);
}
function aiInventoryModal(){modal(`<h2 class="ai-entry-title">AI录入</h2><form class="ai-inventory-prompt" id="ai-inventory-request-form"><label>您需要在冰箱里面放置什么食材？</label><textarea name="text" required placeholder="请输入如：我要放入3个西红柿、5个黄瓜、3斤猪肉，都放入冷藏层"></textarea><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">生成清单</button></div></form>`);}
function reconcileAiItems(items){return items.map(item=>{const food=findFoodKnowledge(item.name),quantity=Number(item.quantity)||1;if(!food)return {...item,gramsPerUnit:Number(item.estimatedGrams)>0?Number(item.estimatedGrams)/quantity:null};const knownUnits=food.units||{};const unit=['克','g','斤'].includes(item.unit)||knownUnits[item.unit]?item.unit:Object.keys(knownUnits)[0]||item.unit;const perUnit=['克','g'].includes(unit)?1:unit==='斤'?500:knownUnits[unit];const location=food.default_storage==='frozen'?'冷冻':'冷藏';const calibrated={...item,name:food.canonical_name,unit,location,gramsPerUnit:perUnit||null,estimatedGrams:perUnit?Math.round(quantity*perUnit):item.estimatedGrams};calibrated.freshness=freshnessFor({...calibrated,aiFreshness:null}).label;return calibrated;});}
function aiInventoryReviewModal(items){const rows=items.map((item,index)=>`<section class="ai-review-item" data-ai-item data-estimated-grams="${esc(item.estimatedGrams||'')}" data-grams-per-unit="${esc(item.gramsPerUnit||'')}" data-base-unit="${esc(item.unit)}" data-freshness="${esc(item.freshness||'新鲜')}" data-category-tag="${esc(item.categoryTag||'其他')}" data-aliases="${esc(JSON.stringify(item.aliases||[]))}"><strong>食材 ${index+1}</strong><label>食材名称</label><input name="name" required value="${esc(item.name)}"><div class="manual-confirm-row"><div><label>数量</label><input name="quantity" type="number" min="0.1" step="0.1" required value="${esc(item.quantity)}"></div><div><label>计量单位</label><select name="unit">${manualEntryUnitOptions(findFoodKnowledge(item.name),item.unit)}</select></div></div><p class="manual-estimated-weight">预计约 ${esc(item.estimatedGrams||0)}g · ${esc(item.freshness||'新鲜')}</p><div class="manual-confirm-row"><div><label>储存位置</label><select name="location"><option ${item.location==='冷藏'?'selected':''}>冷藏</option><option ${item.location==='冷冻'?'selected':''}>冷冻</option></select></div><div><label>存入日期</label><input name="purchaseDate" type="date" required value="${esc(item.purchaseDate||today)}"></div></div></section>`).join('');const direct=aiEntryDestination==='inventory';modal(`<h2>确认 AI 识别结果</h2><p class="meta">${direct?'请检查或修改后直接录入冰箱。':'请检查或修改后加入待录入清单。'} 确认后，新知识会在不覆盖原知识的前提下补充到本地知识库。</p><form id="ai-inventory-review-form"><div class="ai-review-list">${rows}</div><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">${direct?'确认录入':'加入待录入'}</button></div></form>`);}
async function syncConfirmedFoodKnowledge(items){
  try{
    const result=await api('/api/food-knowledge/supplement',{method:'POST',body:JSON.stringify({items})});
    const knowledge=await api('/food_knowledge.json');
    foodKnowledge=knowledge.foods||foodKnowledge;
    return result;
  }catch(error){return {error:error.message};}
}
function updateAiReviewWeight(row){const name=row.querySelector('[name="name"]').value.trim(),unit=row.querySelector('[name="unit"]').value,quantity=Number(row.querySelector('[name="quantity"]').value)||0,food=findFoodKnowledge(name);const perUnit=['克','g'].includes(unit)?1:unit==='斤'?500:food?.units?.[unit]||(unit===row.dataset.baseUnit?Number(row.dataset.gramsPerUnit):null);row.dataset.gramsPerUnit=perUnit||'';row.dataset.estimatedGrams=perUnit?Math.round(quantity*perUnit):'';row.querySelector('.manual-estimated-weight').textContent=perUnit?`预计约 ${Math.round(quantity*perUnit)}g · ${row.dataset.freshness}`:`暂无可用的克数估算 · ${row.dataset.freshness}`;}
function inventoryModal(item,creating=false){const editing=Boolean(item)&&!creating;const unitOptions=manualEntryUnitOptions(findFoodKnowledge(item?.name),item?.unit||'个');modal(`<h2>${editing?'编辑食材':'食材录入'}</h2><form id="inventory-form" data-id="${editing?esc(item?.id||''):''}"><label>食材名称</label><input name="name" required value="${esc(item?.name||'')}"><label>数量</label><input name="quantity" type="number" min="0" step="0.1" required value="${esc(item?.quantity||'')}"><label>常用计量单位</label><select name="unit">${unitOptions}</select><p class="weight-conversion-hint">系统将根据食材、数量和单位自动换算估计克数。</p><label>储存位置</label><select name="location"><option ${item?.location==='冷藏'?'selected':''}>冷藏</option><option ${item?.location==='冷冻'?'selected':''}>冷冻</option></select><label>购入日期</label><input name="purchaseDate" type="date" required value="${esc(item?.purchaseDate||item?.createdAt||today)}"><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存</button></div></form>`);}
function shoppingModal(){modal(`<h2>新增采购食材</h2><form id="shopping-form"><label>食材名称</label><input name="name" required><label>数量</label><input name="quantity" type="number" min="0" step="0.1" required><label>单位</label><input name="unit" required value="个"><label>分类</label><select name="category"><option>蔬果</option><option>肉禽</option><option>水产</option><option>调味品</option><option>其他</option></select><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">加入清单</button></div></form>`);}
function preferenceModal(){const p=state.preferences;modal(`<h2>编辑偏好</h2><form id="preference-form"><label>喜欢的口味（用逗号分隔）</label><input name="flavors" value="${esc((p.flavors||[]).join('，'))}"><label>忌口（用逗号分隔）</label><input name="avoid" value="${esc((p.avoid||[]).join('，'))}"><label>饮食需求（用逗号分隔）</label><input name="needs" value="${esc((p.needs||[]).join('，'))}"><label>过敏提示（用逗号分隔）</label><input name="allergies" value="${esc((p.allergies||[]).join('，'))}" placeholder="例如：花生、虾、牛奶"><p class="form-hint">过敏提示会作为菜谱生成的最高优先级规则。</p><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存偏好</button></div></form>`);}
function userProfileModal(){
  const user=state.profile||{};
  const avatar=user.avatar?'<img src="'+esc(user.avatar)+'" alt="当前头像">':'👩🏻‍🍳';
  modal('<button type="button" class="modal-close" aria-label="关闭" data-action="close-modal">×</button><h2>个人资料</h2><form id="user-profile-form"><input class="avatar-file-input" id="profile-avatar-file" name="avatar" type="file" accept="image/png,image/jpeg,image/webp"><div data-profile-fields><div class="avatar-editor"><div class="avatar-editor-preview">'+avatar+'</div><div><strong>个人头像</strong><p>支持 JPG、PNG 或 WebP，最大 2MB</p><label class="avatar-upload" for="profile-avatar-file">上传头像</label></div></div><label for="profile-name">用户名称</label><input id="profile-name" name="name" maxlength="20" value="'+esc(user.name||'我的厨房')+'" placeholder="输入你的名称"><label for="profile-signature">个性签名</label><input id="profile-signature" name="signature" maxlength="60" value="'+esc(user.signature??'让每一餐都更合心意')+'" placeholder="写一句你的个性签名（最多60字）"><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存资料</button></div></div><section class="avatar-confirmation" data-avatar-review hidden aria-label="头像预览"><h3>预览新头像</h3><p class="form-hint" data-avatar-status>正在读取图片…</p><div class="avatar-confirmation-image"></div><label class="avatar-upload" for="profile-avatar-file">重新选择</label><div class="modal-actions"><button type="button" class="secondary-button" data-action="cancel-avatar">取消更换</button><button type="button" class="primary-button" data-action="confirm-avatar" disabled>确认使用</button></div></section></form>');
}
function showAvatarReview(form,visible){
  form.querySelector('[data-profile-fields]').hidden=visible;
  form.querySelector('[data-avatar-review]').hidden=!visible;
}
async function previewProfileAvatar(input){
  const file=input.files?.[0],form=input.closest('form');
  if(!file||!form)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){input.value='';toast('请选择 JPG、PNG 或 WebP 图片');return;}
  if(file.size>2*1024*1024){input.value='';toast('头像请控制在 2MB 以内');return;}
  const selection=Symbol();form.avatarSelection=selection;
  form.avatarCandidate=null;
  const confirm=form.querySelector('[data-action="confirm-avatar"]');
  const status=form.querySelector('[data-avatar-status]');
  const preview=form.querySelector('.avatar-confirmation-image');
  confirm.disabled=true;status.textContent='正在读取图片…';preview.innerHTML='';
  showAvatarReview(form,true);
  try{
    const url=await fileToDataUrl(file);
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('图片无法打开，请重新选择。'));image.src=url;});
    if(!form.isConnected||form.avatarSelection!==selection)return;
    form.avatarCandidate=url;
    preview.innerHTML='<img src="'+esc(url)+'" alt="新头像预览">';
    status.textContent='这是头像显示的效果，确认后再保存资料。';
    confirm.disabled=false;
  }catch(error){if(form.isConnected&&form.avatarSelection===selection){input.value='';status.textContent=error.message;}}
}
document.addEventListener('change',event=>{if(event.target.id==='profile-avatar-file')previewProfileAvatar(event.target);});
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-action="confirm-avatar"],[data-action="cancel-avatar"]');
  if(!button)return;
  const form=button.closest('#user-profile-form');
  if(!form)return;
  if(button.dataset.action==='confirm-avatar'){
    if(!form.avatarCandidate)return;
    form.avatarDraft=form.avatarCandidate;
    form.querySelector('.avatar-editor-preview').innerHTML='<img src="'+esc(form.avatarDraft)+'" alt="已确认的新头像">';
  }
  form.avatarSelection=null;form.avatarCandidate=null;
  form.querySelector('[name="avatar"]').value='';
  showAvatarReview(form,false);
});
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('头像读取失败，请重新选择图片。'));reader.readAsDataURL(file);});}
function cookingHistoryModal(){const cooks=(state.history||[]).filter(h=>h.type==='cook'&&h.recipeId);const rows=cooks.length?cooks.map(h=>'<div class="history-row"><span class="history-icon cook">'+esc(h.imageEmoji||'⌁')+'</span><div><strong>'+esc(h.recipeTitle||h.title)+'</strong><p>'+esc(h.detail||'')+' · '+esc(h.date||'')+'</p></div></div>').join(''):'<div class="empty"><span class="empty-icon">◷</span><b>还没有烹饪记录</b><span>从菜谱点击开始制作并确认用量后，会显示在这里。</span></div>';modal('<h2>烹饪历史</h2><section class="modal-history">'+rows+'</section><div class="modal-actions"><button type="button" class="primary-button" data-action="close-modal">知道了</button></div>');}
function consumptionReviewModal(){const cooks=(state.history||[]).filter(h=>h.type==='cook'&&h.recipeId);modal('<h2>消耗复盘</h2><div class="review-summary"><b>'+cooks.length+'</b><span>已完成烹饪</span></div><p class="meta">仅统计从菜谱点击“开始制作”并确认实际用量的记录；确认后会同步扣减冰箱库存。</p><div class="modal-actions"><button type="button" class="primary-button" data-action="close-modal">知道了</button></div>');}
function reminderSettingsModal(){const p=state.preferences;const row=(key,title,detail)=>'<div class="reminder-setting-row"><div><strong>'+title+'</strong><p>'+detail+'</p></div><input class="switch" aria-label="'+title+'" type="checkbox" '+(p[key]?'checked':'')+' data-action="toggle-reminder-setting" data-key="'+key+'"></div>';modal('<h2>提醒设置</h2><div class="reminder-settings-list">'+row('reminder','临期食材提醒','优先提醒即将到期的食材')+'</div><div class="modal-actions"><button type="button" class="primary-button" data-action="close-modal">完成</button></div>');}
function privacyDataModal(){modal('<h2>隐私与数据管理</h2><p class="meta privacy-copy">你的偏好、库存和烹饪记录仅用于生成个性化的厨房建议。当前版本不提供家庭共享功能。</p><div class="modal-actions"><button type="button" class="primary-button" data-action="close-modal">知道了</button></div>');}
function cookingModal(recipe){const rows=recipe.ingredients.filter(i=>i.available&&i.inventoryId).map(i=>`<label>${esc(i.name)}（${esc(i.unit)}）<input type="number" data-consume="${esc(i.inventoryId)}" data-name="${esc(i.name)}" step="0.1" min="0" value="${esc(i.quantity)}"></label>`).join('');modal(`<h2>确认实际消耗</h2><p class="meta">确认后将扣减冰箱库存，并记录本次烹饪。</p><form id="cook-form" data-recipe="${esc(recipe.id)}">${rows||'<p class="meta">这道菜没有可匹配的库存食材。</p>'}<div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">确认完成</button></div></form>`);}
async function ask(question,quickMode=''){
  const mode=quickMode||(/30\s*分钟.*两人晚餐/.test(question)?'dinner':/优先用掉快过期食材/.test(question)?'expiry':'');
  const previousTitles=mode&&agentQuickMode&&mode!==agentQuickMode?(agentResult?.recipes||[]).map(recipe=>recipe.title):[];
  agentLoading=true;render();
  let succeeded=false;
  try{
    const recipeCatalog=(typeof recipeLibrary==='undefined'?[]:recipeLibrary).map(recipe=>({id:recipe.id,title:recipe.title,duration:recipe.duration,mealTypes:recipe.mealTypes||[],ingredients:(recipe.ingredients||[]).map(item=>item.name)}));
    const request=(text,avoidTitles=previousTitles)=>api('/api/agent',{method:'POST',body:JSON.stringify({question:text,recipeCatalog,quickMode:mode,avoidTitles})});
    let result;
    try{result=await request(question)}catch(error){if(!['expiry','dinner'].includes(mode))throw error;result=fallbackAgentResult(mode,previousTitles);}
    if((!result.recipes?.length&&/推荐|做|吃|早餐|午餐|晚餐|菜谱/.test(question))||(previousTitles.length&&result.recipes?.length&&result.recipes.every(recipe=>previousTitles.includes(recipe.title)))){
      try{
        const retry=await request(question+'。请从已有菜谱里选择符合忌口的常见家常菜；若有合适的不同菜谱，请避开上一次的菜名。缺料请列入采购建议。');
        if(retry.recipes?.length&&(!previousTitles.length||retry.recipes.some(recipe=>!previousTitles.includes(recipe.title))))result=retry;
      }catch(error){/* Keep the first response when the optional retry fails. */}
    }
    if(mode==='dinner')result.recipes=(result.recipes||[]).filter(recipe=>Number(recipe.duration)>0&&Number(recipe.duration)<=30&&Number(recipe.servings)===2);
    if(mode==='expiry'){
      const expiryMatches=(result.recipes||[]).filter(recipe=>recipeExpiryPriority(recipe).count>0);
      result.recipes=expiryMatches.length?expiryMatches:[];
    }
    if(['expiry','dinner'].includes(mode)&&(!result.recipes?.length||(previousTitles.length&&result.recipes.every(recipe=>previousTitles.includes(recipe.title))))){
      const fallback=fallbackAgentResult(mode,previousTitles);
      if(fallback.recipes.length||!result.recipes?.length)result=fallback;
    }
    result.recipes=sortAgentRecipes(result.recipes||[]).map((recipe,index)=>({...recipe,tags:[...(index<2&&festivalBanquetScore(recipe)?['节日家宴']:[]),...(regionalRecipeScore(recipe)?[`${homeContext.region}风味`]:[]),...(recipe.tags||[])]}));
    agentResult=result;
    agentQuickMode=mode;
    state.recipes=[...(result.recipes||[]),...(state.recipes||[]).filter(old=>!(result.recipes||[]).some(next=>next.id===old.id))];
    await persist();
    succeeded=true;
    toast('厨房管家的建议已生成');
  }catch(error){toast(error.message)}
  finally{
    agentLoading=false;render();
    if(succeeded&&currentTab==='home')requestAnimationFrame(()=>document.getElementById('agent-result')?.scrollIntoView({behavior:'smooth',block:'start'}));
  }
}
async function identifyPhotoInventory(button){if(!photoPreviewUrl)return;button.disabled=true;button.textContent='AI识别中…';try{const result=await api('/api/photo-inventory',{method:'POST',body:JSON.stringify({image:photoPreviewUrl})});aiEntryDestination='inventory';aiInventoryReviewModal(reconcileAiItems(result.items));}catch(error){toast(error.message);button.disabled=false;button.textContent='AI识别食材';}}
function stopCamera(){if(cameraStream){cameraStream.getTracks().forEach(track=>track.stop());cameraStream=null;}}
async function startCamera(button){if(!navigator.mediaDevices?.getUserMedia){toast('当前浏览器不支持摄像头访问');return;}button.disabled=true;button.textContent='正在申请权限…';try{stopCamera();cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});const video=document.getElementById('camera-preview'),stage=document.getElementById('camera-stage');video.srcObject=cameraStream;stage.classList.add('active');stage.querySelector('[data-action="capture-camera"]').hidden=false;button.textContent='摄像头已开启';}catch(error){button.disabled=false;button.textContent='📷 打开摄像头';toast(error.name==='NotAllowedError'?'摄像头权限被拒绝，请在浏览器设置中允许':'无法打开摄像头，请检查设备');}}
function captureCamera(){const video=document.getElementById('camera-preview');if(!video?.videoWidth){toast('摄像头尚未准备好');return;}const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);photoPreviewUrl=canvas.toDataURL('image/jpeg',0.9);stopCamera();render();}
async function importShopping(items){if(!items?.length){toast('当前没有需要补购的食材');return;}items.forEach(item=>state.shopping.push({id:`shop-${Date.now()}-${Math.random().toString(16).slice(2)}`,name:item.name,quantity:item.quantity,unit:item.unit,category:item.category||'其他',source:`菜谱导入 · ${item.source||selectedRecipe?.title||'智能推荐'}`,status:'pending',completedAt:''}));await persist();toast('已加入采购清单');}

document.addEventListener('click',async event=>{const target=event.target.closest('[data-action],[data-tab],[data-tab-go]');if(!target)return;if(target.dataset.tab){currentTab=target.dataset.tab;selectedRecipe=null;returnTab=null;inventoryEntryView=null;photoPreviewUrl='';if(currentTab!=='inventory'){inventoryManageMode=false;selectedInventoryIds.clear();}render();return;}if(target.dataset.tabGo){currentTab=target.dataset.tabGo;selectedRecipe=null;returnTab=target.dataset.returnTab||null;inventoryEntryView=null;photoPreviewUrl='';if(currentTab!=='inventory'){inventoryManageMode=false;selectedInventoryIds.clear();}render();return;}const action=target.dataset.action;
  if(action==='open-city-location'){cityLocationModal();return;}
  if(action==='use-current-location'){closeModal();localStorage.removeItem('home-context-cache');loadHomeContext(true);return;}
  if(action==='open-guide-reference'){homepage.openGuideReference();return;}
  if(action==='open-dinner-wheel'){dinnerWheelModal();return;}
  if(action==='spin-dinner-wheel'){
    const wheel=target.closest('.dinner-wheel');
    if(wheel?.classList.contains('spinning'))return;
    wheel?.classList.add('spinning');target.disabled=true;
    const result=document.getElementById('dinner-wheel-result');if(result)result.textContent='转盘正在选择…';
    setTimeout(()=>{wheel?.classList.remove('spinning');target.disabled=false;if(result)result.textContent='结果功能会在菜谱库接入后开放';},900);
    return;
  }
  if(action==='open-ai-entry'){aiEntryDestination=inventoryEntryView==='manual'?'cart':'inventory';aiInventoryModal();return;}
  if(action==='open-manual-entry'){closeModal();inventoryEntryView='manual';manualEntryCategory='蔬菜';manualEntrySearch='';manualCartExpanded=false;render();return;}
  if(action==='complete-manual-entry'){if(!manualEntryCart.length)return;const count=manualEntryCart.length;manualEntryCart.forEach(item=>state.inventory.push({id:`inv-${Date.now()}-${Math.random().toString(16).slice(2)}`,name:item.name,quantity:Number(item.quantity),unit:item.unit,estimatedGrams:Number(item.estimatedGrams)||null,location:item.location,purchaseDate:item.purchaseDate||today,createdAt:item.createdAt||today,freshness:item.freshness||'新鲜',aiFreshness:item.freshness||null}));await persist();manualEntryCart=[];manualCartExpanded=false;inventoryEntryView=null;inventoryCategory='全部';render();toast(`已录入 ${count} 种食材`);return;}
  if(action==='identify-photo'){identifyPhotoInventory(target);return;}
  if(action==='start-camera'){startCamera(target);return;}
  if(action==='capture-camera'){captureCamera();return;}
  if(action==='quick-ask'){ask(target.dataset.question,target.dataset.quickMode||'');return;} if(action==='back-to-profile'){currentTab='profile';selectedRecipe=null;returnTab=null;render();return;} if(action==='open-profile-settings'){userProfileModal();return;} if(action==='open-inventory'){inventoryEntryChoiceModal();return;} if(action==='open-manual-entry'){closeModal();inventoryEntryView='manual';manualEntryCategory='蔬菜';manualEntrySearch='';render();return;} if(action==='open-photo-entry'){closeModal();inventoryEntryView='photo';photoPreviewUrl='';render();return;} if(action==='back-to-inventory'){inventoryEntryView=null;photoPreviewUrl='';render();return;} if(action==='manual-entry-category'){manualEntryCategory=target.dataset.category;manualEntrySearch='';render();return;} if(action==='add-knowledge-food'){const rect=target.getBoundingClientRect();manualEntryFlightOrigin={left:rect.left,top:rect.top,width:rect.width,height:rect.height};manualFoodConfirmModal(target.dataset.name);return;} if(action==='toggle-manual-cart'){manualCartExpanded=!manualCartExpanded;render();return;} if(action==='manual-cart-step'){const item=manualEntryCart.find(entry=>entry.id===target.dataset.id);if(item){item.quantity=steppedManualCartQuantity(item.quantity,target.dataset.delta);if(item.gramsPerUnit)item.estimatedGrams=Math.round(item.quantity*item.gramsPerUnit);render();}return;} if(action==='remove-manual-cart-item'){manualEntryCart=manualEntryCart.filter(item=>item.id!==target.dataset.id);render();return;} if(action==='complete-manual-entry'){if(!manualEntryCart.length)return;const count=manualEntryCart.length;manualEntryCart.forEach(item=>state.inventory.push({id:`inv-${Date.now()}-${Math.random().toString(16).slice(2)}`,name:item.name,quantity:Number(item.quantity),unit:item.unit,location:item.location,purchaseDate:item.purchaseDate||today,createdAt:item.createdAt||today,freshness:'新鲜'}));await persist();manualEntryCart=[];manualCartExpanded=false;inventoryEntryView=null;inventoryCategory='全部';render();toast(`已录入 ${count} 种食材`);return;} if(action==='open-custom-food'){manualEntryFlightOrigin=null;manualFoodConfirmModal('',true);return;} if(action==='photo-to-manual'){inventoryEntryView='manual';manualEntryCategory='蔬菜';manualEntrySearch='';render();return;} if(action==='inventory-location'){inventoryLocation=target.dataset.location;render();return;} if(action==='inventory-category'){inventoryCategory=target.dataset.category;render();return;} if(action==='manage-inventory'){inventoryManageMode=true;selectedInventoryIds.clear();render();return;} if(action==='cancel-inventory-management'){inventoryManageMode=false;selectedInventoryIds.clear();render();return;} if(action==='toggle-inventory-selection'){target.checked?selectedInventoryIds.add(target.dataset.id):selectedInventoryIds.delete(target.dataset.id);render();return;} if(action==='edit-inventory'){inventoryModal(state.inventory.find(i=>i.id===target.dataset.id));return;} if(action==='delete-inventory'){state.inventory=state.inventory.filter(i=>i.id!==target.dataset.id);selectedInventoryIds.delete(target.dataset.id);await persist();render();toast('已删除该食材');return;} if(action==='batch-delete-inventory'){if(!selectedInventoryIds.size)return;const count=selectedInventoryIds.size;state.inventory=state.inventory.filter(i=>!selectedInventoryIds.has(i.id));selectedInventoryIds.clear();await persist();render();toast(`已删除 ${count} 项食材`);return;} if(action==='close-modal'){manualEntryFlightOrigin=null;closeModal();return;}
  if(action==='open-recipe'){if(currentTab==='home')returnTab='home';selectedRecipe=findRecipe(target.dataset.id);closeModal();currentTab='recipes';render();return;} if(action==='back-recipes'){if(returnTab==='home'){selectedRecipe=null;currentTab='home';returnTab=null;render();return;}selectedRecipe=null;render();return;} if(action==='recipe-mode'){recipeMode=target.dataset.mode;render();return;} if(action==='serving'){selectedRecipe.servings=Math.max(1,(selectedRecipe.servings||2)+Number(target.dataset.delta));render();return;} if(action==='toggle-favorite'){const id=target.dataset.id;state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];await persist();toast(state.favorites.includes(id)?'已收藏':'已取消收藏');render();return;}
  if(action==='add-recipe-shopping'){importShopping(selectedRecipe.ingredients.filter(i=>!i.available).map(i=>({name:i.name,quantity:i.quantity,unit:i.unit,category:'其他',source:selectedRecipe.title})));return;} if(action==='start-cooking'){cookingModal(selectedRecipe);return;} if(action==='shopping-tab'){shoppingTab=target.dataset.status;render();return;} if(action==='toggle-shopping'){const item=state.shopping.find(i=>i.id===target.dataset.id);item.status=target.checked?'bought':'pending';item.completedAt=target.checked?today:'';await persist();render();return;} if(action==='delete-shopping'){state.shopping=state.shopping.filter(i=>i.id!==target.dataset.id);await persist();render();return;} if(action==='add-shopping'){shoppingModal();return;} if(action==='clear-shopping'){state.shopping=state.shopping.filter(i=>i.status!=='pending');await persist();render();return;}
  if(action==='sync-shopping'){const ids=state.shopping.filter(i=>i.status==='bought').map(i=>i.id);try{state=await api('/api/sync-shopping',{method:'POST',body:JSON.stringify({ids})});toast('已同步入库');render();}catch(error){toast(error.message)}return;} if(action==='open-cooking-history'){cookingHistoryModal();return;} if(action==='open-consumption-review'){consumptionReviewModal();return;} if(action==='open-reminder-settings'){reminderSettingsModal();return;} if(action==='open-privacy-data'){privacyDataModal();return;} if(action==='edit-preferences'){preferenceModal();return;} if(action==='toggle-reminder-setting'){state.preferences[target.dataset.key]=target.checked;await persist();toast(target.checked?'已开启提醒':'已关闭提醒');return;} if(action==='toggle-reminder'){state.preferences.reminder=target.checked;await persist();toast(target.checked?'已开启临期提醒':'已关闭临期提醒');return;} if(action==='open-recommendation-shopping'){const recipe=(agentResult?.recipes||[]).find(item=>item.id===target.dataset.recipeId)||null;recommendationShoppingModal(recipe);return;} if(action==='import-shopping'){recommendationShoppingModal(null);return;}
});
document.addEventListener('pointerdown',event=>{const row=event.target.closest('.inventory-swipe:not(.batch-mode)');if(!row||event.target.closest('button'))return;document.querySelectorAll('.inventory-swipe.revealed').forEach(item=>{if(item!==row)item.classList.remove('revealed');});inventorySwipeGesture={row,startX:event.clientX,startY:event.clientY};});
document.addEventListener('pointerup',event=>{if(!inventorySwipeGesture)return;const {row,startX,startY}=inventorySwipeGesture;const dx=event.clientX-startX,dy=event.clientY-startY;if(Math.abs(dx)>35&&Math.abs(dx)>Math.abs(dy)){row.classList.toggle('revealed',dx<0);}inventorySwipeGesture=null;});
document.addEventListener('keydown',event=>{const input=event.target.closest('input[data-integer-step],input[name="quantity"]');if(!input||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();input.value=Math.max(Number(input.min)||0,Number(input.value||0)+(event.key==='ArrowUp'?1:-1));input.dispatchEvent(new Event('input',{bubbles:true}));});
function updateManualConfirm(form,nameChanged=false){const name=form.elements.name.value.trim(),food=findFoodKnowledge(name);if(nameChanged&&food&&form.dataset.matchedName!==food.canonical_name){const unit=Object.keys(food.units||{})[0]||'个';form.elements.unit.innerHTML=manualEntryUnitOptions(food,unit);form.elements.location.value=food.default_storage==='frozen'?'冷冻':'冷藏';form.dataset.matchedName=food.canonical_name;}form.querySelector('.manual-estimated-weight').textContent=manualEntryEstimatedWeight(name,form.elements.quantity.value,form.elements.unit.value);}
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(form.id==='city-location-form'){
    event.preventDefault();event.stopImmediatePropagation();
    const button=form.querySelector('[type="submit"]');button.disabled=true;button.textContent='正在更新…';
    try{await chooseChinaCity(new FormData(form).get('city'));closeModal();toast('城市和天气已更新');}
    catch(error){toast(error.message);button.disabled=false;button.textContent='确认城市';}
    return;
  }
  if(form.id==='ai-inventory-request-form'){
    event.preventDefault();event.stopImmediatePropagation();
    const button=form.querySelector('[type="submit"]');button.disabled=true;button.textContent='AI识别中…';
    try{const result=await api('/api/ai-inventory',{method:'POST',body:JSON.stringify({text:new FormData(form).get('text').trim()})});aiInventoryReviewModal(reconcileAiItems(result.items));}
    catch(error){toast(error.message);button.disabled=false;button.textContent='生成清单';}
    return;
  }
  if(form.id==='ai-inventory-review-form'){
    event.preventDefault();event.stopImmediatePropagation();
    const items=[...form.querySelectorAll('[data-ai-item]')].map(row=>{
      let aliases=[];try{aliases=JSON.parse(row.dataset.aliases||'[]');}catch{}
      return {name:row.querySelector('[name="name"]').value.trim(),aliases,categoryTag:row.dataset.categoryTag||'其他',quantity:Number(row.querySelector('[name="quantity"]').value),unit:row.querySelector('[name="unit"]').value.trim(),estimatedGrams:Number(row.dataset.estimatedGrams)||null,freshness:row.dataset.freshness||'新鲜',location:row.querySelector('[name="location"]').value,purchaseDate:row.querySelector('[name="purchaseDate"]').value,createdAt:today};
    });
    if(aiEntryDestination==='inventory'){
      items.forEach(item=>state.inventory.push({...item,id:`inv-${Date.now()}-${Math.random().toString(16).slice(2)}`,aiFreshness:item.freshness}));
      await persist();
      const knowledgeResult=await syncConfirmedFoodKnowledge(items);
      closeModal();inventoryEntryView=null;inventoryCategory='全部';render();
      toast(knowledgeResult.error?`已录入 ${items.length} 种食材；知识库补充失败`:`已录入 ${items.length} 种食材${knowledgeResult.added+knowledgeResult.updated?`，补充知识 ${knowledgeResult.added+knowledgeResult.updated} 条`:''}`);
    }else{
      items.forEach(addToManualEntryCart);
      const knowledgeResult=await syncConfirmedFoodKnowledge(items);
      closeModal();manualCartExpanded=false;render();animateManualCart();
      toast(knowledgeResult.error?'AI清单已加入；知识库补充失败':`AI清单已加入待录入${knowledgeResult.added+knowledgeResult.updated?`，补充知识 ${knowledgeResult.added+knowledgeResult.updated} 条`:''}`);
    }
  }
},true);
document.addEventListener('input',event=>{if(event.target.id==='manual-food-search'){manualEntrySearch=event.target.value;const list=document.getElementById('manual-entry-food-list');if(list)list.innerHTML=manualFoodListHTML();return;}const confirmForm=event.target.closest('#manual-food-confirm-form');if(confirmForm){updateManualConfirm(confirmForm,event.target.name==='name');return;}if(event.target.dataset.cartQuantity){const item=manualEntryCart.find(entry=>entry.id===event.target.dataset.cartQuantity),value=Number(event.target.value);if(item&&Number.isFinite(value))item.quantity=Math.max(1,value);}});
document.addEventListener('input',event=>{const row=event.target.closest('[data-ai-item]');if(row&&event.target.name==='quantity'){updateAiReviewWeight(row);return;}if(event.target.dataset.cartQuantity){const item=manualEntryCart.find(entry=>entry.id===event.target.dataset.cartQuantity);if(item?.gramsPerUnit)item.estimatedGrams=Math.round(item.quantity*item.gramsPerUnit);}});
document.addEventListener('focusin',event=>{if(event.target.matches('input[name="quantity"],input[data-cart-quantity]'))event.target.dataset.lastQuantity=event.target.value;});
document.addEventListener('input',event=>{const input=event.target;if(!input.matches('input[name="quantity"],input[data-cart-quantity]'))return;const previous=Number(input.dataset.lastQuantity),current=Number(input.value);if(event.inputType==null&&Number.isFinite(previous)&&Number.isFinite(current)&&Math.abs(current-previous)>0&&Math.abs(current-previous)<1){input.value=String(Math.max(Number(input.min)||0,previous+(current>previous?1:-1)));}input.dataset.lastQuantity=input.value;},true);
document.addEventListener('change',event=>{const confirmForm=event.target.closest('#manual-food-confirm-form');if(confirmForm){updateManualConfirm(confirmForm,event.target.name==='name');return;}if(event.target.dataset.cartUnit){const item=manualEntryCart.find(entry=>entry.id===event.target.dataset.cartUnit);if(item)item.unit=event.target.value;return;}if(!event.target.classList.contains('food-photo-input'))return;const file=event.target.files?.[0];if(!file)return;if(file.size>8*1024*1024){toast('照片请控制在 8MB 以内');return;}const reader=new FileReader();reader.onload=()=>{photoPreviewUrl=reader.result;render();};reader.onerror=()=>toast('照片读取失败，请重新选择');reader.readAsDataURL(file);});
document.addEventListener('change',event=>{const row=event.target.closest('[data-ai-item]');if(row&&event.target.name==='unit'){updateAiReviewWeight(row);return;}if(event.target.dataset.cartUnit){const item=manualEntryCart.find(entry=>entry.id===event.target.dataset.cartUnit);if(!item)return;const food=findFoodKnowledge(item.name),unit=event.target.value;item.gramsPerUnit=['克','g'].includes(unit)?1:unit==='斤'?500:food?.units?.[unit]||null;if(item.gramsPerUnit)item.estimatedGrams=Math.round(item.quantity*item.gramsPerUnit);}});
document.addEventListener('change',event=>{if(event.target.matches('[data-action="inventory-sort"]')){inventorySort=event.target.value;render();}});
document.addEventListener('submit',event=>{const form=event.target;if(form.id!=='manual-food-confirm-form')return;event.preventDefault();event.stopImmediatePropagation();const origin=manualEntryFlightOrigin;manualEntryFlightOrigin=null;const data=new FormData(form);addToManualEntryCart({name:data.get('name').trim(),quantity:Number(data.get('quantity')),unit:data.get('unit'),location:data.get('location'),purchaseDate:data.get('purchaseDate'),createdAt:today});closeModal();manualCartExpanded=false;render();requestAnimationFrame(()=>flyManualCountToCart(origin,manualEntryCart.length));toast('已加入待录入清单');},true);
document.addEventListener('submit',async event=>{const form=event.target;if(form.id!=='inventory-form')return;event.preventDefault();event.stopImmediatePropagation();const data=new FormData(form);const id=form.dataset.id||null;const matching=state.inventory.find(item=>item.id===id);const item={id:id||`inv-${Date.now()}`,name:data.get('name').trim(),quantity:Number(data.get('quantity')),unit:data.get('unit'),estimatedGrams:Number(data.get('estimatedGrams'))||null,location:data.get('location'),freshness:'新鲜',purchaseDate:data.get('purchaseDate'),createdAt:matching?.createdAt||today};if(matching)Object.assign(matching,item);else state.inventory.push(item);await persist();closeModal();render();toast('库存已保存');},true);
document.addEventListener('submit',async event=>{event.preventDefault();const form=event.target;if(form.id==='ask-form'){const question=document.getElementById('agent-question').value.trim();if(question)ask(question);return;}if(form.id==='inventory-form'){const data=new FormData(form);const id=form.dataset.id||null;const item={id:id||`inv-${Date.now()}`,name:data.get('name').trim(),quantity:Number(data.get('quantity')),unit:data.get('unit').trim(),location:data.get('location'),freshness:'新鲜',expiryDate:data.get('expiryDate'),createdAt:today};const matching=state.inventory.find(i=>i.id===id);if(matching)Object.assign(matching,item);else state.inventory.push(item);await persist();closeModal();render();toast('库存已保存');return;}if(form.id==='recommendation-shopping-form'){
  const pending=new Map((state.shopping||[]).filter(item=>item.status==='pending').map(item=>[canonicalFoodName(item.name),item]));
  const entries=recommendationShoppingDraft.map((item,index)=>{
    const quantity=Number(form.elements.namedItem('quantity-'+index)?.value);
    const unit=String(form.elements.namedItem('unit-'+index)?.value||'').trim();
    return Number.isFinite(quantity)&&quantity>0&&unit?{item,quantity,unit,existing:pending.get(canonicalFoodName(item.name))}:null;
  });
  if(entries.some(item=>!item)){toast('请填写每种食材的数量和单位');return;}
  const additions=[],changes=[];
  entries.forEach(({item,quantity,unit,existing},index)=>{
    if(existing){changes.push({existing,quantity:existing.quantity,unit:existing.unit});existing.quantity=quantity;existing.unit=unit;}
    else additions.push({id:'shop-agent-'+Date.now()+'-'+index,name:item.name,quantity,unit,category:item.category||'其他',source:'菜谱推荐 · '+(item.source||'厨房管家'),status:'pending',completedAt:''});
  });
  state.shopping.push(...additions);
  try{await persist();recommendationShoppingDraft=[];closeModal();currentTab='shopping';render();toast('采购清单已更新');}
  catch(error){
    const ids=new Set(additions.map(item=>item.id));state.shopping=state.shopping.filter(item=>!ids.has(item.id));
    changes.forEach(({existing,quantity,unit})=>{existing.quantity=quantity;existing.unit=unit;});
    toast('保存失败，请重试');
  }
  return;
} if(form.id==='shopping-form'){const data=new FormData(form);state.shopping.push({id:`shop-${Date.now()}`,name:data.get('name').trim(),quantity:Number(data.get('quantity')),unit:data.get('unit').trim(),category:data.get('category'),source:'手动新增',status:'pending',completedAt:''});await persist();closeModal();render();toast('已加入采购清单');return;}if(form.id==='preference-form'){const data=new FormData(form);const split=v=>v.split(/[，,]/).map(x=>x.trim()).filter(Boolean);state.preferences.flavors=split(data.get('flavors'));state.preferences.avoid=split(data.get('avoid'));state.preferences.needs=split(data.get('needs'));state.preferences.allergies=split(data.get('allergies'));await persist();closeModal();render();toast('偏好已更新');return;}if(form.id==='user-profile-form'){if(!form.querySelector('[data-avatar-review]').hidden){toast('请先确认或取消新头像');return;}const data=new FormData(form);const previous=state.profile;try{const avatar=form.avatarDraft??(state.profile||{}).avatar??'';state.profile={...(state.profile||{}),name:data.get('name').trim()||'我的厨房',signature:data.get('signature').trim().slice(0,60),avatar};await persist();closeModal();render();toast('个人资料已保存');}catch(error){state.profile=previous;toast(error.message)}return;}if(form.id==='cook-form'){const recipe=findRecipe(form.dataset.recipe);const consumption=[...form.querySelectorAll('[data-consume]')].map(input=>({inventoryId:input.dataset.consume,quantity:Number(input.value)})).filter(i=>i.quantity>0);try{state=await api('/api/cook',{method:'POST',body:JSON.stringify({recipe,consumption})});closeModal();selectedRecipe=null;currentTab='inventory';toast('烹饪完成，库存已更新');render();}catch(error){toast(error.message)}return;}});

loadState().catch(error=>{app.innerHTML=`<section class="card empty"><span class="empty-icon">!</span><b>无法启动厨房管家</b><span>${esc(error.message)}</span></section>`;});
