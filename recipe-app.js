const app = document.getElementById('app');
const header = document.getElementById('app-header');
const modalLayer = document.getElementById('modal-layer');
const toastNode = document.getElementById('toast');
let state = null;
let currentTab = 'recipes';
let returnTab = null;
let shoppingTab = 'pending';
let agentResult = null;
let agentLoading = false;
let recommendationLoading = false;
const imageQueue=[];
const imageQueued=new Set();
const imageErrors=new Map();
let imageWorkerBusy=false;
let currentDetailId = null;
let detailScrollPosition = 0;
let menuReturn = null;
let returnToMeal = false;
let recipeSection = 'discover';
let recipeScreen = 'browse';
let recipeSearch = '';
let inventorySearch = '';
let replaceMenuIndex = null;
let defaultMeal = mealForDate(new Date());
let explicitMeal = '';
let mealPlan = null;
let recommendationError = '';
let recommendationNotice = '';
let menuEditQueue = Promise.resolve();
let recommendationController = null;
let recommendationGeneration = 0;
let speechRecognition = null;
let speechTargetId = '';
let speechStatus = 'idle';
let pendingSpeechText = '';
let pendingSpeechTarget = '';

const MEALS = {
  breakfast:{label:'早餐',title:'早餐吃什么',homeAction:'帮我安排早餐'},
  lunch:{label:'中餐',title:'中餐吃什么',homeAction:'帮我安排中餐'},
  dinner:{label:'晚餐',title:'晚餐吃什么',homeAction:'帮我安排晚餐'},
  snack:{label:'宵夜',title:'宵夜吃什么',homeAction:'帮我安排宵夜'}
};
const icons = {番茄:'🍅',鸡蛋:'🥚',鸡胸肉:'🍗',西兰花:'🥦',大米:'🍚',胡萝卜:'🥕',牛奶:'🥛',香蕉:'🍌'};
const esc = value => String(value ?? '').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const foodIcon = name => icons[name] || '🥬';
const today = () => new Date().toLocaleDateString('sv-SE');
const clone = value => JSON.parse(JSON.stringify(value));

function mealForDate(date){
  const hour=date.getHours();
  if(hour>=5&&hour<10)return 'breakfast';
  if(hour>=10&&hour<14)return 'lunch';
  if(hour>=14&&hour<21)return 'dinner';
  return 'snack';
}
function splitList(value=''){
  return String(value).split(/[，,、;；\s]+/).map(item=>item.trim()).filter(Boolean);
}
function mealFromText(text=''){
  const value=String(text);
  if(/早餐|早饭|早点|早上/.test(value))return 'breakfast';
  if(/午餐|午饭|中餐|中饭|中午/.test(value))return 'lunch';
  if(/宵夜|夜宵/.test(value))return 'snack';
  if(/晚餐|晚饭|晚上一餐|今晚/.test(value))return 'dinner';
  return '';
}
function voiceControls(inputId,label){
  const recording=speechTargetId===inputId&&speechStatus==='recording';
  const status=speechTargetId===inputId?speechStatus:'idle';
  const messages={
    permission:'正在请求麦克风权限…',
    recording:'正在听，告诉我你的想法…',
    recognizing:'正在识别…',
    recognized:'识别完成，可编辑后再提交。',
    error:'语音识别未完成，可继续打字或重试。',
    cancelled:'已取消语音输入。'
  };
  const recipeVoice=inputId==='dish-query'||inputId==='saved-recipe-query';
  return `<span class="voice-controls" data-voice-controls="${esc(inputId)}"><button type="button" class="voice-button ${recipeVoice?'recipe-voice-button':''} ${recording?'is-recording':''}" data-voice-button data-action="${recording?'voice-stop':'voice-start'}" data-voice-target="${esc(inputId)}" data-voice-label="${esc(label)}" aria-label="${recording?'停止语音输入':`语音输入${esc(label)}`}" title="${recording?'停止':'语音输入'}">${recipeVoice?recipeMicIcon():recording?'停止':'🎙'}</button>${recording?`<button type="button" class="voice-cancel" data-action="voice-cancel" data-voice-target="${esc(inputId)}">取消</button>`:''}</span><small class="voice-status" data-voice-status-for="${esc(inputId)}" aria-live="polite">${messages[status]||''}</small>`;
}
function recipeMicIcon(){return '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8"/></svg>';}
function setVoiceStatus(status,message=''){
  speechStatus=status;
  const recording=status==='recording';
  document.querySelectorAll('[data-voice-controls]').forEach(group=>{
    if(group.dataset.voiceControls!==speechTargetId)return;
    const button=group.querySelector('[data-voice-button]');
    if(!button)return;
    button.dataset.action=recording?'voice-stop':'voice-start';
    if(button.classList.contains('recipe-voice-button'))button.innerHTML=recipeMicIcon();
    else button.textContent=recording?'停止':'🎙';
    button.classList.toggle('is-recording',recording);
    button.setAttribute('aria-label',recording?'停止语音输入':`语音输入${button.dataset.voiceLabel||'内容'}`);
    button.title=recording?'停止':'语音输入';
    group.querySelector('.voice-cancel')?.remove();
    if(recording)group.insertAdjacentHTML('beforeend',`<button type="button" class="voice-cancel" data-action="voice-cancel" data-voice-target="${esc(speechTargetId)}">取消</button>`);
  });
  document.querySelectorAll('[data-voice-status-for]').forEach(node=>{
    if(node.dataset.voiceStatusFor===speechTargetId)node.textContent=message;
  });
}
function stopSpeechRecognition(cancel=false){
  if(!speechRecognition)return;
  const current=speechRecognition;
  speechRecognition=null;
  clearTimeout(current.voiceTimeout);
  try{cancel?current.abort():current.stop();}catch(_error){}
  if(cancel)setVoiceStatus('cancelled','已取消语音输入。');
}
function applySpeechText(targetId,text){
  const input=document.getElementById(targetId);
  if(!input||!text)return;
  const current=input.value||'';
  if(current.trim()){
    pendingSpeechText=text;
    pendingSpeechTarget=targetId;
    modal(`<h2>如何加入识别文字？</h2><p>输入框已有内容。选择追加或替换，原文字不会被静默覆盖。</p><p class="speech-result">${esc(text)}</p><div class="modal-actions"><button class="secondary-button" data-action="close-modal">暂不加入</button><button class="secondary-button" data-action="voice-append">追加</button><button class="primary-button" data-action="voice-replace">替换</button></div>`);
    return;
  }
  input.value=text;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  setVoiceStatus('recognized','识别完成，可编辑后再提交。');
  input.focus();
}
function startSpeechRecognition(targetId){
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){
    speechTargetId=targetId;
    setVoiceStatus('error','此浏览器不支持语音识别，可继续打字。');
    return;
  }
  stopSpeechRecognition(true);
  speechTargetId=targetId;
  setVoiceStatus('permission','正在请求麦克风权限…');
  const recognition=new Recognition();
  speechRecognition=recognition;
  recognition.lang='zh-CN';
  recognition.continuous=false;
  recognition.interimResults=true;
  let finalText='';
  recognition.onstart=()=>setVoiceStatus('recording','正在听，告诉我你的想法…');
  recognition.onresult=event=>{
    let interim='';
    for(let index=event.resultIndex;index<event.results.length;index++){
      const result=event.results[index];
      if(result.isFinal)finalText+=result[0].transcript;
      else interim+=result[0].transcript;
    }
    if(finalText.trim()){
      setVoiceStatus('recognized','识别完成，可编辑后再提交。');
      applySpeechText(targetId,finalText.trim());
    }else if(interim)setVoiceStatus('recording',`正在听：${interim}`);
  };
  recognition.onerror=event=>{
    if(speechRecognition!==recognition)return;
    const message=event.error==='not-allowed'||event.error==='service-not-allowed'
      ?'未获得麦克风权限，可继续打字。'
      :event.error==='no-speech'?'没有听到语音，可重试或继续打字。'
        :event.error==='network'?'语音识别服务暂不可用，可继续打字。'
          :'语音识别失败，原有文字已保留，可重试。';
    setVoiceStatus('error',message);
  };
  recognition.onend=()=>{
    clearTimeout(recognition.voiceTimeout);
    if(speechRecognition===recognition)speechRecognition=null;
    if(!finalText.trim()&&speechStatus!=='cancelled'&&speechStatus!=='error')setVoiceStatus('error','没有识别到内容，可重试或继续打字。');
  };
  recognition.voiceTimeout=setTimeout(()=>{
    if(speechRecognition===recognition){
      setVoiceStatus('error','语音输入超时，可重试或继续打字。');
      stopSpeechRecognition();
    }
  },60000);
  try{recognition.start();}catch(_error){
    clearTimeout(recognition.voiceTimeout);
    speechRecognition=null;
    setVoiceStatus('error','无法启动语音输入，可继续打字。');
  }
}
function cleanDishText(text=''){
  return String(text).replace(/不考虑库存|不用看库存|不受库存限制|明天|今天|今晚|早上|早餐|早饭|早点|午餐|午饭|中餐|中饭|中午|晚餐|晚饭|宵夜|夜宵|吃什么|想吃|想来|安排|推荐|帮我|给我|来点|来一份|可以吗|好吗/g,'').trim();
}
function activeMeal(){return mealPlan?.active&&mealPlan.active.status!=='completed'&&mealPlan.active.status!=='cancelled'?mealPlan.active:null;}
function effectiveMeal(){return explicitMeal||defaultMeal;}
function plannedMeal(){return activeMeal()?.meal||mealPlan?.roundMeal||effectiveMeal();}
function mealLabel(id=effectiveMeal()){return MEALS[id]?.label||MEALS.dinner.label;}
function mealTitle(id=effectiveMeal()){return MEALS[id]?.title||MEALS.dinner.title;}
function stockNameMatches(a,b){
  const canonical=name=>window.RecipeStockBridge?.canonicalName(name)||({'番茄':'西红柿'}[name]||name);
  return canonical(a)===canonical(b);
}
function stockUnitMatches(a,b){
  const canonical=unit=>({'克':'g','毫升':'ml'}[unit]||unit||'');
  return canonical(a)===canonical(b);
}
function stockPriority(item){
  return window.RecipeStockBridge?.freshness(item)?.key==='soon'||item.freshness==='即将到期'||Boolean(item.expiryDate&&item.expiryDate<=today());
}
function safeInventory(item){
  return window.RecipeStockBridge?.freshness(item)?.key!=='unsafe'&&!['不可食用','已确认不可食用','丢弃','变质','状态存疑','待确认','不宜食用'].includes(item.status)&&
    !['不可食用','已确认不可食用','变质','状态存疑','待确认','不宜食用'].includes(item.freshness);
}
function preferences(){
  const personal=state.preferences||{},temporary=mealPlan?.request?.preferences||{};
  return {...personal,...(temporary.flavors?{flavors:temporary.flavors}:{}),...(temporary.appliances?{appliances:temporary.appliances}:{})};
}
function hasConfirmedPreferences(p=state.preferences||{}){
  const confirmed=(status,values)=>status==='none'||status==='specified'&&Array.isArray(values)&&values.some(value=>value&&value!=='无');
  return confirmed(p.allergiesStatus,p.allergies)&&confirmed(p.dietStatus,p.avoid);
}
async function usePersonalPreferences(){
  const changed=Boolean(mealPlan.request.preferences)||mealPlan.request.servings!==(state.preferences.defaultServings||2);
  delete mealPlan.request.preferences;
  mealPlan.request.servings=state.preferences.defaultServings||2;
  if(changed){mealPlan.results=[];mealPlan.summary='偏好已沿用，请按当前条件重新搭配。';}
  await persist();closeModal();render();toast('无修改，与个人登记一致');
}
function ensurePlan(){
  const saved=state.mealPlan||{};
  mealPlan={
    request:{dish:'',servings:Number(state.preferences?.defaultServings)||2,duration:30,mode:'use-first',allowAdditionalIngredients:true,...saved.request},
    seenBySignature:saved.seenBySignature||{},
    results:saved.recommendationProvider==='ai'?(saved.results||[]):[],
    aiRecipes:Array.isArray(saved.aiRecipes)?saved.aiRecipes:[],
    intent:saved.intent&&typeof saved.intent==='object'?saved.intent:null,
    intentEditing:false,
    recommendationProvider:saved.recommendationProvider||'',
    summary:saved.recommendationProvider==='ai'?(saved.summary||''):'等待 AI 推荐',
    resultMeal:saved.resultMeal||'',
    roundMeal:saved.roundMeal||saved.resultMeal||'',
    menu:Array.isArray(saved.menu)?saved.menu:[],
    active:saved.active||null,
    lastCompleted:saved.lastCompleted||null
  };
  if(mealPlan.active&&!mealPlan.active.dishes){
    const old=mealPlan.active;
    old.dishes=[{recipe:old.recipe,ingredients:old.ingredients||[],cooked:true}];
    let elapsed=0;
    old.timeline=(old.recipe.steps||[]).map((rawStep,index)=>{
      const text=safeStepText(rawStep),minutes=5;
      const step={id:`legacy-step-${index}`,index,title:typeof rawStep==='string'?`第 ${index+1} 步`:rawStep.title||`第 ${index+1} 步`,text,minutes,timeType:'estimated',dish:old.recipe.title,done:index<(old.stepIndex||0),startMinute:elapsed,endMinute:elapsed+minutes,ingredients:[],completion:''};
      elapsed+=minutes;return step;
    });
    old.estimatedMinutes=old.estimatedMinutes||elapsed;
    old.servings=old.servings||old.recipe.servings||mealPlan.request.servings;
    old.stepIndex=old.stepIndex||0;
  }
  if(mealPlan.request.mode==='random')mealPlan.request.mode='explore';
  if(mealPlan.request.mode==='explore'&&!String(mealPlan.request.dish||'').trim()&&mealPlan.intent&&!mealPlan.intent.explicitlyEdited)mealPlan.intent.ingredients=[];
  if(!mealPlan.roundMeal)mealPlan.roundMeal=activeMeal()?.meal||defaultMeal;
  state.recipes=Array.isArray(state.recipes)?state.recipes:[];
  state.recipeDrafts=Array.isArray(state.recipeDrafts)?state.recipeDrafts:[];
  state.favoriteLinks=Array.isArray(state.favoriteLinks)?state.favoriteLinks:[];
  mealPlan.results=mealPlan.results.filter(id=>{const recipe=[...recipeLibrary,...state.recipes,...mealPlan.aiRecipes].find(item=>item.id===id);return !recipe||recipe.recommendationSource!=='AI'||isSingleDish(recipe);});
}
function syncMealOnOpen(date=new Date()){
  defaultMeal=mealForDate(date);
  explicitMeal='';
  mealPlan.request.explicitMeal='';
  const savedMeal=mealFromText(mealPlan.request.dish);
  if(savedMeal&&savedMeal!==defaultMeal){
    mealPlan.request.dish='';
    mealPlan.intent=null;
    mealPlan.results=[];
    mealPlan.summary='';
  }
  if(!activeMeal()&&!mealPlan.menu.length)mealPlan.roundMeal=defaultMeal;
  clearOtherMealResults(defaultMeal);
}
function clearOtherMealResults(meal){
  if(mealPlan.resultMeal!==meal){
    mealPlan.results=[];
    mealPlan.summary='';
  }
}
async function api(url,options={}){
  let response;
  try{response=await fetch(url,{headers:{'Content-Type':'application/json'},...options});}
  catch(error){if(error?.name==='AbortError')throw error;throw new Error('无法连接本地预览服务，请重新打开预览。');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'请求失败，请重试。');
  return data;
}
let persistenceQueue=Promise.resolve();
function persist(){
  const write=persistenceQueue.catch(()=>{}).then(async()=>{
    state.mealPlan=mealPlan;
    const revision=state.revision;
    const result=await api('/api/state',{method:'PUT',body:JSON.stringify({state})});
    // Keep newer in-memory changes while updating the server revision for the next write.
    if(state.revision===revision)state.revision=result.revision;
  });
  persistenceQueue=write;
  return write;
}
async function loadState(){
  state=await api('/api/state');
  state.preferences=state.preferences||{};
  state.inventory=Array.isArray(state.inventory)?state.inventory:[];
  state.shopping=Array.isArray(state.shopping)?state.shopping:[];
  state.history=Array.isArray(state.history)?state.history:[];
  state.favorites=Array.isArray(state.favorites)?state.favorites:[];
  ensurePlan();
  syncMealOnOpen();
  render();
  if(!state.mealPlan)await persist();
  if(!mealPlan.results.length)await refreshRecommendations();
}
function toast(message){toastNode.textContent=message;toastNode.classList.add('show');setTimeout(()=>toastNode.classList.remove('show'),2800);}
function modal(content){modalLayer.hidden=false;modalLayer.innerHTML=`<div class="modal" role="dialog" aria-modal="true">${content}</div>`;}
function closeModal(){modalLayer.hidden=true;modalLayer.innerHTML='';}
function headerContent(){
  const viewingMeal=recipeScreen==='cooking'||recipeScreen==='menu';
  const meal=viewingMeal?plannedMeal():effectiveMeal();
  const title=currentTab==='recipes'?mealTitle(meal):({home:'食光管家',inventory:'我的冰箱',shopping:'采购清单',profile:'我的'}[currentTab]||'食光管家');
  const sub=currentTab==='recipes'?'按餐次和库存安排一顿':({home:'今天，先吃掉家里的好食材',inventory:'食材台账',shopping:'按需补购',profile:'偏好与饮食记录'}[currentTab]||'');
  header.innerHTML=`<div class="topline"><div><p class="eyebrow">${esc(sub)}</p><h1>${esc(title)}</h1></div>${currentTab==='recipes'&&returnTab==='profile'?'<button class="header-back-action" data-action="back-to-profile">‹ 返回我的</button>':'<button class="header-action help-action" data-action="show-help" aria-label="帮助">?</button>'}</div>`;
}
function allRecipes(){return [...recipeLibrary,...state.recipes,...mealPlan.aiRecipes];}
function recipeById(id){return allRecipes().find(recipe=>recipe.id===id)||null;}
function effectiveRequestDish(){return cleanDishText(mealPlan.request.dish);}
function inventoryMatches(ingredient){
  return state.inventory.filter(item=>stockNameMatches(item.name,ingredient.name)&&stockUnitMatches(item.unit,ingredient.unit)&&safeInventory(item)&&Number.isFinite(Number(item.quantity))&&Number(item.quantity)>0);
}
function allocationsFor(ingredient,needed){
  let remaining=needed;
  const allocations=[];
  for(const item of inventoryMatches(ingredient).sort((a,b)=>(a.expiryDate||'9999').localeCompare(b.expiryDate||'9999'))){
    if(remaining<=0)break;
    const quantity=Math.min(remaining,Number(item.quantity));
    allocations.push({inventoryId:item.id,name:item.name,quantity,unit:item.unit||ingredient.unit});
    remaining=Number((remaining-quantity).toFixed(2));
  }
  return {allocations,covered:Number((needed-remaining).toFixed(2)),unconfirmed:remaining};
}
function recipeForView(recipe,servings=mealPlan.request.servings){
  if(!recipe)return null;
  const scaled=clone(recipe);
  if(state.generatedRecipeImages?.[recipe.id]?.imageType==='web-search'&&!scaled.imageUrl)Object.assign(scaled,state.generatedRecipeImages[recipe.id]);
  const factor=Number(servings||2)/Number(recipe.servings||2);
  scaled.servings=Number(servings||2);
  const scaleIngredients=items=>(items||[]).map(ingredient=>{
    const known=ingredient.quantity!=null&&ingredient.quantity!==''&&Number.isFinite(Number(ingredient.quantity));
    const quantity=known?Number((Number(ingredient.quantity)*factor).toFixed(2)):null;
    return {...ingredient,quantity,...(known?allocationsFor(ingredient,quantity):{allocations:[],covered:0,unconfirmed:null})};
  });
  scaled.ingredients=scaleIngredients(scaled.ingredients).map(item=>({...item,category:item.category||'main'}));
  scaled.seasonings=scaleIngredients(scaled.seasonings).map(item=>({...item,category:'seasoning'}));
  scaled.auxiliaries=scaleIngredients(scaled.auxiliaries).map(item=>({...item,category:'auxiliary'}));
  scaled.steps=(scaled.steps||[]).map((raw,index)=>{
    const step=typeof raw==='string'?{title:`第 ${index+1} 步`,text:raw,ingredients:[],minutes:null,timeType:'unknown',completion:'',imageUrl:'',imageType:''}:raw;
    const scoped=[...scaled.ingredients,...scaled.auxiliaries,...scaled.seasonings].filter(item=>(item.usedInSteps||[]).includes(`第${index+1}步`));
    return {...step,ingredients:scoped.length?scoped.map(item=>`${item.name}${item.form?`（${item.form}）`:''} ${item.quantity??'适量/未知'} ${item.unit||''}`):step.ingredients||[]};
  });
  return scaled;
}
function requestSignature(meal){
  const p=preferences();
  return JSON.stringify([meal,effectiveRequestDish(),mealPlan.request.servings,mealPlan.request.duration,mealPlan.request.mode,
    p.allergiesStatus,p.allergies,p.dietStatus,p.avoid,p.appliances,recipeSection]);
}
function recipeSearchMatches(recipe,query){
  if(!query||recipe.recommendationSource==='AI')return true;
  const text=[recipe.title,...recipe.ingredients.map(item=>item.name)].join('').toLowerCase();
  const words=query.split(/[，,、\s]+/).filter(Boolean);
  return words.every(word=>text.includes(word.toLowerCase()));
}
function isSingleDish(recipe){
  const title=String(recipe?.title||'').trim();
  if(!title||/[+＋、]/.test(title)||/套餐|配米饭|配面条|配粥|配.{0,6}汤|配(?:清炒|凉拌|蒜蓉|白灼|炒饭|煎蛋|小菜)/.test(title))return false;
  return !Array.isArray(recipe.dishes)||recipe.dishes.length<=1;
}
function requiredFoodSources(recipe){
  return (recipe.ingredients||[]).filter(item=>!item.optional&&isTrackedRecipeIngredient(item));
}
function sourceCoverage(item){
  const available=state.inventory.filter(stock=>stockNameMatches(stock.name,item.name)&&safeInventory(stock)&&stock.quantity!=null&&stock.quantity!==''&&Number.isFinite(Number(stock.quantity))&&Number(stock.quantity)>0);
  const amountKnown=item.quantity!=null&&item.quantity!==''&&Number.isFinite(Number(item.quantity))&&Number(item.quantity)>0;
  if(!amountKnown)return {hasStock:available.length>0,needsPurchase:available.length===0,uncertain:available.length>0};
  const compatible=available.filter(stock=>item.unit&&stockUnitMatches(stock.unit,item.unit));
  const total=compatible.reduce((sum,stock)=>sum+Number(stock.quantity),0);
  return {hasStock:total>0,needsPurchase:total<Number(item.quantity),uncertain:available.length>0&&!compatible.length};
}
function rankedRecipes(meal,recipes=allRecipes()){
  const p=preferences(), query=effectiveRequestDish(), blocked=[...(p.allergies||[]),...(p.avoid||[])].filter(item=>item&&item!=='无');
  const noAppliances=[...(p.appliances||[]),...(mealPlan.intent?.appliancesToAvoid||[])].filter(item=>item&&item!=='无');
  const mode=mealPlan.request.mode;
  const requestedIngredients=(mode==='explore'&&!String(mealPlan.request.dish||'').trim()&&!mealPlan.intent?.explicitlyEdited?[]:(mealPlan.intent?.ingredients||[])).filter(name=>!blocked.some(item=>name.includes(item)||item.includes(name)));
  return recipes.filter(recipe=>{
    if(recipe.recommendationSource==='AI'&&!isSingleDish(recipe))return false;
    if(!(recipe.mealTypes||[]).includes(meal)||recipe.duration==null||recipe.duration===''||!Number.isFinite(Number(recipe.duration))||Number(recipe.duration)+Number(recipe.waitMinutes||0)>Number(mealPlan.request.duration))return false;
    if(!recipeSearchMatches(recipe,query))return false;
    const ingredientText=[...(recipe.ingredients||[]),...(recipe.auxiliaries||[]),...(recipe.seasonings||[])].map(item=>item.name).join(' ');
    if(blocked.some(item=>ingredientText.includes(item)))return false;
    if(noAppliances.some(term=>(recipe.appliances||[]).some(appliance=>appliance.includes(term)||term.includes(appliance))))return false;
    if((mealPlan.intent?.methodsToAvoid||[]).some(method=>(recipe.steps||[]).some(step=>`${step.title||''}${step.text||''}`.includes(method))))return false;
    if(recipe.recommendationSource==='AI'&&requestedIngredients.some(name=>!ingredientText.includes(name)&&!name.includes(recipe.title)))return false;
    const view=recipeForView(recipe);
    const main=view.ingredients.filter(item=>item.category==='main'&&!isSeasoning(item));
    const userProvided=item=>requestedIngredients.some(name=>name.includes(item.name)||item.name.includes(name));
    if(mealPlan.request.allowAdditionalIngredients===false||mealPlan.intent?.allowAdditionalIngredients===false){
      const additional=view.ingredients.filter(isTrackedRecipeIngredient);
      if(additional.some(item=>!userProvided(item)))return false;
    }
    const required=requiredFoodSources(view),coverage=required.map(sourceCoverage);
    if(mode==='use-first'&&(!main.length||!required.length||coverage.some(item=>!item.hasStock||item.needsPurchase)))return false;
    if(mode==='supplement'&&(!main.length||!required.length||!coverage.some(item=>item.hasStock)||!coverage.some(item=>item.needsPurchase)))return false;
    return true;
  }).map(recipe=>{
    const view=recipeForView(recipe);
    const foodIngredients=requiredFoodSources(view);
    const expiring=foodIngredients.reduce((count,ingredient)=>count+ingredient.allocations.filter(allocation=>{
      const item=state.inventory.find(entry=>entry.id===allocation.inventoryId);
      return item&&stockPriority(item);
    }).length,0);
    const covered=foodIngredients.reduce((sum,ingredient)=>sum+Math.min(ingredient.covered/Math.max(ingredient.quantity,0.01),1),0);
    const quick=Number(recipe.duration)+Number(recipe.waitMinutes||0);
    const mealPreference=meal==='breakfast'?-quick*2:meal==='snack'?(-((recipe.tags||[]).includes('小份')?0:20)-quick):0;
    const main=view.ingredients.filter(ingredient=>ingredient.category==='main'&&!isSeasoning(ingredient));
    const mainGaps=main.filter(ingredient=>ingredient.quantity==null||ingredient.covered<ingredient.quantity).length;
    const stockGaps=foodIngredients.filter(ingredient=>ingredient.quantity==null||ingredient.covered<ingredient.quantity).length;
    const expiringScore=(meal==='breakfast'||meal==='snack'?15:100)*expiring;
    const score=mode==='explore'?Math.random():(mode==='use-first'?expiringScore+covered*5:covered*8-stockGaps*7-mainGaps*30)+mealPreference+Math.random()*0.01;
    return {...recipe,score,stockGaps,mainGaps};
  }).sort((a,b)=>b.score-a.score);
}
function selectVariedDishes(candidates, limit=3){
  const explicit=`${mealPlan.request.dish||''} ${mealPlan.intent?.dish||''} ${mealPlan.intent?.preference||''}`;
  if(/炒饭|盖饭|米饭|面条|炒面|拌面|意面|米粉|粥|主食/.test(explicit))return candidates.slice(0,limit);
  const isStaple=recipe=>/炒饭|盖饭|焖饭|烩饭|炒面|拌面|汤面|米粉|意面|面条|面食|米饭|粥/.test(recipe.title||'');
  const dishes=candidates.filter(recipe=>!isStaple(recipe));
  const staples=candidates.filter(isStaple);
  return [...dishes,...staples.slice(0,1)].slice(0,limit);
}
function recommendationKey(recipe){
  return `${String(recipe.title||'').trim().toLowerCase()}|${[...(recipe.ingredients||[]),...(recipe.auxiliaries||[]),...(recipe.seasonings||[])].map(item=>String(item.name||'').trim().toLowerCase()).sort().join(',')}`;
}
function stableRecipeId(key){
  let hash=2166136261;
  for(let index=0;index<key.length;index++){hash^=key.charCodeAt(index);hash=Math.imul(hash,16777619);}
  return `ai-${(hash>>>0).toString(36)}`;
}
function recommendationMeal(){
  const typedMeal=mealFromText(mealPlan.request.dish);
  explicitMeal=typedMeal;
  if(!activeMeal()&&!mealPlan.menu.length)mealPlan.roundMeal=effectiveMeal();
  return effectiveMeal();
}
function recommendationSignature(meal){
  const p=preferences();
  return JSON.stringify([meal,effectiveRequestDish(),mealPlan.request.servings,mealPlan.request.duration,mealPlan.request.mode,
    p.allergiesStatus,p.allergies,p.dietStatus,p.avoid,p.appliances,recipeSection]);
}
async function refreshRecommendations({rotate=false}={}){
  if(recommendationController)recommendationController.abort();
  const controller=new AbortController();
  recommendationController=controller;
  const generation=++recommendationGeneration;
  const meal=recommendationMeal();
  clearOtherMealResults(meal);
  const previousResults=[...mealPlan.results];
  const signature=recommendationSignature(meal);
  // 探索模式只避开当前一批，允许之后重新出现，避免历史越积越多导致无法刷新。
  const seen=new Set(mealPlan.request.mode==='explore'?[]:(mealPlan.seenBySignature[signature]||[]));
  const excluded=[...seen].map(key=>mealPlan.aiRecipes.find(recipe=>recommendationKey(recipe)===key)?.title).filter(Boolean);
  if(rotate)for(const id of previousResults){const recipe=recipeById(id);if(recipe){seen.add(recommendationKey(recipe));excluded.push(recipe.title);}}
  recommendationLoading=true;recommendationError='';recommendationNotice='';render();
  try{
    const response=await api('/api/recipe-recommendation',{method:'POST',body:JSON.stringify({
      meal,dish:mealPlan.request.dish,servings:mealPlan.request.servings,duration:mealPlan.request.duration,
      preferences:mealPlan.request.preferences||null,mode:mealPlan.request.mode,exclude:[...new Set(excluded)].slice(0,20),
      allowAdditionalIngredients:mealPlan.request.allowAdditionalIngredients!==false,
      intent:mealPlan.intent?.sourceText===mealPlan.request.dish?{
        ingredients:mealPlan.request.mode==='explore'&&!String(mealPlan.request.dish||'').trim()&&!mealPlan.intent.explicitlyEdited?[]:(mealPlan.intent.ingredients||[]),preference:mealPlan.intent.preference||'',dish:mealPlan.intent.dish||'',
        appliancesToAvoid:mealPlan.intent.appliancesToAvoid||[],methodsToAvoid:mealPlan.intent.methodsToAvoid||[]
      }:null
    }),signal:controller.signal});
    if(generation!==recommendationGeneration)return;
    if(!Array.isArray(response.recipes))throw new Error('菜谱 AI 返回格式不正确，请重试。');
    const parsedIntent=response.intent&&typeof response.intent==='object'?response.intent:{};
    mealPlan.intent={
      ...parsedIntent,
      ingredients:mealPlan.request.mode==='explore'&&!String(mealPlan.request.dish||'').trim()&&!mealPlan.intent?.explicitlyEdited?[]:(Array.isArray(parsedIntent.ingredients)?parsedIntent.ingredients:[]),
      explicitlyEdited:mealPlan.intent?.explicitlyEdited===true,
      conflicts:Array.isArray(parsedIntent.conflicts)?parsedIntent.conflicts:[],
      sourceText:mealPlan.request.dish
    };
    mealPlan.intentEditing=false;
    if(mealPlan.request.allowAdditionalIngredients!==false)mealPlan.request.allowAdditionalIngredients=parsedIntent.allowAdditionalIngredients!==false;
    const newRecipes=response.recipes.map(recipe=>{
      if(!recipe||typeof recipe.title!=='string'||!recipe.title.trim()||!Array.isArray(recipe.ingredients)||!Array.isArray(recipe.steps))return null;
      const clean={...recipe,id:'',recommendationSource:'AI',imageUrl:'',imageAlt:`${recipe.title}菜品图片待补充`,imageSource:'',imageCredit:'',imageLicense:''};
      const key=recommendationKey(clean);
      clean.id=stableRecipeId(key);
      clean.mealTypes=Array.isArray(clean.mealTypes)?clean.mealTypes:[];
      clean.appliances=Array.isArray(clean.appliances)?clean.appliances:[];
      clean.tags=Array.isArray(clean.tags)?clean.tags:[];
      clean.auxiliaries=Array.isArray(clean.auxiliaries)?clean.auxiliaries:[];
      clean.seasonings=Array.isArray(clean.seasonings)?clean.seasonings:[];
      clean.steps=clean.steps.map((step,index)=>typeof step==='string'?{title:`第 ${index+1} 步`,text:step,ingredients:[],minutes:null,timeType:'unknown',completion:'',imageUrl:'',imageType:''}:{...step,imageUrl:'',imageType:''});
      return clean;
    }).filter(Boolean);
    const valid=rankedRecipes(meal,newRecipes);
    const unseen=valid.filter(recipe=>!seen.has(recommendationKey(recipe)));
    if(rotate&&!unseen.length){
      recommendationNotice='这次没有生成不同的新菜，原方案仍保留；可再试一次。';
    }else{
      const selected=selectVariedDishes(rotate?unseen:valid);
      if(selected.length){
        mealPlan.aiRecipes=[...mealPlan.aiRecipes.filter(old=>!selected.some(recipe=>recipe.id===old.id)),...selected];
        mealPlan.results=selected.map(recipe=>recipe.id);
        mealPlan.resultMeal=meal;
        mealPlan.recommendationProvider='ai';
        mealPlan.summary=`AI生成${response.summary?` · ${response.summary}`:''} · ${mealPlan.request.servings}人 · ${mealPlan.request.duration}分钟内`;
        selected.forEach(recipe=>seen.add(recommendationKey(recipe)));
        mealPlan.seenBySignature[signature]=[...seen];
      }else if(rotate){
        recommendationNotice='AI 没有生成符合当前限制的新方案；原方案仍保留，可调整条件后再试。';
      }else{
        mealPlan.summary=response.summary||'AI 暂未找到同时满足当前条件的菜谱。';
        mealPlan.results=[];
      }
    }
    await persist();
  }catch(error){
    if(generation!==recommendationGeneration)return;
    if(error.name==='AbortError'){
      recommendationNotice='本次生成已取消，原方案仍保留。';
      mealPlan.results=previousResults;
    }else{
      recommendationError=error.message||'AI 菜谱生成暂时失败，请重试。';
      mealPlan.results=previousResults;
    }
  }finally{
    if(generation===recommendationGeneration){
      recommendationController=null;
      recommendationLoading=false;
      render();
    }
  }
}
function updateRequestFromControls(){
  captureRecipeInput();
  const servings=document.getElementById('servings-select')?.value;
  const duration=document.getElementById('duration-select')?.value;
  if(servings)mealPlan.request.servings=Number(servings);
  if(duration)mealPlan.request.duration=Number(duration);
  applyNaturalLanguageControls(mealPlan.request.dish);
  refreshRecommendations().catch(error=>toast(error.message));
}
function captureRecipeInput(){
  const input=document.getElementById('dish-query');
  if(input)mealPlan.request.dish=input.value;
}
function applyNaturalLanguageControls(text){
  const typedMeal=mealFromText(text);
  explicitMeal=typedMeal;
  mealPlan.request.explicitMeal=typedMeal;
  if(!activeMeal()&&!mealPlan.menu.length)mealPlan.roundMeal=effectiveMeal();
  const numberWords={'一':1,'两':2,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
  const servingsMatch=String(text).match(/(10|[1-9]|一|两|二|三|四|五|六|七|八|九|十)\s*个?人/);
  if(servingsMatch){
    const servings=Number(servingsMatch[1])||numberWords[servingsMatch[1]];
    if(servings>=1&&servings<=12)mealPlan.request.servings=servings;
  }
  const durationMatch=String(text).match(/(\d{1,3})\s*分钟/);
  if(durationMatch){
    const duration=Number(durationMatch[1]);
    if(duration>=5&&duration<=240)mealPlan.request.duration=duration;
  }
  if(/不考虑库存|不用看库存|不受库存限制|不局限于冰箱/.test(text))mealPlan.request.mode='explore';
  if(/只用|不补(?:买)?|不买其他|不额外加(?:食材)?|不要其他食材/.test(text))mealPlan.request.allowAdditionalIngredients=false;
  else if(/可以补(?:买)?|允许(?:加|补)|顺手补几样/.test(text))mealPlan.request.allowAdditionalIngredients=true;
}
function stockSummary(recipe){
  const ingredients=(recipe.ingredients||[]).filter(isTrackedRecipeIngredient);
  const recorded=ingredients.filter(item=>inventoryMatches(item).length);
  const unknown=ingredients.filter(item=>item.quantity==null||!inventoryMatches(item).length);
  const unsafe=ingredients.some(ingredient=>state.inventory.some(item=>stockNameMatches(item.name,ingredient.name)&&!safeInventory(item)));
  const expiring=ingredients.some(item=>item.allocations.some(allocation=>{
    const stock=state.inventory.find(entry=>entry.id===allocation.inventoryId);
    return stock&&stockPriority(stock);
  }));
  const status=unsafe?'有食材已标记状态存疑或不可食用，未用于匹配':!recorded.length?'冰箱暂无可用记录，食材待确认':unknown.length?'主要食材已有记录，未记录食材待确认':ingredients.every(item=>item.covered>=item.quantity)?'主要食材库存记录充足':'主要食材已有记录，数量待确认';
  return {recorded:recorded.length,unknown:unknown.length,expiring,status};
}
function imageMarkup(recipe,detail=false){
  const source=recipe.imageUrl;
  const imageLabel=recipe.imageType==='web-search'?'网络搜索配图 · 授权待核对':recipe.imageType==='ai-reference'?'AI参考图':recipe.imageType==='user-upload'?'用户上传图片':'来源图片';
  if(!source){
    const loading=imageQueued.has(recipe.id),error=imageErrors.get(recipe.id);
    return `<div class="dish-photo image-missing compact-image-placeholder" data-recipe-image="${esc(recipe.id)}" aria-label="${esc(recipe.title)}图片"><span>${loading?'正在搜索配图…':error?'图片搜索失败':'等待搜索配图'}</span>${error?`<details class="image-error-details"><summary>查看原因</summary><small class="image-generation-error">${esc(error)}</small></details><button class="text-button" data-action="generate-recipe-image" data-id="${esc(recipe.id)}">重试搜索</button>`:''}</div>`;
  }
  const credit=recipe.imageType==='web-search'?`<p class="recipe-image-credit">网络搜索参考 · 来源：${recipe.imageSourceUrl?`<a href="${esc(recipe.imageSourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(recipe.imageSource||'查看来源')}</a>`:esc(recipe.imageSource||'来源待核对')} · 授权待核对</p>`:'';
  return `<div class="dish-photo ${recipe.imageType==='ai-reference'?'ai-reference':''}" data-recipe-image="${esc(recipe.id)}"><img src="${esc(source)}" alt="${esc(recipe.imageAlt||recipe.title+'菜品参考图')}" loading="lazy" onerror="this.hidden=true;this.parentElement.classList.add('image-failed');if(!this.parentElement.querySelector('.image-failed-label')){const label=document.createElement('span');label.className='image-failed-label';label.textContent='图片暂不可用';this.parentElement.append(label)}">${recipe.imageType?`<span class="image-type">${esc(imageLabel)}</span>`:''}<button class="image-retry" data-action="retry-recipe-image" data-id="${esc(recipe.id)}" aria-label="重试图片">重试图片</button></div>${credit}`;
}
function updateRecipeImageSlots(id){
  const recipe=recipeForView(recipeById(id));
  if(!recipe)return;
  document.querySelectorAll('[data-recipe-image]').forEach(node=>{
    if(node.dataset.recipeImage===id)node.outerHTML=imageMarkup(recipe);
  });
}
function queueRecipeImages(ids, retry=false){
  for(const id of ids){
    const recipe=recipeById(id);
    if(!recipe||recipe.imageUrl||state.generatedRecipeImages?.[id]?.imageType==='web-search'||imageQueued.has(id)||(!retry&&imageErrors.has(id)))continue;
    imageErrors.delete(id);imageQueued.add(id);imageQueue.push(id);updateRecipeImageSlots(id);
  }
  if(!imageWorkerBusy&&imageQueue.length){imageWorkerBusy=true;Promise.resolve().then(processRecipeImages);}
}
async function processRecipeImages(){
  while(imageQueue.length){
    const id=imageQueue.shift(),recipe=recipeById(id);
    if(!recipe){imageQueued.delete(id);continue;}
    try{
      const result=await api('/api/recipe-image',{method:'POST',body:JSON.stringify({title:recipe.title,ingredients:(recipe.ingredients||[]).map(item=>item.name)})});
      state.generatedRecipeImages=state.generatedRecipeImages||{};state.generatedRecipeImages[id]=result;
      await persist();
    }catch(error){imageErrors.set(id,error.message||'图片搜索失败');}
    finally{imageQueued.delete(id);updateRecipeImageSlots(id);}
  }
  imageWorkerBusy=false;
}

function favoriteButton(recipe,{showText=false}={}){
  const saved=(state.favorites||[]).includes(recipe.id);
  return `<button type="button" class="recipe-favorite-button${showText?' with-label':''}" data-action="toggle-favorite"
    data-id="${esc(recipe.id)}" aria-label="收藏 ${esc(recipe.title)}" aria-pressed="${saved}" title="${saved?'取消收藏':'收藏菜谱'}">
    <span aria-hidden="true">${saved?'♥':'♡'}</span>${showText?`<strong>${saved?'已收藏':'收藏菜谱'}</strong>`:''}</button>`;
}
function recipeCardIngredients(recipe){
  const food=[],seasoning=[];
  for(const item of [...(recipe.ingredients||[]),...(recipe.auxiliaries||[]),...(recipe.seasonings||[])]){
    if(!item.name||/^(清水|水)$/.test(item.name))continue;
    const names=(recipe.seasonings||[]).includes(item)||isSeasoning(item)?seasoning:food;
    if(!names.includes(item.name))names.push(item.name);
  }
  const line=(label,names)=>names.length
    ?`<div><dt>${label}</dt><dd>${esc(names.slice(0,6).join('、'))}${names.length>6?' 等':''}</dd></div>`:'';
  return food.length||seasoning.length?`<dl class="recipe-card-ingredients">${line('食材',food)}${line('调味',seasoning)}</dl>`:'';
}
function recipeBack(label,action){
  return `<button type="button" class="secondary-button back-link" data-action="${action}">‹ ${label}</button>`;
}

function recipeCard(id){
  const recipe=recipeForView(recipeById(id));
  if(!recipe)return '';
  const selected=mealPlan.menu.some(entry=>entry.recipeId===id);
  const stock=stockSummary(recipe);
  const totalTime=Number(recipe.duration||0)+Number(recipe.waitMinutes||0);
  const time=recipe.duration?`${totalTime}分钟${Number(recipe.waitMinutes)>0?`（含等待${recipe.waitMinutes}分）`:''}`:'用时待确认';
  const expiringItems=requiredFoodSources(recipe).filter(item=>item.allocations?.some(allocation=>{const stockItem=state.inventory.find(entry=>entry.id===allocation.inventoryId);return stockItem&&stockPriority(stockItem);})).map(item=>item.name);
  const reason=stock.expiring?`建议优先食用：${[...new Set(expiringItems)].join('、')}`:recipe.reason||'按餐次与偏好筛选';
  const ingredients=(recipe.ingredients||[]).filter(isTrackedRecipeIngredient);
  const stockLine=mealPlan.request.mode==='supplement'?`可用库存：${ingredients.filter(item=>item.covered>0).map(item=>item.name).join('、')||'待核对'} · 待补买/核对：${ingredients.filter(item=>item.quantity==null||item.covered<item.quantity).map(item=>item.name).join('、')||'无明确缺口'}`:stock.status;
  const freshness=mealPlan.request.mode==='explore'&&recipe.trendLabel?`<p class="trend-note">${esc(recipe.trendLabel)}</p>`:'';
  if(currentTab==='recipes'){
    const badges=[];
    if(mealPlan.request.mode!=='explore'&&expiringItems.length)badges.push({text:'建议优先用',kind:'priority'});
    if(recipe.duration!=null&&totalTime<=20)badges.push({text:'快手菜',kind:'quick'});
    if((recipe.steps||[]).length>0&&(recipe.steps||[]).length<=3)badges.push({text:'少步骤',kind:'steps'});
    if(mealPlan.request.mode!=='explore'){
      const coverage=requiredFoodSources(recipe).map(sourceCoverage);
      if(coverage.length&&coverage.some(item=>item.uncertain))badges.push({text:'用量待核对',kind:'check'});
      else if(coverage.length&&coverage.every(item=>item.hasStock&&!item.needsPurchase))badges.push({text:'主要食材已记录',kind:'ready'});
      else if(coverage.some(item=>item.needsPurchase))badges.push({text:'需要补购',kind:'purchase'});
    }
    // 地区和季节尚无可核验依据，不使用时令标签。
    const tags=badges.length?`<div class="recipe-card-tags">${badges.slice(0,5).map(badge=>`<span class="recipe-card-tag tag-${badge.kind}">${esc(badge.text)}</span>`).join('')}</div>`:'';
    return `<article class="meal-card ${selected?'is-selected':''}">${imageMarkup(recipe)}<div class="meal-card-content"><div class="meal-card-heading"><h3>${esc(recipe.title)}</h3>${favoriteButton(recipe)}</div><div class="meal-card-meta"><span>${esc(time)}</span><span>${esc(recipe.servings||mealPlan.request.servings)}人份</span></div>${tags}${recipeCardIngredients(recipe)}${freshness}<div class="meal-card-actions"><button class="secondary-button" data-action="recipe-detail" data-id="${esc(id)}">查看做法</button><button class="${selected?'secondary-button':'primary-button'}" data-action="${selected?'remove-menu-item':'choose-meal'}" data-id="${esc(id)}">${selected?'移出本餐':replaceMenuIndex!==null?'替换菜品':'加入本餐'}</button></div>${recipe.isUserRecipe?`<div class="saved-recipe-actions"><button class="text-button" data-action="edit-saved-recipe" data-id="${esc(id)}">编辑</button><button class="text-button danger-text" data-action="delete-saved-recipe" data-id="${esc(id)}">删除</button></div>`:''}</div></article>`;
  }
  return `<article class="meal-card ${selected?'is-selected':''}">${imageMarkup(recipe)}<div class="meal-card-content"><div class="meal-card-heading"><div><h3>${esc(recipe.title)}</h3><p class="meal-composition">${esc([...(recipe.dishes||[]),recipe.subtitle||recipe.title].filter(Boolean).join(' · '))}</p></div>${favoriteButton(recipe)}</div><div class="meal-card-meta"><span>${time}</span><span>${mealPlan.request.servings}人份</span><span>${esc((recipe.appliances||[]).join('、')||'厨具待确认')}</span></div>${freshness}<p class="meal-reason">${esc(reason)}</p><p class="stock-state">${esc(stockLine)}</p>${recipeCardIngredients(recipe)}<div class="meal-card-actions"><button class="${selected?'secondary-button':'primary-button'}" data-action="${selected?'remove-menu-item':'choose-meal'}" data-id="${esc(id)}">${selected?'移出本餐':replaceMenuIndex!==null?'替换菜品':'加入本餐'}</button><button class="secondary-button" data-action="recipe-detail" data-id="${esc(id)}">${selected?'查看做法':'查看搭配'}</button></div>${recipe.isUserRecipe?`<div class="saved-recipe-actions"><button class="text-button" data-action="edit-saved-recipe" data-id="${esc(id)}">编辑</button><button class="text-button danger-text" data-action="delete-saved-recipe" data-id="${esc(id)}">删除</button><small>${recipe.reviewStatus==='user-reviewed'?'已由用户核对保存':'待补充核对'}</small></div>`:''}</div></article>`;
}
function recipeCards(){
  return mealPlan.results.map(recipeCard).join('');
}
function mealMenuButton(){
  return `<button class="meal-menu-entry" data-action="open-meal-menu">本餐菜单 · <span aria-live="polite">已选${mealPlan.menu.length}道</span></button>`;
}
function menuRecipe(entry){
  return recipeForView(recipeById(entry.recipeId),entry.servings||mealPlan.request.servings);
}
function isSeasoning(item){
  return item.category==='seasoning'||/^(食盐|盐|白糖|糖|食用油|植物油|油|生抽|老抽|酱油|料酒|蚝油|醋|香油|芝麻油|胡椒粉|辣椒粉|辣椒酱|豆瓣酱|番茄酱|淀粉|味精|鸡精)$/.test(item.name);
}
function isTrackedRecipeIngredient(item){
  return item.category!=='auxiliary'&&!isSeasoning(item)&&!/^(清水|水)$/.test(item.name);
}
function menuInventorySummary(){
  const grouped=new Map();
  for(const entry of mealPlan.menu){
    const recipe=menuRecipe(entry);
    if(!recipe)continue;
    for(const ingredient of (recipe.ingredients||[]).filter(isTrackedRecipeIngredient)){
      const key=`${ingredient.name}|${ingredient.unit||''}`;
      const current=grouped.get(key)||{name:ingredient.name,unit:ingredient.unit||'',quantity:0,known:true,recipes:[],optional:ingredient.optional===true};
      if(ingredient.quantity==null||ingredient.quantity===''||!Number.isFinite(Number(ingredient.quantity))||Number(ingredient.quantity)<=0)current.known=false;
      else current.quantity=Number((current.quantity+Number(ingredient.quantity)).toFixed(2));
      current.optional=current.optional&&ingredient.optional===true;
      current.recipes.push(recipe.title);grouped.set(key,current);
    }
  }
  return [...grouped.values()].map(item=>{
    const records=state.inventory.filter(stock=>stockNameMatches(stock.name,item.name));
    const valid=records.filter(stock=>safeInventory(stock)&&stock.quantity!=null&&stock.quantity!==''&&Number.isFinite(Number(stock.quantity))&&Number(stock.quantity)>=0);
    const compatible=valid.filter(stock=>item.unit&&stockUnitMatches(stock.unit,item.unit));
    if(!records.length)return {...item,stockGroup:'unrecorded',status:'冰箱未记录，家里是否有待核对',gap:null,covered:null,suggestedQuantity:item.known?item.quantity:null};
    if(!valid.length)return {...item,stockGroup:'uncertain',status:'冰箱有记录，数量或状态待核对',gap:null,covered:null,suggestedQuantity:null};
    if(!compatible.length)return {...item,stockGroup:'uncertain',status:'冰箱有记录，单位不一致，待核对',gap:null,covered:null,suggestedQuantity:null};
    const available=compatible.reduce((sum,stock)=>sum+Number(stock.quantity),0);
    if(!item.known)return {...item,stockGroup:'uncertain',status:`冰箱记录 ${available} ${item.unit}，菜谱用量待确认`,gap:null,covered:available,suggestedQuantity:null};
    const gap=Math.max(0,Number((item.quantity-available).toFixed(2)));
    const partial=records.length!==compatible.length;
    if(partial&&gap>0)return {...item,stockGroup:'uncertain',status:`冰箱可比较记录 ${available} ${item.unit}，其他记录待核对`,gap:null,covered:available,suggestedQuantity:null};
    return {...item,stockGroup:gap>0?'short':'covered',status:gap>0?`冰箱记录 ${available} ${item.unit}，预计还需 ${gap} ${item.unit}`:`冰箱记录 ${available} ${item.unit}，参考用量可覆盖`,gap,covered:available,suggestedQuantity:gap>0?gap:null};
  });
}
function menuShoppingCandidates(){
  return menuInventorySummary().filter(item=>!item.optional&&
    item.stockGroup!=='covered'&&!state.shopping.some(line=>stockNameMatches(line.name,item.name)&&
      (line.status==='pending'||line.status==='bought'&&!state.inventory.some(stock=>stock.sourceShoppingId===line.id))));
}

function estimatedMinutes(recipe){
  return Number.isFinite(Number(recipe.duration))?Number(recipe.duration):null;
}
function menuEstimatedDuration(){
  return collectMenuAllocations().estimatedMinutes??'待估';
}
function mealMenuPage(){
  const ingredients=menuInventorySummary();
  const hasGaps=menuShoppingCandidates().length>0;
  const scheduleDuration=collectMenuAllocations().estimatedMinutes;
  const timeCopy=scheduleDuration==null?'总用时待估':`总用时约 ${scheduleDuration} 分钟`;
  return `<div class="recipe-page meal-menu-page">${recipeBack('返回菜谱','back-to-recipes')}<h2>本餐菜单</h2><div class="meal-quick-adjust"><label>本餐人数<select id="menu-servings"><option value="1" ${mealPlan.request.servings===1?'selected':''}>1人</option><option value="2" ${mealPlan.request.servings===2?'selected':''}>2人</option></select></label><span>${mealLabel(plannedMeal())} · ${timeCopy}</span></div>${mealPlan.menu.length?`<div class="menu-dishes">${mealPlan.menu.map((entry,index)=>{const recipe=menuRecipe(entry);return recipe?`<article class="menu-dish card">${imageMarkup(recipe)}<div><strong>${esc(recipe.title)}</strong><small>${entry.servings||mealPlan.request.servings}人份</small><div class="menu-dish-actions"><button class="text-button" data-action="recipe-detail" data-id="${esc(entry.recipeId)}">查看做法</button><button class="text-button" data-action="replace-menu-item" data-index="${index}">换一道</button><button class="text-button danger-text" data-action="remove-menu-item" data-id="${esc(entry.recipeId)}">移出本餐</button></div></div></article>`:''}).join('')}</div><button class="secondary-button full-button" data-action="add-another-dish">再添一道</button><div class="section-title"><h2>整餐食材摘要</h2></div><section class="card">${ingredients.map(item=>`<div class="inventory-item"><div class="item-main"><strong>${esc(item.name)}</strong><p>${item.known?`参考需要 ${item.quantity} ${esc(item.unit)}`:'参考用量待确认'} · ${esc(item.status)}</p></div></div>`).join('')}</section><div class="meal-menu-actions">${hasGaps?'<button class="secondary-button" data-action="menu-shopping">确认采购食材</button>':'<span class="menu-no-gaps">目前没有明确缺口</span>'}<button class="primary-button" data-action="start-cooking">进入逐道制作</button></div>`:'<section class="card empty"><b>本餐还没有菜</b><span>从发现菜谱或我的菜谱添加一道或多道菜。</span><button class="primary-button" data-action="back-to-recipes">去选菜</button></section>'}${mealMenuButton()}</div>`;
}
function recipeTabs(active){
  return `<div class="recipe-tabs" role="tablist" aria-label="菜谱功能">${[['discover','发现菜谱'],['saved','我的菜谱'],['favorites','我的收藏'],['shopping','采购清单']].map(([id,label])=>`<button role="tab" aria-selected="${active===id}" class="${active===id?'active':''}" data-action="recipe-section" data-section="${id}">${label}</button>`).join('')}</div>`;
}
function recipeShoppingPage(){
  const count=mealPlan.menu.length;
  return `<div class="recipe-page recipe-shopping-page">${recipeBack('返回发现菜谱','recipe-discover')}${recipeTabs('shopping')}<div class="section-title"><div><h2>采购清单</h2><p class="meta">与采购页共用同一份清单</p></div></div><section class="card recipe-shopping-source"><div><strong>从已选菜谱添加</strong><p class="meta">${count?`本餐已选 ${count} 道，核对食材后加入清单。`:'先选择菜谱，再核对需要购买的食材。'}</p></div><button class="secondary-button" data-action="shopping-from-menu">${count?'核对并添加':'去选菜'}</button></section>${shoppingPage()}</div>`;
}
function myRecipesPage(){
  const query=recipeSearch.trim().toLowerCase();
  const saved=state.recipes.filter(recipe=>!query||`${recipe.title} ${(recipe.ingredients||[]).map(item=>item.name).join(' ')} ${recipe.tags?.join(' ')} ${recipe.platform||''}`.toLowerCase().includes(query));
  return `<div class="recipe-page my-recipes-page">${recipeBack('返回发现菜谱','recipe-discover')}${recipeTabs('saved')}<div class="section-title"><h2>我的菜谱</h2><button class="primary-button import-button" data-action="open-import">导入菜谱</button></div><form class="recipe-search" id="saved-recipe-search">${voiceInput('saved-recipe-query','我的菜谱搜索',`<input id="saved-recipe-query" name="search" value="${esc(recipeSearch)}" placeholder="搜索我的菜谱">`)}<button class="secondary-button" type="submit">搜索</button></form>${state.recipeDrafts.length?`<section class="card"><strong>待核对草稿 · ${state.recipeDrafts.length}</strong>${state.recipeDrafts.map(draft=>`<div class="draft-row"><div><b>${esc(draft.title||'未命名草稿')}</b><small>${esc(draft.parseStatus||'内容尚未解析')} · ${draft.uncertainties?.length||0} 项待确认</small></div><button class="secondary-button" data-action="edit-recipe-draft" data-id="${esc(draft.id)}">继续编辑</button></div>`).join('')}</section>`:''}${saved.length?`<div class="meal-grid">${saved.map(recipe=>recipeCard(recipe.id)).join('')}</div>`:`<section class="card empty"><b>${state.recipes.length?'没有匹配的菜谱':'还没有保存的菜谱'}</b></section>`}${mealMenuButton()}</div>`;
}
function favoriteLinkCard(card){
  const url=recipeSourceUrl(card.sourceUrl);
  if(!url)return '';
  const imageUrl=safeFavoriteCover(card.imageUrl);
  return `<article class="meal-card favorite-link-card">
    <a class="favorite-link-target" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">
      ${imageUrl?`<div class="dish-photo"><img src="${esc(imageUrl)}" alt="" loading="lazy"></div>`:''}
      <div class="favorite-link-title"><h3>${esc(card.title)}</h3><span>打开${esc(recipeSourcePlatform(url))} ↗${imageUrl.startsWith('/api/')?' · AI 封面':''}</span></div>
    </a>
    <button type="button" class="secondary-button" data-action="remove-favorite-link" data-id="${esc(card.id)}" aria-label="移除收藏 ${esc(card.title)}">移除收藏</button>
  </article>`;
}
function favoriteRecipesPage(){
  const ids=[...new Set(state.favorites||[])].filter(id=>recipeById(id)).reverse();
  const cards=[...(state.favoriteLinks||[]).map(favoriteLinkCard),...ids.map(recipeCard)].filter(Boolean);
  return `<div class="recipe-page favorites-page">
    ${recipeBack('返回发现菜谱','recipe-discover')}${recipeTabs('favorites')}
    <div class="section-title"><h2>我的收藏 · ${cards.length} 道</h2><button class="primary-button" data-action="open-favorite-import">导入菜谱链接</button></div>
    ${cards.length?`<div class="meal-grid">${cards.join('')}</div>`:'<section class="card empty"><b>还没有收藏菜谱</b><p>收藏推荐菜谱，或导入喜欢的菜谱链接。</p></section>'}
    ${mealMenuButton()}
  </div>`;
}
function recipePage(){
  if(currentDetailId)return recipeDetailPage(currentDetailId);
  if(recipeScreen==='menu')return mealMenuPage();
  if(recipeScreen==='cooking')return cookingPage();
  if(recipeScreen==='complete')return completePage();
  if(recipeSection==='saved')return myRecipesPage();
  if(recipeSection==='favorites')return favoriteRecipesPage();
  if(recipeSection==='shopping')return recipeShoppingPage();
  const meal=effectiveMeal();
  const active=activeMeal();
  return `<div class="recipe-page discover-page">
    ${returnTab==='profile'?recipeBack('返回我的','back-to-profile'):'<button type="button" class="secondary-button back-link" data-tab-go="home">‹ 返回首页</button>'}
    ${recipeTabs('discover')}
    ${active?`<section class="active-meal-banner"><strong>${active.status==='awaiting_confirmation'?'本餐待确认消耗':`正在制作：${active.dishes.map(item=>esc(item.recipe.title)).join('、')}`}</strong><button class="text-button" data-action="${active.status==='awaiting_confirmation'?'finish-cooking':'continue-cooking'}">${active.status==='awaiting_confirmation'?'确认消耗':'继续制作'}</button></section>`:''}
    <form class="recipe-search" id="recipe-query">${voiceInput('dish-query','用餐需求',`<input name="dish" id="dish-query" value="${esc(mealPlan.request.dish)}" placeholder="说说家里有什么，想吃什么" aria-label="说说家里有什么，想吃什么" autocomplete="off">`)}<button type="submit" class="primary-button" ${recommendationLoading?'disabled':''}>${recommendationLoading?'生成中…':'帮我搭配'}</button></form>
    <div class="recipe-quick-controls"><span class="meal-readonly">${mealLabel(meal)}</span><label>人数<select id="servings-select">${[...new Set([1,2,3,4,5,6,8,10,12,mealPlan.request.servings])].sort((a,b)=>a-b).map(value=>`<option value="${value}" ${mealPlan.request.servings===value?'selected':''}>${value}人</option>`).join('')}</select></label><label>时间<select id="duration-select">${[...new Set([15,20,30,45,60,90,mealPlan.request.duration])].sort((a,b)=>a-b).map(value=>`<option value="${value}" ${mealPlan.request.duration===value?'selected':''}>${value}分钟内</option>`).join('')}</select></label><button class="compact-control" data-action="reset-meal">重新安排</button></div>
    <div class="meal-mode-controls" role="group" aria-label="推荐方式">${[['use-first','现有食材'],['supplement','增补食材'],['explore','不限食材']].map(([value,label])=>`<button class="${mealPlan.request.mode===value?'active':''}" data-action="meal-mode" data-mode="${value}" aria-pressed="${mealPlan.request.mode===value}">${label}</button>`).join('')}</div>
    <div class="section-title recipe-results-title"><h2>推荐菜谱</h2><button class="secondary-button" data-action="more-recipes" ${recommendationLoading?'disabled':''}>换一批</button></div>
    ${recommendationNotice?`<p class="meta recommendation-notice">${esc(recommendationNotice)}</p>`:''}
    ${recommendationError?`<section class="card error-card"><span>${esc(recommendationError)}</span><button class="secondary-button" data-action="retry-recommendation">重试</button></section>`:''}
    ${recommendationLoading?'<div class="loading"><span class="spinner"></span>正在理解需求并生成文字菜谱…<button class="text-button" data-action="cancel-recommendation">取消</button></div>':''}
    ${mealPlan.results.length?`<div class="meal-grid">${recipeCards()}</div>`:recommendationLoading||recommendationError?'':`<section class="card empty recipe-empty"><b>暂无符合条件的菜谱</b><button class="secondary-button" data-action="retry-recommendation">重新推荐</button></section>`}
    ${mealPlan.lastCompleted?`<section class="last-cooked card"><span>最近完成：${esc(mealPlan.lastCompleted.recipe.title)}</span>${mealPlan.lastCompleted.consumedNothing&&!mealPlan.lastCompleted.canUndoPurchase?'<small>本次未扣减库存</small>':`<button class="text-button" data-action="undo-cook" data-operation="${esc(mealPlan.lastCompleted.operationId)}">撤销本次消耗</button>`}</section>`:''}
    ${mealMenuButton()}
  </div>`;
}
function recipeDetailPage(id){
  const entry=mealPlan.menu.find(item=>item.recipeId===id);
  const recipe=recipeForView(recipeById(id),entry?.servings);
  if(!recipe)return '<section class="card empty"><b>找不到这套菜谱</b><button data-action="back-recipes">返回推荐</button></section>';
  const selected=mealPlan.menu.some(entry=>entry.recipeId===id);
  const ingredientGroups=[
    ['主要食材',recipe.ingredients||[]],
    ['辅料',recipe.auxiliaries||[]],
    ['调味料',recipe.seasonings||[]]
  ];
  const uncertainties=recipe.uncertainties||[];
  const sourceUrl=recipeSourceUrl(recipe.sourceUrl);
  return `<div class="recipe-detail">${recipeBack('返回'+(recipeScreen==='menu'?'本餐菜单':({saved:'我的菜谱',favorites:'我的收藏',shopping:'采购清单'})[recipeSection]||'发现菜谱'),'back-recipes')}${imageMarkup(recipe,true)}<div class="detail-title"><h2>${esc(recipe.title)}</h2>${recipe.isUserRecipe?`<button class="text-button" data-action="edit-saved-recipe" data-id="${esc(id)}">编辑菜谱</button>`:''}${favoriteButton(recipe,{showText:true})}</div><div class="meal-card-meta"><span>${recipe.duration?`原文用时 ${recipe.duration}分钟`:'原文未提供用时'}</span><span>${recipe.servings}人份</span><span>${esc((recipe.appliances||[]).join('、')||'厨具待确认')}</span></div>${recipe.parseStatus==='not-configured'?'<p class="meta">分享内容尚未解析；以下信息由用户手动核对，不是模型提取结果。</p>':''}${uncertainties.length?`<p class="meta">待确认：${esc(uncertainties.join('、'))}</p>`:''}${ingredientGroups.filter(([,items])=>items.length).map(([label,items])=>`<div class="section-title"><h2>${label}</h2></div><section class="card">${items.map(ingredient=>`<div class="inventory-item"><div class="item-main"><strong>${esc(ingredient.name)}${ingredient.form?`（${esc(ingredient.form)}）`:''}${ingredient.optional?' · 可选':''}</strong><p>${ingredient.quantity==null?'用量待确认':`${esc(ingredient.quantity)} ${esc(ingredient.unit||'')}${ingredient.quantityType==='suggested'?' · 建议值':''}`}${ingredient.suggestion?' · 建议补充':''}${ingredient.usedInSteps?.length?` · ${esc(ingredient.usedInSteps.join('、'))}`:''}</p></div></div>`).join('')||'<p class="meta">暂无记录</p>'}</section>`).join('')}<div class="section-title"><h2>制作步骤</h2></div><div class="step-flow">${recipe.steps.map((step,index)=>`<article class="flow-step"><span class="step-number">${index+1}</span><div class="flow-step-content"><h3>${esc(step.title||`第 ${index+1} 步`)}</h3>${step.imageUrl?`<div class="step-image"><img onerror="this.parentElement.innerHTML='图片暂不可用 · 文字制作仍可继续'" src="${esc(step.imageUrl)}" alt="${esc(step.imageType==='ai-step'?'AI步骤示意':'用户上传步骤图片')}" loading="lazy">${step.imageType==='ai-step'?'<small>AI步骤示意</small>':''}</div>`:''}<p>${esc(step.text)}</p>${step.ingredients?.length?`<small>用量：${esc(step.ingredients.join('、'))}</small>`:''}${step.minutes?`<small>${step.minutes} 分钟</small>`:''}${step.completion?`<small>完成判断：${esc(step.completion)}</small>`:''}</div></article>`).join('')||'<p class="meta">制作步骤待补充</p>'}</div><section class="image-credit">${sourceUrl?`来源：${esc(recipe.platform||recipeSourcePlatform(sourceUrl))} · <a class="secondary-button recipe-source-link" href="${esc(sourceUrl.href)}" target="_blank" rel="noopener noreferrer">打开${esc(recipeSourcePlatform(sourceUrl))}</a>${recipe.author?` · 作者 ${esc(recipe.author)}`:''}`:'来源：用户手动录入'}<br>${recipe.imageUrl?`图片类型：${esc(recipe.imageType||'来源图片')} · ${esc(recipe.imageSource||'来源待补充')} · ${esc(recipe.imageCredit||'署名待补充')} · ${esc(recipe.imageLicense||'授权待核实')}`:'图片尚未添加'}</section><div class="sticky-actions"><button class="secondary-button" data-action="open-meal-menu">本餐菜单 · ${mealPlan.menu.length} 道</button><button class="${selected?'secondary-button':'primary-button'}" data-action="${selected?'remove-menu-item':'add-menu-item'}" data-id="${esc(id)}">${selected?'移出本餐':replaceMenuIndex!==null?'替换菜品':'加入本餐'}</button></div></div>`;
}
function homePage(){
  const homeMeal=mealForDate(new Date());
  const expiring=state.inventory.filter(item=>item.freshness==='即将到期');
  const pending=state.shopping.filter(item=>item.status==='pending');
  const recipe=mealPlan.resultMeal===homeMeal?recipeById(mealPlan.results[0]):null;
  return `<section class="card agent-card"><div class="agent-intro"><div class="agent-avatar">✦</div><div><strong>问问厨房管家</strong><p>结合库存与偏好，安排适合的一餐</p></div></div><form class="ask-row" id="ask-form">${voiceInput('agent-question','厨房需求',`<input id="agent-question" required placeholder="例如：优先用掉快过期食材">`)}<button type="submit" ${agentLoading?'disabled':''}>${agentLoading?'请稍候':'提问'}</button></form><div class="quick-chips"><button class="chip" data-action="meal-recommend">${esc(MEALS[homeMeal].homeAction)}</button><button class="chip" data-tab-go="recipes">查看推荐方案</button></div></section><div class="metrics"><div class="metric"><b>${state.inventory.length}</b><span>食材种类</span></div><div class="metric"><b>${expiring.length}</b><span>建议优先食用</span></div><div class="metric"><b>${pending.length}</b><span>待买食材</span></div></div>${expiring.length?`<section class="card expiring-note"><strong>建议优先食用</strong><p>${expiring.map(item=>esc(item.name)).join('、')} · 新鲜状态仅为记录参考，不是安全检测。</p></section>`:''}<div class="section-title"><h2>${esc(mealTitle(homeMeal))}</h2><button class="text-button" data-tab-go="recipes">全部方案</button></div>${recipe?recipeCard(recipe.id):'<section class="card empty"><b>还没有推荐方案</b><button class="primary-button" data-action="meal-recommend">开始推荐</button></section>'}<div class="section-title"><h2>采购清单</h2><span class="meta">待买 ${pending.length} 项</span></div><section class="card">${pending.length?pending.map(shoppingRow).join(''):'<p class="meta">待买清单是空的</p>'}<div class="bottom-action"><button class="secondary-button" data-action="add-shopping">＋ 新增食材</button><button class="secondary-button" data-tab-go="shopping">查看采购清单</button></div></section>`;
}
function inventoryPage(){
  return `<form class="recipe-search inventory-search" id="inventory-search">${voiceInput('inventory-search-query','冰箱食材搜索',`<input id="inventory-search-query" name="search" value="${esc(inventorySearch)}" placeholder="搜索冰箱食材">`)}<button class="secondary-button" type="submit">搜索</button></form><div class="tab-switch">${['冷藏','冷冻'].map((location,index)=>`<button class="${index===0?'active':''}" data-action="inventory-location" data-location="${location}">${location}</button>`).join('')}</div><div id="inventory-list">${inventoryList('冷藏')}</div>`;
}
function inventoryList(location){
  const query=inventorySearch.trim().toLowerCase();
  const items=state.inventory.filter(item=>item.location===location&&(!query||item.name.toLowerCase().includes(query)));
  if(!items.length)return `<section class="card empty"><b>${query?'没有匹配的食材':'这里还没有食材'}</b><span>${query?'试试其他名称，或清空搜索。':'录入库存后，可按实际记录匹配菜谱。'}</span><button class="primary-button" data-action="open-inventory">添加库存</button></section>`;
  return `<section class="card">${items.map(item=>{const estimated=item.quantityBasis==='estimated';const updatedAt=item.quantityBasisUpdatedAt?String(item.quantityBasisUpdatedAt).slice(0,10):'';return `<div class="inventory-item"><div class="food-icon">${foodIcon(item.name)}</div><div class="item-main"><strong>${esc(item.name)}</strong><p>${esc(item.location)} · ${item.expiryDate?`到期 ${esc(item.expiryDate)}`:'未设置到期日'} · ${safeInventory(item)?esc(item.freshness||'状态待确认'):'已标记不可食用'}</p></div><div class="item-side"><strong>${estimated?'预计剩余 ':''}${esc(item.quantity??'待确认')} ${esc(item.unit||'')}</strong><small>${item.quantity==null?'数量待确认':estimated?'按参考用量估算':`实物记录${updatedAt?` · ${updatedAt}`:''}`}</small></div><button class="text-button" data-action="edit-inventory" data-id="${esc(item.id)}">编辑</button></div>`;}).join('')}</section>`;
}
function shoppingPage(){
  const pending=state.shopping.filter(item=>item.status==='pending'),bought=state.shopping.filter(item=>item.status==='bought');
  const list=shoppingTab==='pending'?pending:bought;
  const returnBanner=returnToMeal?'<section class="active-meal-banner"><strong>采购完成后可返回这顿饭</strong><button class="text-button" data-action="return-to-meal">返回这顿饭</button></section>':'';
  const emptyLabel=shoppingTab==='pending'?'待买清单是空的':'还没有已买食材';
  const syncButton=shoppingTab==='bought'&&bought.length?'<button class="primary-button full-button" data-action="sync-shopping">一键同步入库</button>':'';
  return `${returnBanner}<div class="tab-switch"><button class="${shoppingTab==='pending'?'active':''}" data-action="shopping-tab" data-status="pending">待买 ${pending.length}</button><button class="${shoppingTab==='bought'?'active':''}" data-action="shopping-tab" data-status="bought">已买 ${bought.length}</button></div><section class="card">${list.length?list.map(shoppingRow).join(''):`<div class="empty"><b>${emptyLabel}</b></div>`}</section>${syncButton}<div class="bottom-action"><button class="secondary-button" data-action="add-shopping">＋ 新增食材</button></div>`;
}
function shoppingRow(item){
  return `<div class="shopping-item"><input class="shopping-check" type="checkbox" ${item.status==='bought'?'checked':''} data-action="toggle-shopping" data-id="${esc(item.id)}"><div class="item-main ${item.status==='bought'?'strike':''}"><strong>${esc(item.name)}</strong><p>${esc(item.source||'手动新增')}</p></div><div class="item-side"><strong>${item.quantity==null||item.quantity===''?'数量待确认':esc(item.quantity)} ${esc(item.unit||'')}</strong><button class="text-button" data-action="edit-shopping-quantity" data-id="${esc(item.id)}">修改</button></div><button class="text-button" data-action="delete-shopping" data-id="${esc(item.id)}">删除</button></div>`;
}
function profilePage(){
  const p=state.preferences;
  const favorites=allRecipes().filter(r=>(state.favorites||[]).includes(r.id));
  const history=state.history||[];
  const cooked=history.filter(h=>h.type==='cook').length;
  const preferenceTags=[...(p.flavors||[]),...(p.needs||[])].slice(0,4);
  const avoidTags=p.avoid||[];
  const allergyTags=p.allergies||[];
  return `<section class="profile-cover">
    <div class="profile-cover-top"><span class="profile-kicker">食光管家</span><span class="profile-more">···</span></div>
    <div class="profile-person"><div class="profile-avatar">👩🏻‍🍳</div><div><h2>我的厨房</h2><p>让每一餐都更合心意</p></div></div>
    <div class="profile-summary"><div><b>${cooked}</b><span>完成烹饪</span></div><i></i><div><b>${favorites.length}</b><span>收藏菜谱</span></div><i></i><div><b>${p.reminder?'已开启':'未开启'}</b><span>临期提醒</span></div></div>
  </section>
  <section class="profile-preferences-card">
    <div class="profile-card-heading"><div><span class="profile-icon">✦</span><div><h2>偏好记忆</h2><p>这些信息会帮助管家安排更适合你的菜谱</p></div></div><button data-action="edit-preferences">编辑</button></div>
    <div class="preference-group"><span>喜欢的口味</span><div class="preference-tags">${preferenceTags.length?preferenceTags.map(tag=>'<em>'+esc(tag)+'</em>').join(''):'<small>暂未设置</small>'}</div></div>
    <div class="preference-group"><span>忌口 / 不想吃</span><div class="preference-tags muted">${avoidTags.length?avoidTags.map(tag=>'<em>'+esc(tag)+'</em>').join(''):'<small>暂未设置</small>'}</div></div>
    <div class="preference-group"><span>过敏提示</span><div class="preference-tags danger">${allergyTags.length?allergyTags.map(tag=>'<em>'+esc(tag)+'</em>').join(''):'<small>暂未设置</small>'}</div></div>
    <div class="reminder-row"><div><strong>临期预警</strong><span>临期食材优先提醒</span></div><input class="switch" aria-label="临期预警" type="checkbox" ${p.reminder?'checked':''} data-action="toggle-reminder"></div>
  </section>
  <div class="section-title profile-section-title"><h2>我的收藏</h2><button data-tab-go="recipes" data-return-tab="profile">去菜谱看看</button></div>
  <section class="card profile-favorites">${favorites.length?favorites.slice(0,3).map(r=>'<div class="inventory-item"><div class="food-icon">'+esc(r.imageEmoji||'🍲')+'</div><div class="item-main"><strong>'+esc(r.title)+'</strong><p>'+esc(r.duration||30)+' 分钟 · '+esc(r.difficulty||'简单')+'</p></div><span class="row-arrow">›</span></div>').join(''):'<div class="profile-empty"><span>♡</span><div><b>还没有收藏菜谱</b><p>喜欢的菜谱，点按爱心就会保存在这里。</p></div><button data-tab-go="recipes" data-return-tab="profile">去发现</button></div>'}</section>
  <div class="section-title profile-section-title"><h2>最近记录</h2><span class="meta">${history.length} 条</span></div>
  <section class="card profile-history">${history.length?history.slice(0,4).map(h=>'<div class="history-row"><span class="history-icon '+esc(h.type||'other')+'">'+(h.type==='cook'?'⌁':'＋')+'</span><div><strong>'+esc(h.title)+'</strong><p>'+esc(h.detail||'')+' '+esc(h.date||'')+'</p></div></div>').join(''):'<div class="empty"><span class="empty-icon">◷</span><b>还没有记录</b><span>完成烹饪或采购入库后会显示在这里。</span></div>'}</section>
  <section class="profile-menu-card"><h2>历史</h2><button class="profile-menu-row" data-action="open-cooking-history"><span class="menu-icon warm">▤</span><span>烹饪历史</span><b>›</b></button><button class="profile-menu-row" data-action="open-consumption-review"><span class="menu-icon warm">▭</span><span>消耗复盘</span><b>›</b></button></section>
  <section class="profile-menu-card"><h2>设置</h2><button class="profile-menu-row" data-action="open-reminder-settings"><span class="menu-icon">⚙</span><span>提醒设置</span><b>›</b></button><button class="profile-menu-row" data-action="edit-preferences"><span class="menu-icon">▤</span><span>偏好记忆</span><b>›</b></button><button class="profile-menu-row" data-action="open-privacy-data"><span class="menu-icon">⚙</span><span>隐私与数据管理</span><b>›</b></button></section>`;
}
function render(){
  if(!state)return;
  headerContent();
  app.innerHTML=currentTab==='home'?homePage():currentTab==='recipes'?recipePage():currentTab==='inventory'?inventoryPage():currentTab==='shopping'?shoppingPage():profilePage();
  document.querySelectorAll('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.tab===currentTab));
  if(currentTab==='recipes'&&recipeSection==='discover'&&recipeScreen==='browse'&&!currentDetailId)queueRecipeImages(mealPlan.results);
}
function voiceInput(id,label,inputMarkup){
  return `<div class="voice-input-wrap">${inputMarkup}${voiceControls(id,label)}</div>`;
}

function showHelp(){
  modal(`<h2>关于菜谱功能</h2><p>发现页由服务端 DeepSeek AI 理解食材和做法需求并生成文字菜谱。模型不可用时会明确提示，不会用预设菜名搜索冒充生成结果。</p><p>当前未接入实时网页检索，因此“不限食材”显示为“AI创意灵感 · 未核验近期热度”，不会声称近期热门或提供虚构来源。</p><p>语音输入使用浏览器内置语音识别（支持情况因浏览器而异）；本应用不会上传或保存录音，浏览器语音服务可能按其自身规则处理音频。拒绝权限或不支持时仍可打字。</p><p>分享链接直接打开原平台。粘贴的正文可交由 DeepSeek 整理，截图可随草稿保存。菜品图片来自网络搜索，来源和授权需核对。库存、偏好、草稿和我的菜谱保存在本地 data.json，不支持跨设备同步。</p><p>选菜与开始制作不会扣库存，完成后确认实际消耗才更新。</p><div class="modal-actions"><button class="primary-button" data-action="close-modal">知道了</button></div>`);
}
function preferenceModal(){
  const p=state.preferences||{};
  const allergies=(p.allergies||[]).filter(item=>item!=='无').join('、');
  const avoid=(p.avoid||[]).filter(item=>item!=='无').join('、');
  modal(`<h2>个人偏好登记</h2>${hasConfirmedPreferences()?'<button type="button" class="secondary-button" data-action="use-personal">无修改，与个人登记一致</button>':'<p>首次确认一次过敏和饮食禁忌，之后每餐自动沿用。</p>'}<p class="meta">这里修改长期登记；只想改这顿，请使用发现页的“这顿调整一下”。</p><label>默认人数</label><select id="preference-servings">${[1,2,3,4,5,6,8,10,12].map(value=>`<option value="${value}" ${mealPlan.request.servings===value?'selected':''}>${value}人</option>`).join('')}</select><form id="preference-form"><label>过敏情况</label><select name="allergiesStatus" required><option value="">请选择</option><option value="none" ${p.allergiesStatus==='none'?'selected':''}>确认无过敏</option><option value="specified" ${p.allergiesStatus==='specified'?'selected':''}>有过敏食材</option></select><label>过敏食材（逗号分隔）</label><input name="allergies" value="${esc(allergies)}" placeholder="例如：花生、虾；无过敏请选上方“确认无过敏”"><label>饮食禁忌 / 忌口</label><select name="dietStatus" required><option value="">请选择</option><option value="none" ${p.dietStatus==='none'?'selected':''}>确认无禁忌或忌口</option><option value="specified" ${p.dietStatus==='specified'?'selected':''}>有禁忌或忌口</option></select><label>禁忌或忌口食材（逗号分隔）</label><input name="avoid" value="${esc(avoid)}" placeholder="例如：香菜；无忌口请选上方“确认无禁忌”"><label>限制厨具（逗号分隔）</label><input name="appliances" value="${esc((p.appliances||[]).filter(item=>item!=='无').join('、'))}" placeholder="例如：烤箱、空气炸锅"><label>口味偏好</label><input name="flavors" value="${esc((p.flavors||[]).join('、'))}" placeholder="例如：清淡、微辣"><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存偏好</button></div></form>`);
}
function mealPreferenceModal(){
  const p=preferences();
  modal(`<h2>这顿调整一下</h2><p>过敏和饮食禁忌继续保留。仅调整这顿，默认不覆盖个人登记。</p><form id="meal-preference-form"><label>这顿人数<select name="servings">${[1,2,3,4,5,6,8,10,12].map(n=>`<option ${mealPlan.request.servings===n?'selected':''}>${n}</option>`).join('')}</select></label><label>口味<input name="flavors" value="${esc((p.flavors||[]).join('、'))}"></label><label>不能使用的厨具<input name="appliances" value="${esc((p.appliances||[]).join('、'))}"></label><label class="confirm-choice"><input type="checkbox" name="savePersonal">同时保存为个人偏好</label><div class="modal-actions"><button type="button" class="secondary-button" data-action="use-personal">无修改，与个人登记一致</button><button class="primary-button" type="submit">应用这顿调整</button></div></form>`);
}
function inventoryModal(item){
  modal(`<h2>${item?'编辑食材':'添加库存'}</h2><form id="inventory-form" data-id="${esc(item?.id||'')}"><label>食材名称</label>${voiceInput('inventory-food-name','冰箱食材',`<input id="inventory-food-name" name="name" required value="${esc(item?.name||'')}">`)}<label>数量</label><input name="quantity" type="number" min="0" step="any" required value="${esc(item?.quantity??'')}"><label>单位</label><input name="unit" required value="${esc(item?.unit||'个')}"><label>储存位置</label><select name="location"><option ${item?.location==='冷藏'?'selected':''}>冷藏</option><option ${item?.location==='冷冻'?'selected':''}>冷冻</option></select><label>到期日（可选）</label><input name="expiryDate" type="date" value="${esc(item?.expiryDate||'')}"><label>状态</label><select name="freshness"><option ${item?.freshness==='新鲜'?'selected':''}>新鲜</option><option ${item?.freshness==='即将到期'?'selected':''}>即将到期</option><option ${item?.freshness==='状态存疑'?'selected':''}>状态存疑</option><option ${item?.freshness==='已确认不可食用'?'selected':''}>已确认不可食用</option></select><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存</button></div></form>`);
}
function cookingHistoryModal(){const cooks=(state.history||[]).filter(h=>h.type==='cook');const rows=cooks.length?cooks.map(h=>'<div class="history-row"><span class="history-icon cook">'+esc(h.imageEmoji||'⌁')+'</span><div><strong>'+esc(h.recipeTitle||h.title)+'</strong><p>'+esc(h.detail||'')+' · '+esc(h.date||'')+'</p></div></div>').join(''):'<div class="empty"><span class="empty-icon">◷</span><b>还没有烹饪记录</b><span>从菜谱点击开始制作并确认用量后，会显示在这里。</span></div>';modal('<h2>烹饪历史</h2><section class="modal-history">'+rows+'</section><div class="modal-actions"><button type="button" class="primary-button" data-action="close-modal">知道了</button></div>');}
function consumptionReviewModal(){const cooks=(state.history||[]).filter(h=>h.type==='cook');modal('<h2>消耗复盘</h2><div class="review-summary"><b>'+cooks.length+'</b><span>已完成烹饪</span></div><p class="meta">显示已完成的烹饪记录；库存以每次确认的记账结果为准。</p><div class="modal-actions"><button type="button" class="primary-button" data-action="close-modal">知道了</button></div>');}
function reminderSettingsModal(){const p=state.preferences;const row=(key,title,detail)=>'<div class="reminder-setting-row"><div><strong>'+title+'</strong><p>'+detail+'</p></div><input class="switch" aria-label="'+title+'" type="checkbox" '+(p[key]?'checked':'')+' data-action="toggle-reminder-setting" data-key="'+key+'"></div>';modal('<h2>提醒设置</h2><div class="reminder-settings-list">'+row('lowStockReminder','库存不足提醒','常用食材不足时，提醒你补货')+row('dailyMealReminder','今日做饭提醒','在设定的用餐时间提醒你查看库存')+row('reminder','临期食材提醒','优先提醒即将到期的食材')+'</div><div class="modal-actions"><button type="button" class="primary-button" data-action="close-modal">完成</button></div>');}
function privacyDataModal(){modal('<h2>隐私与数据管理</h2><p class="meta privacy-copy">你的偏好、库存和烹饪记录仅用于生成个性化的厨房建议。当前版本不提供家庭共享功能。</p><div class="modal-actions"><button type="button" class="primary-button" data-action="close-modal">知道了</button></div>');}

function shoppingModal(){
  modal(`<h2>新增采购食材</h2><form id="shopping-form"><label>食材名称</label>${voiceInput('shopping-food-name','采购食材',`<input id="shopping-food-name" name="name" required>`)}<label>数量</label><input name="quantity" type="number" min="0" step="any" required><label>单位</label><input name="unit" required value="个"><label>分类</label><select name="category"><option>蔬果</option><option>肉禽</option><option>水产</option><option>调味品</option><option>其他</option></select><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">加入清单</button></div></form>`);
}
function resetMealPrompt(){
  const active=activeMeal();
  if(!active){resetMeal();return;}
  modal(`<h2>重新安排一顿？</h2><p>当前方案“${esc(active.dishes.map(dish=>dish.recipe.title).join('、'))}”${active.status==='cooking'?'正在做饭':'等待消耗确认'}。重新安排会结束当前流程，但不会删除已经加入采购清单的项目。</p><div class="modal-actions"><button class="secondary-button" data-action="close-modal">继续当前方案</button><button class="primary-button" data-action="confirm-reset">结束并重新安排</button></div>`);
}
async function resetMeal(){
  mealPlan.active=null;
  mealPlan.menu=[];
  delete mealPlan.request.preferences;
  mealPlan.request.servings=state.preferences.defaultServings||2;
  mealPlan.request.dish='';
  mealPlan.request.explicitMeal='';
  mealPlan.intent=null;
  explicitMeal='';
  replaceMenuIndex=null;
  mealPlan.seenBySignature={};
  defaultMeal=mealForDate(new Date());
  mealPlan.roundMeal=defaultMeal;
  mealPlan.results=[];
  currentDetailId=null;
  await persist();
  closeModal();
  currentTab='recipes';
  await refreshRecommendations();
  toast(`已按当前时间重新安排${mealLabel()}`);
}
async function importShopping(items,source){
  for(const item of items){
    state.shopping.push({id:`shop-${Date.now()}-${Math.random().toString(16).slice(2)}`,name:item.name,quantity:item.quantity,unit:item.unit,category:item.category||'其他',source:`菜谱导入 · ${source}`,status:'pending',completedAt:''});
  }
  await persist();
  closeModal();
  returnToMeal=true;
  toast('已加入采购清单');
}
function recipeSourceUrl(value){
  const match=String(value||'').match(/https?:\/\/[^\s<>"'，。！？、）]+/i);
  if(!match)return null;
  try{
    const url=new URL(match[0].replace(/[).,;]+$/,''));
    return url.username||url.password?null:url;
  }catch{return null;}
}
function recipeSourcePlatform(url){
  if(/(^|\.)(xiaohongshu\.com|xhslink\.com)$/.test(url.hostname))return '小红书';
  if(/(^|\.)(douyin\.com|iesdouyin\.com)$/.test(url.hostname))return '抖音';
  if(/(^|\.)xiachufang\.com$/.test(url.hostname))return '下厨房';
  return '原平台';
}
function favoriteLinkForm(){
  return `<form id="recipe-link-form" class="favorite-link-form">
    <label for="favorite-link-title">菜名</label>
    <input name="title" id="favorite-link-title" maxlength="80" placeholder="输入这道菜的名称" required>
    <label for="recipe-share-link">菜谱分享链接</label>
    <input name="sourceUrl" id="recipe-share-link" placeholder="粘贴链接或分享文字" required>
    <label for="favorite-link-cover">封面图片</label>
    <input name="cover" id="favorite-link-cover" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
    <button class="secondary-button" type="button" data-action="generate-favorite-cover">按菜名生成 AI 封面</button>
    <img class="favorite-cover-preview" alt="封面预览" hidden>
    <p class="inline-error" aria-live="polite"></p>
    <div class="modal-actions">
      <button class="secondary-button" type="button" data-action="open-favorite-source">打开原平台</button>
      <button class="primary-button" type="submit">保存到我的收藏</button>
    </div>
  </form>`;
}
function openRecipeImport({linksOnly=false}={}){
  modal(`<div class="recipe-import-dialog">
    ${recipeBack(linksOnly?'返回我的收藏':'返回我的菜谱','close-modal')}<h2>${linksOnly?'导入菜谱链接':'导入菜谱'}</h2>
    ${favoriteLinkForm()}
    ${linksOnly?'':`<form id="recipe-import-form">
      <h3>保存正文或图片</h3>
      <label for="recipe-source-text">菜谱正文</label>
      <textarea name="sourceText" id="recipe-source-text" rows="4" placeholder="粘贴食材和做法"></textarea>
      <label for="recipe-source-images">菜谱图片或截图</label>
      <input name="images" id="recipe-source-images" type="file" accept="image/*" multiple>
      <p class="inline-error" id="import-error"></p>
      <button class="secondary-button" type="submit">保存为草稿</button>
    </form>`}
  </div>`);
}
function safeFavoriteCover(value){
  if(typeof value!=='string')return '';
  return /^\/api\/generated-images\/[0-9a-f]{64}\.jpg$/.test(value)||
    /^data:image\/(jpeg|png|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)?value:'';
}
async function saveFavoriteLink(form){
  const title=form.elements.title.value.trim();
  const url=recipeSourceUrl(form.elements.sourceUrl.value);
  const upload=form.elements.cover.files[0];
  if(!title||title.length>80)throw new Error('请输入菜名，最多 80 个字符。');
  if(!url)throw new Error('请粘贴有效的菜谱分享链接。');
  if(upload&&(!['image/jpeg','image/png','image/webp','image/gif'].includes(upload.type)||upload.size>4*1024*1024))
    throw new Error('请上传不超过 4 MB 的 JPG、PNG、WebP 或 GIF 图片。');
  const submit=form.querySelector('button[type="submit"]');
  if(submit.disabled)return;
  submit.disabled=true;
  let card;
  try{
    const imageUrl=safeFavoriteCover(upload?(await imageDataUrl(upload)).dataUrl:form.generatedCover);
    if(!imageUrl)throw new Error('请上传图片或先生成 AI 封面。');
    card={id:`link-${Date.now()}-${Math.random().toString(16).slice(2)}`,title,sourceUrl:url.href,imageUrl};
    state.favoriteLinks.unshift(card);
    await persist();
  }catch(error){
    if(card)state.favoriteLinks=state.favoriteLinks.filter(item=>item!==card);
    throw error;
  }finally{submit.disabled=false;}
  closeModal();recipeScreen='browse';recipeSection='favorites';currentDetailId=null;render();toast('已保存到我的收藏');
}
function imageDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve({name:file.name,dataUrl:String(reader.result),imageType:'user-upload',source:file.name});
    reader.onerror=()=>reject(new Error(`无法读取图片 ${file.name}`));
    reader.readAsDataURL(file);
  });
}
async function createImportDraft(form){
  const data=new FormData(form), sourceText=String(data.get('sourceText')||'').trim();
  const files=[...(form.elements.images.files||[])];
  if(!sourceText&&!files.length)throw new Error('请粘贴菜谱正文或上传图片。');
  if(files.length>5||files.some(file=>file.size>4*1024*1024)||files.reduce((sum,file)=>sum+file.size,0)>8*1024*1024)throw new Error('最多上传 5 张图片，每张不超过 4 MB，合计不超过 8 MB。');
  const platform=sourceText?'粘贴正文':'图片上传';
  const submit=form.querySelector('button[type="submit"]');
  if(submit){submit.disabled=true;submit.textContent='正在保存导入内容…';}
  const draft={id:`draft-${Date.now()}-${Math.random().toString(16).slice(2)}`,title:'',servings:2,ingredients:[],seasonings:[],steps:[],appliances:[],mealTypes:[],tags:[],duration:null,waitMinutes:0,sourceUrl:'',sourceText,platform,author:'',images:await Promise.all(files.map(imageDataUrl)),imageUrl:'',imageType:'',parseStatus:'pending',uncertainties:['菜名未解析','食材与用量未解析','制作步骤未解析','来源作者未核实'],createdAt:new Date().toISOString()};
  state.recipeDrafts.unshift(draft);await persist();
  if(sourceText){if(submit)submit.textContent='正在整理正文…';await parseDraftWithDeepSeek(draft);}
  closeModal();recipeEditorModal(draft.id,true);
}
async function parseDraftWithDeepSeek(draft){
  try{
    const parsed=await api('/api/recipe-import/parse',{method:'POST',body:JSON.stringify({sourceText:draft.sourceText})});
    for(const key of ['title','ingredients','auxiliaries','seasonings','steps','duration','servings','appliances']){
      const existing=draft[key];
      if((key==='servings'&&draft.parseStatus==='pending')||existing==null||existing===''||Array.isArray(existing)&&!existing.length){if(parsed[key]!=null)draft[key]=parsed[key];}
    }
    draft.uncertainties=[...new Set([...(parsed.uncertainties||[]),'AI提取内容请核对原文'])];
    draft.parseStatus='ai-extracted';draft.parseError='';
  }catch(error){draft.parseStatus='parse-failed';draft.parseError=error.message||'解析失败，请粘贴正文或手动填写。';}
  await persist();
}
function importDraftSummary(draft){
  if(draft.parseStatus==='ai-extracted')return 'DeepSeek 已依据来源文字提取，请核对食材、用量和步骤后保存。';
  if(draft.parseStatus==='parse-failed')return `未能自动解析：${draft.parseError||'请粘贴菜谱正文后重试。'} 原内容已保存在草稿。`;
  return '原文和图片已保存。可以整理正文或手动填写。';
}
function recipeEditorModal(id,isDraft=false){
  const recipe=isDraft?state.recipeDrafts.find(item=>item.id===id):state.recipes.find(item=>item.id===id);
  if(!recipe)return;
  const ingredientLine=item=>`${item.name}${item.quantity==null?(item.unit?` ${item.unit}`:''):` ${item.quantity} ${item.unit||''}`}`;
  const ingredients=(recipe.ingredients||[]).map(ingredientLine).join('\n');
  const auxiliaries=(recipe.auxiliaries||[]).map(ingredientLine).join('\n');
  const seasonings=(recipe.seasonings||[]).map(ingredientLine).join('\n');
  const steps=(recipe.steps||[]).map(step=>typeof step==='string'?step:step.text).join('\n');
  const imageOptions=(recipe.images||[]).map((image,index)=>`<option value="${index}" ${recipe.imageUrl===image.dataUrl?'selected':''}>${esc(image.name)}</option>`).join('');
  modal(`${recipeBack('返回','close-modal')}<h2>${isDraft?'编辑待核对草稿':'编辑我的菜谱'}</h2><p class="meta">${esc(isDraft?importDraftSummary(recipe):'用户保存的菜谱；来源元信息保持可编辑。')}</p><form id="recipe-editor-form" data-id="${esc(id)}" data-draft="${isDraft}"><label>菜名</label><input name="title" required value="${esc(recipe.title)}" placeholder="请核对并填写菜名"><label>参考人数</label><select name="servings"><option value="1" ${Number(recipe.servings)===1?'selected':''}>1人</option><option value="2" ${Number(recipe.servings||2)===2?'selected':''}>2人</option><option value="4" ${Number(recipe.servings)===4?'selected':''}>4人</option></select><label>主要食材与用量（每行：名称 数量 单位；适量可直接写“名称 适量”）</label><textarea name="ingredients" rows="5" placeholder="番茄 2 个&#10;鸡蛋 2 个">${esc(ingredients)}</textarea><label>辅料（每行一项）</label><textarea name="auxiliaries" rows="2" placeholder="清水 待确认">${esc(auxiliaries)}</textarea><label>调味料（每行一项）</label><textarea name="seasonings" rows="2" placeholder="食盐 适量">${esc(seasonings)}</textarea><label>制作步骤（每行一步）</label><textarea name="steps" rows="6" placeholder="请核对或补充步骤">${esc(steps)}</textarea><label>原文用时（未提供请留空，不会自动编造）</label><input name="duration" type="number" min="1" max="600" value="${esc(recipe.duration||'')}" placeholder="原文未提供"><label>厨具</label><input name="appliances" value="${esc((recipe.appliances||[]).join('、'))}" placeholder="例如：炒锅、灶台"><label>适用餐次（逗号分隔）</label><input name="mealTypes" value="${esc((recipe.mealTypes||[]).join('、'))}" placeholder="breakfast、lunch、dinner、snack"><label>标签</label><input name="tags" value="${esc((recipe.tags||[]).join('、'))}"><label>来源链接</label><input name="sourceUrl" type="url" value="${esc(recipe.sourceUrl||'')}"><label>来源平台／作者（可核实后填写）</label><div class="recipe-editor-grid"><input name="platform" value="${esc(recipe.platform||'')}" placeholder="平台"><input name="author" value="${esc(recipe.author||'')}" placeholder="作者"></div><label>原始分享文字（来源内容，不等于解析结果）</label><textarea name="sourceText" rows="4">${esc(recipe.sourceText||'')}</textarea>${imageOptions?`<label>使用导入图片作为封面</label><select name="coverImage"><option value="">不设封面</option>${imageOptions}</select>`:''}<p class="inline-error" id="editor-error"></p><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button>${isDraft?'<button type="button" class="secondary-button" data-action="parse-recipe-draft">整理正文</button><button type="button" class="secondary-button" data-action="save-recipe-draft">保存草稿</button>':''}<button class="primary-button" type="submit">${isDraft?'保存到我的菜谱':'保存修改'}</button></div></form>`);
}
function parseIngredientLines(value){
  return String(value||'').split(/\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
    const measured=line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(.*)$/);
    if(measured)return {name:measured[1].trim(),quantity:Number(measured[2]),unit:measured[3].trim(),quantityType:'user-entered'};
    const vague=line.match(/^(.+?)\s+(适量|少许|若干|待确认)$/);
    if(vague)return {name:vague[1].trim(),quantity:null,unit:vague[2],quantityType:'unknown'};
    return {name:line,quantity:null,unit:'',quantityType:'unknown'};
  });
}
function recipeEditorValues(form){
  const data=new FormData(form),old=recipeById(form.dataset.id)||state.recipeDrafts.find(item=>item.id===form.dataset.id)||{};
  const images=old.images||[];
  const coverIndex=String(data.get('coverImage')||'');
  const cover=coverIndex!==''?images[Number(coverIndex)]:null;
  const title=String(data.get('title')||'').trim();
  const preserve=(items,previous,category)=>items.map(item=>({...previous.find(oldItem=>oldItem.name===item.name),...item,category}));
  const ingredients=preserve(parseIngredientLines(data.get('ingredients')),old.ingredients||[],'main');
  const auxiliaries=preserve(parseIngredientLines(data.get('auxiliaries')),old.auxiliaries||[],'auxiliary');
  const seasonings=preserve(parseIngredientLines(data.get('seasonings')),old.seasonings||[],'seasoning');
  const steps=String(data.get('steps')||'').split(/\n/).map(text=>text.trim()).filter(Boolean);
  const sourceUrl=String(data.get('sourceUrl')||'').trim(),author=String(data.get('author')||'').trim();
  const uncertainties=[
    ...(old.uncertainties||[]).filter(item=>!['菜名未解析','食材与用量未解析','制作步骤未解析','用时待确认','来源作者未核实'].includes(item)),
    ...(!title?['菜名待确认']:[]),
    ...(!ingredients.length&&!auxiliaries.length?['食材待补充']:[]),
    ...[...ingredients,...auxiliaries,...seasonings].filter(item=>item.quantity==null).map(item=>`${item.name}用量待确认`),
    ...(!steps.length?['制作步骤待补充']:[]),
    ...(!data.get('duration')?['用时待确认']:[]),
    ...(!splitList(data.get('appliances')).length?['所需厨具待确认']:[]),
    ...(sourceUrl&&!author?['来源作者未核实']:[])
  ];
  return {...old,id:old.id||`user-${Date.now()}`,title:String(data.get('title')||'').trim(),subtitle:old.subtitle||'',servings:Number(data.get('servings')||2),
    ingredients,auxiliaries,seasonings,
    steps:steps.map((text,index)=>{
      const stepIngredients=[...ingredients,...auxiliaries,...seasonings].filter(item=>text.includes(item.name));
      stepIngredients.forEach(item=>{item.usedInSteps=item.usedInSteps||[];if(!item.usedInSteps.includes(`第${index+1}步`))item.usedInSteps.push(`第${index+1}步`);});
      return {title:`第 ${index+1} 步`,text,ingredients:stepIngredients.map(item=>`${item.name}${item.quantity==null?'':` ${item.quantity} ${item.unit||''}`}`),minutes:null,timeType:'unknown',completion:'',imageUrl:'',imageType:''};
    }),
    duration:data.get('duration')?Number(data.get('duration')):null,waitMinutes:old.waitMinutes||0,
    appliances:splitList(data.get('appliances')),mealTypes:splitList(data.get('mealTypes')),tags:splitList(data.get('tags')),
    sourceUrl,platform:String(data.get('platform')||'').trim(),author,sourceText:String(data.get('sourceText')||''),
    imageUrl:cover?.dataUrl||old.imageUrl||'',imageType:cover?'user-upload':old.imageType||'',imageSource:cover?.name||old.imageSource||'',imageCredit:cover?'用户上传':old.imageCredit||'',imageLicense:cover?'用户提供':old.imageLicense||'',
    parseStatus:old.parseStatus||'manual-entry',uncertainties:[...new Set(uncertainties)],
    isUserRecipe:true,reviewStatus:'user-reviewed',createdAt:old.createdAt||new Date().toISOString()};
}
async function saveRecipeEditor(form,publish){
  const recipe=recipeEditorValues(form);
  if(publish&&!recipe.title)throw new Error('请填写菜名。');
  if(publish){
    state.recipes=state.recipes.filter(item=>item.id!==recipe.id);
    state.recipes.unshift(recipe);
    state.recipeDrafts=state.recipeDrafts.filter(item=>item.id!==form.dataset.id);
  }else{
    const index=state.recipeDrafts.findIndex(item=>item.id===form.dataset.id);
    if(index>=0)state.recipeDrafts[index]={...state.recipeDrafts[index],...recipe};
  }
  await persist();closeModal();render();toast(publish?'已保存到我的菜谱':'草稿已保存；尚未确认为正式菜谱');
}
function safeStepText(step){return typeof step==='string'?step:step.text||'';}
function collectMenuAllocations(menu=mealPlan.menu){
  const available=new Map(state.inventory.map(item=>[item.id,safeInventory(item)&&Number.isFinite(Number(item.quantity))?Number(item.quantity):0]));
  const dishes=menu.map(entry=>{
    const recipe=recipeForView(recipeById(entry.recipeId),entry.servings);
    if(!recipe)return null;
    const sourceIngredients=[...(recipe.ingredients||[]),...(recipe.auxiliaries||[]),...(recipe.seasonings||[])];
    const ingredients=sourceIngredients.map(ingredient=>{
      let remaining=Number(ingredient.quantity)||0;const allocations=[];
      if(isTrackedRecipeIngredient(ingredient)&&ingredient.quantity!=null&&Number.isFinite(Number(ingredient.quantity))&&(ingredient.unit||'')){
        for(const stock of state.inventory.filter(item=>stockNameMatches(item.name,ingredient.name)&&safeInventory(item)&&stockUnitMatches(item.unit,ingredient.unit)).sort((a,b)=>(a.expiryDate||'9999').localeCompare(b.expiryDate||'9999'))){
          const quantity=Math.min(remaining,available.get(stock.id)||0);
          if(quantity>0){allocations.push({inventoryId:stock.id,name:ingredient.name,quantity,unit:ingredient.unit});remaining=Number((remaining-quantity).toFixed(2));available.set(stock.id,(available.get(stock.id)||0)-quantity);}
          if(remaining<=0)break;
        }
      }
      return {...ingredient,allocations};
    });
    return {recipe,ingredients,cooked:false};
  }).filter(Boolean);
  const timeline=dishCookingSteps(dishes);
  const estimatedMinutes=timeline.length&&timeline.every(step=>step.minutes!=null)
    ?timeline.reduce((total,step)=>total+step.minutes,0):null;
  return {dishes,timeline,estimatedMinutes};
}
function dishCookingSteps(dishes){
  const timeline=dishes.flatMap((dish,dishIndex)=>(dish.recipe.steps||[]).map((raw,index)=>{
    const step=typeof raw==='string'?{text:raw}:raw;
    const minutes=step.minutes!=null&&step.minutes!==''&&Number.isFinite(Number(step.minutes))?Number(step.minutes):null;
    return {
      id:`task-${dishIndex}-${index}`,dishIndex,
      title:step.title||`第 ${index+1} 步`,text:step.text,minutes,
      imageUrl:step.imageUrl||'',ingredients:step.ingredients||[],completion:step.completion||'',done:false
    };
  }));
  return timeline.map((step,index)=>({...step,index}));
}
function prepareDishCooking(active){
  if(Number.isInteger(active.dishIndex))return;
  const previous=active.timeline||[];
  active.timeline=dishCookingSteps(active.dishes).map(step=>({
    ...step,done:previous.some(old=>old.done&&(old.dishIndex??0)===step.dishIndex&&old.text===step.text)
  }));
  const next=active.dishes.findIndex(dish=>!dish.cooked&&!dish.skipped);
  active.dishIndex=next===-1?active.dishes.length:next;
  const steps=active.timeline.filter(step=>step.dishIndex===active.dishIndex);
  active.dishStarted=steps.some(step=>step.done);
  active.stepIndex=(steps.find(step=>!step.done)||steps.at(-1))?.index??0;
}
function editQueuedCookingMenu(active, menu){
  if(!active)return null;
  const updated=clone(active);
  prepareDishCooking(updated);
  const previousDishes=updated.dishes;
  const previousSteps=updated.timeline;
  const current=previousSteps.find(step=>step.index===updated.stepIndex);
  const currentOffset=previousSteps.filter(step=>step.dishIndex===updated.dishIndex).indexOf(current);
  const finished=previousDishes.slice(0,updated.dishIndex);
  const working=updated.dishStarted?previousDishes[updated.dishIndex]:null;
  const preserved=[...finished,...(working?[working]:[])];
  const lockedIds=new Set(preserved.map(dish=>dish.recipe.id));
  const queued=menu.filter(entry=>!lockedIds.has(entry.recipeId)).map(entry=>
    previousDishes.find(dish=>dish.recipe.id===entry.recipeId)||collectMenuAllocations([entry]).dishes[0]
  ).filter(Boolean);
  updated.dishes=[...preserved,...queued];
  if(!updated.dishes.length)return null;
  const stepsByDish=new Map(previousDishes.map((dish,index)=>[
    dish,previousSteps.filter(step=>step.dishIndex===index)
  ]));
  const offsets=new Map();
  updated.timeline=dishCookingSteps(updated.dishes).map(step=>{
    const dish=updated.dishes[step.dishIndex];
    const offset=offsets.get(dish)||0;
    offsets.set(dish,offset+1);
    return {...step,done:stepsByDish.get(dish)?.[offset]?.done||false};
  });
  if(updated.dishIndex>=updated.dishes.length){
    if(!finished.some(dish=>dish.cooked))return null;
    updated.status='awaiting_confirmation';
    ensureConsumptionDraft(updated);
  }else{
    const steps=updated.timeline.filter(step=>step.dishIndex===updated.dishIndex);
    updated.stepIndex=steps[working?Math.max(currentOffset,0):0]?.index??-1;
  }
  return updated;
}
async function changeMealMenu(recipeId, adding, {retry=true}={}){
  captureRecipeInput();
  const recipe=recipeById(recipeId);
  if(!recipe){toast('这道菜已更新，请重新选择');return;}
  const previousMenu=mealPlan.menu;
  const index=previousMenu.findIndex(entry=>entry.recipeId===recipeId);
  if(adding&&index!==-1){toast(`${recipe.title}已在本餐菜单`);return;}
  if(!adding&&index===-1){toast(`${recipe.title}已移出本餐`);return;}
  const active=activeMeal();
  if(active&&active.status!=='cooking'){toast('请先确认本餐食材用量，再调整菜单');return;}
  if(active){
    const flow=clone(active);
    prepareDishCooking(flow);
    const dishIndex=flow.dishes.findIndex(dish=>dish.recipe.id===recipeId);
    if(!adding&&dishIndex>=0&&(dishIndex<flow.dishIndex||dishIndex===flow.dishIndex&&flow.dishStarted)){
      toast(`${recipe.title}已开始或已做完，无法移出`);return;
    }
  }
  const nextMenu=[...previousMenu];
  const replacement=adding&&!active?nextMenu[replaceMenuIndex]:null;
  const previousReplaceIndex=replaceMenuIndex;
  if(adding){
    const blocked=[...(preferences().allergies||[]),...(preferences().avoid||[])].filter(item=>item&&item!=='无');
    const ingredients=[...(recipe.ingredients||[]),...(recipe.auxiliaries||[]),...(recipe.seasonings||[])];
    if(blocked.some(item=>ingredients.some(ingredient=>ingredient.name.includes(item)))){
      toast('这道菜包含已设置的过敏或忌口食材，不能加入本餐');return;
    }
    const entry={recipeId,servings:mealPlan.request.servings};
    if(replacement)nextMenu[replaceMenuIndex]=entry;
    else nextMenu.push(entry);
    replaceMenuIndex=null;
  }else{
    nextMenu.splice(index,1);
    if(replaceMenuIndex===index)replaceMenuIndex=null;
    else if(replaceMenuIndex!==null&&replaceMenuIndex>index)replaceMenuIndex--;
  }
  mealPlan.menu=nextMenu;
  if(active)mealPlan.active=editQueuedCookingMenu(active,nextMenu);
  render();
  try{
    await persist();
    toast(`${replacement?'已换成':adding?'已加入':'已移出'}「${recipe.title}」 · 本餐 ${nextMenu.length} 道`);
  }catch(error){
    mealPlan.menu=previousMenu;
    if(active)mealPlan.active=active;
    replaceMenuIndex=previousReplaceIndex;
    render();
    // Retry ordinary add/remove on the latest state when another tab saved first.
    if(retry&&!replacement&&/数据已被其他页面更新/.test(error.message)){
      const query=mealPlan.request.dish;
      state=await api('/api/state');
      ensurePlan();
      mealPlan.request.dish=query;
      render();
      return changeMealMenu(recipeId,adding,{retry:false});
    }
    throw error;
  }
}
function queueMealMenuChange(recipeId,adding){
  const edit=menuEditQueue.then(()=>changeMealMenu(recipeId,adding));
  menuEditQueue=edit.catch(()=>{});
  return edit;
}
function openMenuShopping({fromMenu=false}={}){
  const missing=menuShoppingCandidates();
  const rows=missing.map((item,index)=>{
    const amount=item.suggestedQuantity==null?'数量待确认':`${item.suggestedQuantity} ${item.unit}`;
    return `<div class="purchase-choice"><label class="missing-choice"><input type="checkbox" data-menu-buy="${index}" checked>
      <strong>${esc(item.name)}</strong><span>${esc(amount)}</span></label>
      <details><summary>修改采购量</summary><div class="shopping-quantity-row">
        <input aria-label="${esc(item.name)}购买数量" data-buy-quantity="${index}" type="number" min="0" step="any" value="${item.suggestedQuantity??''}" placeholder="数量">
        <input aria-label="${esc(item.name)}购买单位" data-buy-unit="${index}" value="${esc(item.unit==='适量'?'':item.unit||'')}" placeholder="单位">
      </div></details></div>`;
  }).join('');
  modal(`<h2>确认采购清单</h2><form id="menu-shopping-form" data-from-menu="${fromMenu}">${rows||'<p>没有待确认的采购食材。</p>'}
    <div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">${fromMenu?'暂不采购':'返回'}</button>
    ${rows?'<button class="primary-button" type="submit">加入采购清单</button>':''}</div></form>`);
  const form=document.getElementById('menu-shopping-form');
  if(form)form.purchaseCandidates=missing;
}
async function startCooking(){
  await menuEditQueue;
  await persistenceQueue.catch(()=>{});
  const latest=await api('/api/state');
  state=latest;mealPlan=state.mealPlan;
  if(activeMeal()){recipeScreen='cooking';render();if(activeMeal().status==='awaiting_confirmation')consumptionModal();return;}
  if(!mealPlan.menu.length){toast('请先加入一道或多道菜');return;}
  await beginMealCooking();
}
async function beginMealCooking(){
  const {dishes,timeline,estimatedMinutes:minutes}=collectMenuAllocations();
  mealPlan.active={id:`meal-${Date.now()}`,meal:plannedMeal(),status:'cooking',dishes,timeline,dishIndex:0,dishStarted:false,stepIndex:0,estimatedMinutes:minutes,servings:mealPlan.request.servings,operationId:`cook-${Date.now()}-${Math.random().toString(16).slice(2)}`,createdAt:new Date().toISOString()};
  try{await persist();}catch(error){mealPlan.active=null;throw error;}
  recipeScreen='cooking';currentTab='recipes';currentDetailId=null;render();
}
function cookingPage(){
  const active=activeMeal();
  if(!active)return mealMenuPage();
  if(active.status==='awaiting_confirmation')return `<div class="cooking-page">${recipeBack('返回本餐菜单','exit-cooking')}<h2>制作结束</h2><button class="primary-button full-button" data-action="finish-cooking">确认食材用量</button></div>`;
  prepareDishCooking(active);
  const dish=active.dishes[active.dishIndex];
  if(!dish)return `<div class="cooking-page">${recipeBack('返回本餐菜单','exit-cooking')}<h2>制作结束</h2><button class="primary-button full-button" data-action="finish-cooking">确认食材用量</button></div>`;
  const steps=active.timeline.filter(step=>step.dishIndex===active.dishIndex);
  const step=steps.find(item=>item.index===active.stepIndex);
  const position=steps.indexOf(step);
  const title=`<header class="cooking-header">${recipeBack('保存并返回菜单','exit-cooking')}
    <p class="dish-position">第 ${active.dishIndex+1} 道，共 ${active.dishes.length} 道</p><h2>${esc(dish.recipe.title)}</h2></header>`;
  if(!active.dishStarted)return `<div class="cooking-page">${title}
    <div class="dish-cook-actions"><button class="primary-button" data-action="start-dish">开始制作</button>
    <button class="secondary-button" data-action="skip-dish">放弃这道菜</button></div></div>`;
  return `<div class="cooking-page">${title}
    <button class="secondary-button" data-action="view-amounts">查看这道菜的食材</button>
    ${step?`<section class="current-cook-step"><div class="current-step-heading">
      <div><small>${position+1} / ${steps.length} 步</small><h3>${esc(step.title)}</h3></div></div>
      ${step.imageUrl?`<div class="step-image"><img src="${esc(step.imageUrl)}" alt="${esc(step.title)}"></div>`:''}
      <div class="flow-step-content"><p>${esc(step.text)}</p>${step.minutes!=null?`<p class="meta">${step.minutes} 分钟</p>`:''}
      ${step.completion?`<p class="meta">${esc(step.completion)}</p>`:''}</div>
    </section>`:'<p>这道菜没有记录具体步骤。</p>'}
    <div class="dish-cook-actions">${position>0?'<button class="secondary-button" data-action="previous-step">上一步</button>':''}
    <button class="primary-button" data-action="next-step">${step&&position<steps.length-1?'下一步':'完成这道菜'}</button></div>
  </div>`;
}
async function advanceCookingDish(active,{skipped=false}={}){
  const dish=active.dishes[active.dishIndex];
  if(!dish)return;
  dish.cooked=!skipped;
  dish.skipped=skipped;
  active.dishIndex++;
  active.dishStarted=false;
  if(active.dishIndex<active.dishes.length){
    await persist();
    render();
    return;
  }
  if(!active.dishes.some(item=>item.cooked)){
    mealPlan.active=null;
    recipeScreen='menu';
    await persist();
    render();
    toast('这次未制作任何菜品');
    return;
  }
  active.status='awaiting_confirmation';
  ensureConsumptionDraft(active);
  await persist();
  render();
  consumptionModal();
}
function ensureConsumptionDraft(active){
  if(active.consumptionDraft){const d=active.consumptionDraft;d.inventorySnapshot ||= clone(state.inventory);d.remainingQuantities ||= {};d.quantityModes ||= {};d.leftoverQuantities ||= {};d.leftoverAnswers ||= {};return d;}
  const cooked=active.dishes.filter(dish=>dish.cooked).map(dish=>dish.recipe.id);
  active.consumptionDraft={
    inventorySnapshot:clone(state.inventory),
    remainingQuantities:{},quantityModes:{},editKey:'',
    cookedDishIds:cooked.length||Number.isInteger(active.dishIndex)?cooked:active.dishes.filter(dish=>!dish.skipped).map(dish=>dish.recipe.id),
    sources:{},
    quantities:{},
    mixedQuantities:{},
    leftovers:{},
    leftoverQuantities:{},
    leftoverAnswers:{}
  };
  return active.consumptionDraft;
}
function unstockedPurchases(item){
  return state.shopping.filter(line=>line.status==='bought'&&stockNameMatches(line.name,item.name)&&
    stockUnitMatches(line.unit,item.unit)&&!state.inventory.some(stock=>stock.sourceShoppingId===line.id));
}
function consumptionItems(active){
  const draft=ensureConsumptionDraft(active);
  const cooked=new Set(draft.cookedDishIds);
  const grouped=new Map();
  for(const dish of active.dishes){
    if(!cooked.has(dish.recipe.id))continue;
    for(const ingredient of dish.ingredients||[]){
      if(!isTrackedRecipeIngredient(ingredient))continue;
      if(!ingredient.category){
        const recipe=dish.recipe;
        const isMain=(recipe.ingredients||[]).some(item=>item.name===ingredient.name);
        const isOther=[...(recipe.auxiliaries||[]),...(recipe.seasonings||[])].some(item=>item.name===ingredient.name);
        if(!isMain&&isOther)continue;
      }
      const key=`${ingredient.name}|${ingredient.unit||''}`;
      const item=grouped.get(key)||{key,name:ingredient.name,unit:ingredient.unit||'',quantity:0,quantityKnown:true,category:ingredient.category||'main',dishIds:[]};
      if(ingredient.quantity==null||ingredient.quantity===''||!Number.isFinite(Number(ingredient.quantity))||Number(ingredient.quantity)<=0)item.quantityKnown=false;
      else item.quantity=Number((item.quantity+Number(ingredient.quantity)).toFixed(3));
      if(!item.dishIds.includes(dish.recipe.id))item.dishIds.push(dish.recipe.id);
      grouped.set(key,item);
    }
  }
  return [...grouped.values()].map(item=>{
    const named=draft.inventorySnapshot.filter(stock=>stockNameMatches(stock.name,item.name));
    const compatible=named.filter(stock=>stockUnitMatches(stock.unit,item.unit));
    const stocks=compatible.filter(stock=>safeInventory(stock)&&Number.isFinite(Number(stock.quantity))&&Number(stock.quantity)>0);
    const available=stocks.reduce((sum,stock)=>sum+Number(stock.quantity),0);
    const ambiguous=named.some(stock=>!safeInventory(stock))||named.length>0&&compatible.length===0;
    const purchases=unstockedPurchases(item);
    const purchase=purchases.length===1?purchases[0]:null;
    const source=draft.sources[item.key]||(purchases.length?'unverified':stocks.length?'recorded':'uncertain');
    const hasPurchaseRecord=state.shopping.some(line=>line.status==='bought'&&stockNameMatches(line.name,item.name)&&
      !state.inventory.some(stock=>stock.sourceShoppingId===line.id));
    const canAddUnattributed=!named.length&&!hasPurchaseRecord&&!state.inventory.some(stock=>stockNameMatches(stock.name,item.name));
    return {...item,stocks,available,ambiguous,source,purchase,canAddUnattributed,multiplePurchases:purchases.length>1};
  });
}
function updateConsumptionDraftFromForm(){
  const active=activeMeal(),form=document.getElementById('consumption-form');
  if(!active||!form)return;
  const draft=ensureConsumptionDraft(active);
  if(form.querySelector('[data-cooked-dish]'))draft.cookedDishIds=[...form.querySelectorAll('[data-cooked-dish]:checked')].map(input=>input.dataset.cookedDish);
  for(const input of form.querySelectorAll('[data-remaining-quantity]'))draft.remainingQuantities[input.dataset.remainingQuantity]=input.value;
  for(const input of form.querySelectorAll('[data-consumption-source]')){
    const key=input.dataset.consumptionSource;
    if(input.value==='unverified')delete draft.sources[key];
    else draft.sources[key]=input.value;
  }
  for(const input of form.querySelectorAll('[data-consumption-quantity]'))draft.quantities[input.dataset.consumptionQuantity]=input.value;
  for(const input of form.querySelectorAll('[data-mixed-quantity]'))draft.mixedQuantities[input.dataset.mixedQuantity]=input.value;
  for(const input of form.querySelectorAll('[data-leftover-quantity]'))draft.leftoverQuantities[input.dataset.leftoverQuantity]=input.value;
}
function leftoverAnswer(draft,key){
  const saved=draft.leftoverAnswers?.[key];
  const quantity=draft.leftoverQuantities[key];
  return saved||(quantity==null||quantity===''?'':Number(quantity)>0?'some':'none');
}
function canStockLeftover(item){
  return Boolean(item.unit&&item.unit!=='适量'&&(item.source!=='uncertain'||item.canAddUnattributed));
}
function itemAccounting(item,draft){
  const {source}=item;
  const raw=draft.quantities[item.key];
  const actual=raw!==undefined&&raw!=='';
  const amount=actual?Number(raw):item.quantity;
  const mixed=draft.mixedQuantities[item.key];
  const oldUse=source==='mixed'?(mixed==null||mixed===''?NaN:Number(mixed)):amount;
  const remaining=draft.remainingQuantities[item.key];
  const calibration=draft.quantityModes[item.key]==='remaining'&&['recorded','mixed'].includes(source)&&item.stocks.length===1&&!item.ambiguous&&remaining!==undefined&&remaining!==''&&Number.isFinite(Number(remaining))&&Number(remaining)>=0;
  const deduct=draft.quantityModes[item.key]!=='remaining'&&['recorded','mixed'].includes(source)&&!item.ambiguous&&(item.quantityKnown||actual||source==='mixed')&&Number.isFinite(oldUse)&&oldUse>0&&oldUse<=item.available;
  const leftover=['new','mixed','uncertain'].includes(source)&&canStockLeftover(item)&&leftoverAnswer(draft,item.key)==='some'&&draft.leftovers[item.key]===true&&Number(draft.leftoverQuantities[item.key])>0;
  return {source,oldUse,calibration,deduct,leftover,basis:actual||source==='mixed'?'confirmed':'estimated'};
}
function consumptionRowStatus(item,draft){
  const a=itemAccounting(item,draft);
  if(a.source==='unverified')return '有已买未入库的记录';
  const leftoverQuantity=draft.leftoverQuantities[item.key];
  const remainingLabel=Number(leftoverQuantity)>0?`剩余 ${leftoverQuantity} ${item.unit}`:'有剩余';
  if(a.source==='uncertain'){
    if(a.leftover)return `剩余入库 ${draft.leftoverQuantities[item.key]} ${item.unit}`;
    const answer=leftoverAnswer(draft,item.key);
    if(answer==='none')return '已用完';
    if(answer==='some'&&(!canStockLeftover(item)||draft.leftovers[item.key]===false))return `${remainingLabel}，暂不入库`;
    return '';
  }
  const unit=item.unit;
  const changes=[];
  if(draft.quantities[item.key]!==undefined&&draft.quantities[item.key]!=='')changes.push(`实际用量 ${draft.quantities[item.key]} ${unit}`);
  if(a.calibration)changes.push(`冰箱实剩 ${draft.remainingQuantities[item.key]} ${unit}`);
  else if(a.deduct)changes.push(`冰箱扣减 ${a.oldUse} ${unit}`);
  else if(a.source==='recorded'||a.source==='mixed'){
    changes.push(a.source==='mixed'&&!draft.mixedQuantities[item.key]?'旧库存用量待确认':item.stocks.length?'冰箱暂不扣减':'没有可扣减的冰箱记录');
  }
  if(a.leftover)changes.push(`外购剩余入库 ${draft.leftoverQuantities[item.key]} ${unit}`);
  else if(a.source==='new'||a.source==='mixed'){
    const answer=leftoverAnswer(draft,item.key);
    if(answer==='none')changes.push('外购已用完');
    if(answer==='some'&&draft.leftovers[item.key]===false)changes.push(`外购${remainingLabel}，暂不入库`);
  }
  if((a.source==='new'||a.source==='mixed')&&item.multiplePurchases)changes.push('有多笔同名采购，需在采购清单分别核对');
  return changes.join(' · ');
}
function consumptionSourceControl(item){
  const options=[['recorded','冰箱'],['new','外购未入库'],['mixed','冰箱和外购'],['uncertain','来源不确定']];
  if(item.purchase||item.multiplePurchases)options.unshift(['unverified','请选择实际来源']);
  return `<label>来源<select data-consumption-source="${esc(item.key)}">${options.map(([value,label])=>`<option value="${value}" ${item.source===value?'selected':''}>${label}</option>`).join('')}</select></label>`;
}
function consumptionQuantityField(label,attribute,item,value,placeholder=''){
  return `<label>${label}${item.unit?`（${esc(item.unit)}）`:''}<input type="number" min="0" step="any" ${attribute}="${esc(item.key)}" value="${esc(value??'')}" placeholder="${placeholder}"></label>`;
}
function leftoverChoice(key,field,value,label,selected){
  return `<button type="button" class="secondary-button" data-action="meal-leftover-choice" data-key="${esc(key)}" data-field="${field}" data-value="${value}" aria-pressed="${selected}">${label}</button>`;
}
function consumptionLeftoverFields(item,draft){
  const {key}=item;
  const answer=leftoverAnswer(draft,key);
  const canStock=canStockLeftover(item);
  const external=['new','mixed'].includes(item.source)||item.source==='unverified';
  const add=draft.leftovers[key];
  return `<div class="meal-use-fields meal-use-external">
    <div class="meal-use-question" role="group" aria-label="${esc(item.name)}还有剩余吗">
      <span>${external?'外购还有剩余吗？':'还有剩余吗？'}</span>
      ${leftoverChoice(key,'remaining','none','没有',answer==='none')}
      ${leftoverChoice(key,'remaining','some','有剩余',answer==='some')}
    </div>
    ${answer==='some'?consumptionQuantityField(external?'外购剩余量':'实际剩余量','data-leftover-quantity',item,draft.leftoverQuantities[key],'填写实际剩余量'):''}
    ${answer==='some'&&canStock?`<div class="meal-use-question" role="group" aria-label="${esc(item.name)}的剩余食材是否入库">
      <span>剩下的要入库吗？</span>
      ${leftoverChoice(key,'stock','no','暂不入库',add===false)}
      ${leftoverChoice(key,'stock','yes','入库',add===true)}
    </div>`:''}
    ${answer==='some'&&!canStock?`<p class="meal-use-status">${item.unit&&item.unit!=='适量'?'已有同名库存或采购记录，可核对来源后再入库。':'单位待确认，可稍后在冰箱补记。'}</p>`:''}
  </div>`;
}
function consumptionRow(item,draft){
  const key=esc(item.key),open=draft.editKey===item.key;
  const external=['new','mixed'].includes(item.source);
  const mixed=item.source==='mixed';
  const suggestExternal=item.source==='unverified'&&item.purchase&&!item.stocks.length&&!item.ambiguous;
  const sourceLabel={recorded:'冰箱库存',new:'外购未入库',mixed:'冰箱库存 + 外购',unverified:suggestExternal?'外购待确认':'待确认（有采购记录）',uncertain:'待确认'}[item.source];
  const calibrating=draft.quantityModes[item.key]==='remaining';
  const amounts=calibrating&&item.source!=='new'
    ? consumptionQuantityField('旧库存实剩','data-remaining-quantity',item,draft.remainingQuantities[item.key])
    : `${consumptionQuantityField('本餐实际用量','data-consumption-quantity',item,draft.quantities[item.key],item.quantityKnown?`参考 ${item.quantity}`:'可留空')}${mixed?consumptionQuantityField('其中用了多少旧库存','data-mixed-quantity',item,draft.mixedQuantities[item.key],'不确定可留空'):''}`;
  return `<li class="meal-use-row">
    <div class="meal-use-heading"><div><strong>${esc(item.name)}</strong><span>${item.quantityKnown?`参考 ${item.quantity} ${esc(item.unit)}`:'参考用量待确认'}</span></div>
    <button type="button" class="secondary-button meal-use-edit" data-action="edit-consumption-row" data-key="${key}" aria-label="${open?'收起':'修改数量与来源'}：${esc(item.name)}" aria-expanded="${open||item.source==='unverified'&&!suggestExternal}">${open?'收起':'修改数量'}</button></div>
    <div class="meal-use-source">来源：${sourceLabel}</div>
    <p class="meal-use-status" data-consumption-status="${key}">${esc(consumptionRowStatus(item,draft))}</p>
    ${open||item.source==='unverified'&&!suggestExternal?`<div class="meal-use-fields">${consumptionSourceControl(item)}${open&&!['uncertain','unverified'].includes(item.source)?amounts:''}</div>`:''}
    ${external||suggestExternal||item.source==='uncertain'?consumptionLeftoverFields(item,draft):''}
  </li>`;
}
function consumptionSubmitLabel(items,draft){
  const updates=items.map(item=>itemAccounting(item,draft));
  const anyStockChange=updates.some(a=>a.deduct||a.calibration||a.leftover);
  if(!anyStockChange)return '确认本餐记录';
  const usesReference=updates.some(a=>a.deduct&&a.basis==='estimated');
  const usesActual=updates.some(a=>a.calibration||a.deduct&&a.basis==='confirmed');
  return usesReference&&!usesActual?'按参考用量确认':'确认用量并更新库存';
}
function updateConsumptionSummary(form){
  const active=activeMeal(),draft=ensureConsumptionDraft(active),items=consumptionItems(active);
  const byKey=new Map(items.map(item=>[item.key,item]));
  for(const row of form.querySelectorAll('[data-consumption-status]')){
    row.textContent=consumptionRowStatus(byKey.get(row.dataset.consumptionStatus),draft);
  }
  form.querySelector('[type="submit"]').textContent=consumptionSubmitLabel(items,draft);
}
function consumptionModal(){
  const active=activeMeal();if(!active)return;
  const draft=ensureConsumptionDraft(active),items=consumptionItems(active);
  const cooked=active.dishes.filter(dish=>draft.cookedDishIds.includes(dish.recipe.id));
  const dishes=active.dishes.filter(dish=>!dish.skipped);
  const canEditDishes=dishes.length>1;
  modal(`<h2>这顿做好了</h2><form id="consumption-form">
    <p class="meal-use-dishes">${esc(cooked.map(dish=>dish.recipe.title).join('、')||'还未选中已完成的菜')}</p>
    ${canEditDishes?`<details class="meal-use-dish-edit"${draft.editDishes?' open':''}><summary>调整完成的菜</summary>${dishes.map(dish=>`<label class="confirm-choice"><input type="checkbox" data-cooked-dish="${esc(dish.recipe.id)}" ${draft.cookedDishIds.includes(dish.recipe.id)?'checked':''}>${esc(dish.recipe.title)}</label>`).join('')}</details>`:''}
    <ul class="meal-use-list" aria-label="食材用量清单">${items.map(item=>consumptionRow(item,draft)).join('')}</ul>
    <div class="meal-use-actions"><p class="inline-error" id="consumption-error" role="alert"></p>
      <button class="primary-button full-button" type="submit">${consumptionSubmitLabel(items,draft)}</button>
      <button type="button" class="text-button full-button" data-action="later-consumption">稍后再记</button>
    </div>
  </form>`);
}
function redrawConsumption(focusSelector){
  const scrollTop=modalLayer.querySelector('.modal')?.scrollTop||0;
  consumptionModal();
  const dialog=modalLayer.querySelector('.modal');
  if(dialog)dialog.scrollTop=scrollTop;
  if(focusSelector)dialog?.querySelector(focusSelector)?.focus({preventScroll:true});
}
function completePage(){
  const result=mealPlan.lastCompleted;
  if(!result)return '<section class="card empty"><b>找不到本餐记录</b><button class="primary-button" data-action="recipe-discover">返回发现</button></section>';
  const counts=result.counts||{update:0,add:0,skip:0};
  const canUndo=!result.undone&&result.operationId&&(counts.update>0||counts.add>0||result.canUndoPurchase);
  const resultMessage=result.undone?'库存已恢复到确认前的状态。':counts.update||counts.add?result.basis==='reference'?'已按参考量估算更新，数量可能与实物不同。':'已按你的确认更新库存。':'这次没有改动库存。';
  return `<section class="card completion-card">${recipeBack('返回发现菜谱','recipe-discover')}<h2>${result.undone?'本次更新已撤销':'这一餐记好了。'}</h2><p>${resultMessage}</p><p>${esc(result.recipe?.title||'本餐')}</p><div class="completion-counts"><span>${result.basis==='reference'?'按参考量':'按确认用量'}更新${counts.update}项</span><span>补记${counts.add}项</span><span>另有${counts.skip}项保持不变</span></div><div class="completion-actions"><button class="secondary-button" data-tab-go="inventory">看看我的冰箱</button></div>${canUndo?`<button class="text-button full-button" data-action="undo-cook" data-operation="${esc(result.operationId)}">撤销本次记账</button>`:''}</section>`;
}
function confirmResetIfActive(){
  if(activeMeal())resetMealPrompt();
  else resetMeal();
}
function inventoryModalForAction(id){
  if(id)inventoryModal(state.inventory.find(item=>item.id===id));
  else inventoryModal(null);
}
async function ask(question){
  agentLoading=true;render();
  try{
    const result=await api('/api/agent',{method:'POST',body:JSON.stringify({question})});
    agentResult=result;
    toast('厨房管家的建议已生成');
  }catch(error){toast(error.message);}
  finally{agentLoading=false;render();}
}

document.addEventListener('change',event=>{
  const target=event.target;
  if(['servings-select','duration-select'].includes(target.id)){updateRequestFromControls();return;}
  if(target.id==='menu-servings'){
    mealPlan.request.servings=Number(target.value);
    mealPlan.menu=mealPlan.menu.map(entry=>({...entry,servings:mealPlan.request.servings}));
    persist().then(render).catch(error=>toast(error.message));return;
  }
  if(target.id==='favorite-link-cover'){
    const form=target.form;
    form.querySelector('.favorite-cover-preview').hidden=target.files.length>0||!form.generatedCover;
    return;
  }
  if(target.dataset.dishCooked){
    const active=activeMeal(),dish=active?.dishes.find(item=>item.recipe.id===target.dataset.dishCooked);
    if(dish){dish.cooked=target.checked;persist().catch(error=>toast(error.message));}
    return;
  }
  if(target.dataset.cookedDish||target.dataset.consumptionSource){
    const active=activeMeal();
    if(!active)return;
    updateConsumptionDraftFromForm();
    const draft=ensureConsumptionDraft(active);
    if(target.dataset.cookedDish){
      draft.editDishes=true;
      redrawConsumption(`[data-cooked-dish="${CSS.escape(target.dataset.cookedDish)}"]`);
    }else{
      const key=target.dataset.consumptionSource;
      if(target.value==='mixed')draft.editKey=key;
      redrawConsumption(draft.editKey===key?`[data-consumption-source="${CSS.escape(key)}"]`:`[data-action="edit-consumption-row"][data-key="${CSS.escape(key)}"]`);
    }
    return;
  }
});
document.addEventListener('input',event=>{
  const form=event.target.form;
  if(form?.id!=='consumption-form'||!activeMeal()||!event.target.matches('input[type="number"]'))return;
  updateConsumptionDraftFromForm();
  updateConsumptionSummary(form);
});
document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-action],[data-tab],[data-tab-go]');
  if(!target)return;
  const action=target.dataset.action;
  if(speechRecognition&&!['voice-stop','voice-cancel'].includes(action))stopSpeechRecognition(true);
  if(target.dataset.tab){currentTab=target.dataset.tab;returnTab=null;currentDetailId=null;render();return;}
  if(target.dataset.tabGo){currentTab=target.dataset.tabGo;returnTab=target.dataset.returnTab||null;currentDetailId=null;render();return;}
  try{
    if(action==='back-to-profile'){currentTab='profile';returnTab=null;currentDetailId=null;render();return;}
    if(action==='toggle-favorite'){
      const id=target.dataset.id;
      if(target.disabled||!recipeById(id))return;
      captureRecipeInput();
      const previous=state.favorites||[];
      const wasSaved=previous.includes(id);
      target.disabled=true;
      state.favorites=wasSaved?previous.filter(value=>value!==id):[...previous,id];
      target.setAttribute('aria-pressed',String(!wasSaved));
      target.title=wasSaved?'收藏菜谱':'取消收藏';
      target.querySelector('span').textContent=wasSaved?'♡':'♥';
      const label=target.querySelector('strong');
      if(label)label.textContent=wasSaved?'收藏菜谱':'已收藏';
      target.classList.toggle('just-favorited',!wasSaved);
      try{
        await persist();
      }catch(error){
        state.favorites=wasSaved?[...new Set([...state.favorites,id])]:state.favorites.filter(value=>value!==id);
        render();
        throw error;
      }finally{target.disabled=false;}
      if(wasSaved&&recipeSection==='favorites'&&!currentDetailId)render();
      toast(wasSaved?'已取消收藏':'已收藏到我的收藏');
      return;
    }
    if(action==='open-cooking-history'){cookingHistoryModal();return;}
    if(action==='open-consumption-review'){consumptionReviewModal();return;}
    if(action==='open-reminder-settings'){reminderSettingsModal();return;}
    if(action==='open-privacy-data'){privacyDataModal();return;}
    if(action==='toggle-reminder-setting'){state.preferences[target.dataset.key]=target.checked;await persist();toast(target.checked?'已开启提醒':'已关闭提醒');return;}
    if(action==='toggle-reminder'){state.preferences.reminder=target.checked;await persist();toast(target.checked?'已开启临期提醒':'已关闭临期提醒');return;}
    if(action==='generate-recipe-image'){queueRecipeImages([target.dataset.id],true);return;}
    if(action==='voice-start'){startSpeechRecognition(target.dataset.voiceTarget);return;}
    if(action==='voice-stop'){stopSpeechRecognition(false);setVoiceStatus('recognizing','正在识别…');return;}
    if(action==='voice-cancel'){stopSpeechRecognition(true);return;}
    if(action==='voice-append'||action==='voice-replace'){
      const input=document.getElementById(pendingSpeechTarget);
      if(input){
        input.value=action==='voice-append'?`${input.value.trim()}${input.value.trim()?'，':''}${pendingSpeechText}`:pendingSpeechText;
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.focus();
        speechTargetId=pendingSpeechTarget;
        setVoiceStatus('recognized','识别完成，可编辑后再提交。');
      }
      pendingSpeechText='';pendingSpeechTarget='';closeModal();return;
    }
    if(action==='cancel-recommendation'){
      if(recommendationController){
        const controller=recommendationController;
        recommendationController=null;
        recommendationGeneration++;
        recommendationLoading=false;
        controller.abort();
        recommendationNotice='本次生成已取消，原方案仍保留。';
        render();
      }
      return;
    }
    if(action==='recipe-section'){replaceMenuIndex=null;recipeSection=target.dataset.section;recipeScreen='browse';currentDetailId=null;render();return;}
    if(action==='open-meal-menu'){
      await menuEditQueue;
      if(recipeScreen!=='menu')menuReturn={section:recipeSection,detailId:currentDetailId,scroll:window.scrollY};
      replaceMenuIndex=null;recipeScreen='menu';currentDetailId=null;currentTab='recipes';render();
      if(!activeMeal()&&menuShoppingCandidates().length)openMenuShopping({fromMenu:true});
      return;
    }
    if(action==='back-to-recipes'){
      const previous=menuReturn;
      menuReturn=null;
      recipeSection=previous?.section||'discover';
      currentDetailId=previous?.detailId||null;
      recipeScreen='browse';
      render();
      window.scrollTo(0,previous?.scroll||0);
      return;
    }
    if(['add-menu-item','choose-meal','remove-menu-item'].includes(action)){
      await queueMealMenuChange(target.dataset.id,action!=='remove-menu-item');return;
    }
    if(action==='add-another-dish'){recipeScreen='browse';recipeSection='discover';currentDetailId=null;render();return;}
    if(action==='replace-menu-item'){if(activeMeal()){toast('制作中可以加菜，或移出尚未开始的菜');return;}replaceMenuIndex=Number(target.dataset.index);recipeScreen='browse';recipeSection='discover';render();toast('选择一道菜替换本餐中的菜品');return;}
    if(action==='clear-menu'){mealPlan.menu=[];await persist();recipeScreen='browse';render();return;}
    if(action==='menu-shopping'){openMenuShopping({fromMenu:recipeScreen==='menu'});return;}
    if(action==='shopping-from-menu'){if(!mealPlan.menu.length){recipeSection='discover';render();}else openMenuShopping();return;}
    if(action==='start-cooking'){if(target.disabled)return;target.disabled=true;try{await startCooking();}finally{target.disabled=false;}return;}
    if(action==='open-favorite-import'){openRecipeImport({linksOnly:true});return;}
    if(action==='open-favorite-source'){
      const form=target.closest('form');
      const url=recipeSourceUrl(form.elements.sourceUrl.value);
      if(!url){form.querySelector('.inline-error').textContent='请粘贴有效的菜谱分享链接。';return;}
      window.open(url.href,'_blank','noopener,noreferrer');return;
    }
    if(action==='generate-favorite-cover'){
      const form=target.closest('form');
      const title=form.elements.title.value.trim();
      const errorNode=form.querySelector('.inline-error');
      if(!title){errorNode.textContent='请先输入菜名。';form.elements.title.focus();return;}
      if(target.disabled)return;
      target.disabled=true;
      target.textContent='正在生成封面…';
      errorNode.textContent='';
      try{
        const result=await api('/api/favorite-cover',{method:'POST',body:JSON.stringify({title})});
        const imageUrl=safeFavoriteCover(result.imageUrl);
        if(!imageUrl)throw new Error('未收到封面图片，请重试。');
        form.generatedCover=imageUrl;
        form.elements.cover.value='';
        const preview=form.querySelector('.favorite-cover-preview');
        preview.src=imageUrl;
        preview.hidden=false;
      }catch(error){errorNode.textContent=error.message;}
      finally{target.disabled=false;target.textContent='按菜名生成 AI 封面';}
      return;
    }
    if(action==='remove-favorite-link'){
      const index=state.favoriteLinks.findIndex(item=>item.id===target.dataset.id);
      if(index<0||target.disabled)return;
      target.disabled=true;
      const [removed]=state.favoriteLinks.splice(index,1);
      try{await persist();}catch(error){state.favoriteLinks.splice(index,0,removed);target.disabled=false;throw error;}
      render();toast('已移除收藏');return;
    }
    if(action==='open-import'){openRecipeImport();return;}
    if(action==='edit-recipe-draft'){recipeEditorModal(target.dataset.id,true);return;}
    if(action==='edit-saved-recipe'){recipeEditorModal(target.dataset.id,false);return;}
    if(action==='parse-recipe-draft'){
      const form=document.getElementById('recipe-editor-form');
      const draft=state.recipeDrafts.find(item=>item.id===form?.dataset.id);
      if(!form||!draft)return;
      const current=recipeEditorValues(form);Object.assign(draft,current,{reviewStatus:'pending'});
      if(!draft.sourceText.trim()){toast('请先粘贴菜谱正文');return;}
      await persist();target.disabled=true;target.textContent='正在解析…';
      await parseDraftWithDeepSeek(draft);recipeEditorModal(draft.id,true);return;
    }
    if(action==='save-recipe-draft'){const form=document.getElementById('recipe-editor-form');if(form)await saveRecipeEditor(form,false);return;}
    if(action==='delete-saved-recipe'){
      modal(`<h2>删除这道菜谱？</h2><p>删除后不会影响已加入本餐的菜谱快照。</p><div class="modal-actions"><button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-delete-recipe" data-id="${esc(target.dataset.id)}">删除</button></div>`);return;
    }
    if(action==='confirm-delete-recipe'){state.recipes=state.recipes.filter(item=>item.id!==target.dataset.id);state.favorites=(state.favorites||[]).filter(id=>id!==target.dataset.id);mealPlan.menu=mealPlan.menu.filter(entry=>entry.recipeId!==target.dataset.id);await persist();closeModal();render();return;}
    if(action==='retry-recipe-image'){const image=target.parentElement.querySelector('img');if(image){target.parentElement.querySelector('.image-failed-label')?.remove();target.parentElement.classList.remove('image-failed');image.hidden=false;image.src=image.getAttribute('src');}return;}
    if(action==='show-help'){showHelp();return;}
    if(action==='close-modal'){closeModal();return;}
    if(action==='meal-preferences'){mealPreferenceModal();return;}
    if(action==='use-personal'){await usePersonalPreferences();return;}
    if(action==='meal-leftover-choice'){
      const active=activeMeal();
      if(!active)return;
      updateConsumptionDraftFromForm();
      const draft=ensureConsumptionDraft(active),{key,field,value}=target.dataset;
      if(field==='remaining'){
        const item=consumptionItems(active).find(item=>item.key===key);
        if(item?.source==='unverified')draft.sources[key]='new';
        draft.leftoverAnswers[key]=value;
        if(value==='none'){
          delete draft.leftovers[key];
          delete draft.leftoverQuantities[key];
        }
      }else draft.leftovers[key]=value==='yes';
      redrawConsumption(`[data-action="meal-leftover-choice"][data-key="${CSS.escape(key)}"][data-field="${field}"][data-value="${value}"]`);
      return;
    }
    if(action==='edit-consumption-row'){
      updateConsumptionDraftFromForm();
      const draft=ensureConsumptionDraft(activeMeal()),key=target.dataset.key;
      draft.editKey=draft.editKey===key?'':key;
      redrawConsumption(`[data-action="edit-consumption-row"][data-key="${CSS.escape(key)}"]`);
      return;
    }
    if(action==='edit-preferences'){captureRecipeInput();preferenceModal();return;}
    if(action==='meal-recommend'){currentTab='recipes';currentDetailId=null;mealPlan.request.dish='';explicitMeal='';defaultMeal=mealForDate(new Date());if(!activeMeal())mealPlan.roundMeal=defaultMeal;await refreshRecommendations();return;}
    if(action==='open-inventory'){inventoryModalForAction();return;}
    if(action==='edit-inventory'){inventoryModalForAction(target.dataset.id);return;}
    if(action==='inventory-location'){document.querySelectorAll('[data-action="inventory-location"]').forEach(button=>button.classList.toggle('active',button===target));document.getElementById('inventory-list').innerHTML=inventoryList(target.dataset.location);return;}
    if(action==='recipe-detail'){detailScrollPosition=window.scrollY;currentDetailId=target.dataset.id;currentTab='recipes';render();window.scrollTo(0,0);return;}
    if(action==='back-recipes'){currentDetailId=null;render();window.scrollTo(0,detailScrollPosition);return;}
    if(action==='select-meal'){await queueMealMenuChange(target.dataset.id,true);return;}
    if(action==='continue-cooking'){await menuEditQueue;recipeScreen='cooking';render();if(activeMeal()?.status==='awaiting_confirmation')consumptionModal();return;}
    if(['start-dish','skip-dish','previous-step','next-step'].includes(action)){
      const active=activeMeal();
      if(!active||active.status!=='cooking'||target.disabled)return;
      const controls=[...target.parentElement.querySelectorAll('button')];
      if(controls.some(button=>button.disabled))return;
      controls.forEach(button=>{button.disabled=true;});
      const previous=clone(active);
      try{
        prepareDishCooking(active);
        if(action==='skip-dish'){
          if(!active.dishStarted)await advanceCookingDish(active,{skipped:true});
          return;
        }
        const steps=active.timeline.filter(step=>step.dishIndex===active.dishIndex);
        if(action==='start-dish'){
          active.dishStarted=true;
          active.stepIndex=steps[0]?.index??-1;
        }else{
          const position=steps.findIndex(step=>step.index===active.stepIndex);
          if(action==='previous-step'){
            if(position>0)active.stepIndex=steps[position-1].index;
          }else{
            if(position>=0)steps[position].done=true;
            const next=position>=0?steps[position+1]:null;
            if(!next){await advanceCookingDish(active);return;}
            active.stepIndex=next.index;
          }
        }
        await persist();render();return;
      }catch(error){
        mealPlan.active=previous;
        recipeScreen='cooking';
        render();
        throw error;
      }finally{
        controls.forEach(button=>{button.disabled=false;});
      }
    }
    if(action==='finish-cooking'){
      const active=activeMeal();
      if(active?.status==='cooking'&&active.dishIndex>=active.dishes.length&&active.dishes.some(dish=>dish.cooked)){
        active.status='awaiting_confirmation';
        await persist();
        render();
      }
      if(active?.status==='awaiting_confirmation')consumptionModal();
      return;
    }
    if(action==='later-consumption'){const active=activeMeal();if(active){updateConsumptionDraftFromForm();active.status='awaiting_confirmation';await persist();closeModal();recipeScreen='browse';currentTab='recipes';render();toast('已保存待确认状态，库存未变');}return;}
    if(action==='exit-cooking'){await persist();recipeScreen='menu';currentTab='recipes';render();toast('制作进度已保存');return;}
    if(action==='view-amounts'){
      const active=activeMeal(),dish=active?.dishes[active.dishIndex];
      if(dish)modal(`<h2>${esc(dish.recipe.title)}的食材</h2>${dish.ingredients.map(item=>`<p>${esc(item.name)} · ${item.quantity==null?'用量待确认':`${item.quantity} ${esc(item.unit)}`}</p>`).join('')}<button class="primary-button full-button" data-action="close-modal">关闭</button>`);
      return;
    }
    if(action==='reset-meal'){confirmResetIfActive();return;}
    if(action==='confirm-reset'){await resetMeal();return;}
    if(action==='meal-mode'){captureRecipeInput();mealPlan.request.mode=target.dataset.mode;if(target.dataset.mode==='explore'&&!String(mealPlan.request.dish||'').trim()&&mealPlan.intent&&!mealPlan.intent.explicitlyEdited)mealPlan.intent.ingredients=[];await refreshRecommendations();if(mealPlan.menu.length)toast('本餐菜单已保留；采购建议可能需要重新核对');return;}
    if(action==='more-recipes'){captureRecipeInput();await refreshRecommendations({rotate:true});return;}
    if(action==='retry-recommendation'){await refreshRecommendations();return;}
    if(action==='focus-conditions'){document.getElementById('servings-select')?.focus();return;}
    if(action==='return-to-meal'){returnToMeal=false;currentTab='recipes';currentDetailId=null;render();return;}
    if(action==='shopping-tab'){shoppingTab=target.dataset.status;render();return;}
    if(action==='toggle-shopping'){const input=target;const item=state.shopping.find(entry=>entry.id===input.dataset.id);if(item){item.status=input.checked?'bought':'pending';item.completedAt=input.checked?today():'';await persist();render();}return;}
    if(action==='delete-shopping'){state.shopping=state.shopping.filter(item=>item.id!==target.dataset.id);await persist();render();return;}
    if(action==='add-shopping'){shoppingModal();return;}
    if(action==='edit-shopping-quantity'){const item=state.shopping.find(entry=>entry.id===target.dataset.id);if(!item)return;modal(`<h2>填写购买数量</h2><form id="edit-shopping-form" data-id="${esc(item.id)}"><p>${esc(item.name)}</p><label>数量</label><input name="quantity" type="number" min="0.001" step="any" value="${item.quantity==null?'':esc(item.quantity)}" required><label>单位</label><input name="unit" value="${esc(item.unit||'')}" required><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存</button></div></form>`);return;}
    if(action==='sync-shopping'){const bought=state.shopping.filter(item=>item.status==='bought');const ready=bought.filter(item=>item.quantity!=null&&item.quantity!==''&&Number.isFinite(Number(item.quantity))&&Number(item.quantity)>0&&item.unit&&item.unit!=='适量');if(!ready.length){toast('请先填写已买食材的数量和单位');return;}state=await api('/api/sync-shopping',{method:'POST',body:JSON.stringify({ids:ready.map(item=>item.id)})});mealPlan=state.mealPlan;render();toast(ready.length<bought.length?'已同步数量明确的食材，其余请补充数量和单位':'已同步入库');return;}
    if(action==='undo-cook'){const result=await api('/api/cook/undo',{method:'POST',body:JSON.stringify({operationId:target.dataset.operation})});state=result.state;mealPlan=state.mealPlan;mealPlan.lastCompleted={...(mealPlan.lastCompleted||{}),operationId:result.operation.id,undone:true,recipe:mealPlan.lastCompleted?.recipe||{title:result.operation.recipeTitle||'本餐',servings:result.operation.servings||1},counts:mealPlan.lastCompleted?.counts||result.operation.counts||{update:result.operation.consumption?.length||0,add:result.operation.additions?.length||0,skip:0}};await persist();recipeScreen='complete';currentTab='recipes';render();return;}
    if(action==='recipe-discover'){currentDetailId=null;recipeScreen='browse';recipeSection='discover';currentTab='recipes';render();return;}
    if(action==='import-shopping'){await importShopping(agentResult?.shopping||[],'厨房管家建议');return;}
  }catch(error){toast(error.message||'操作失败，请重试。');}
});
document.addEventListener('submit',async event=>{
  event.preventDefault();
  if(speechRecognition)stopSpeechRecognition(true);
  const form=event.target;
  try{
    if(form.id==='recipe-query'){
      mealPlan.request.dish=String(new FormData(form).get('dish')||'').trim();
      const servings=document.getElementById('servings-select')?.value;
      const duration=document.getElementById('duration-select')?.value;
      if(servings)mealPlan.request.servings=Number(servings);
      if(duration)mealPlan.request.duration=Number(duration);
      applyNaturalLanguageControls(mealPlan.request.dish);
      await refreshRecommendations();
      return;
    }
    if(form.id==='recipe-link-form'){await saveFavoriteLink(form);return;}
    if(form.id==='recipe-import-form'){await createImportDraft(form);return;}
    if(form.id==='recipe-editor-form'){await saveRecipeEditor(form,true);return;}
    if(form.id==='saved-recipe-search'){recipeSearch=String(new FormData(form).get('search')||'');render();return;}
    if(form.id==='inventory-search'){inventorySearch=String(new FormData(form).get('search')||'').trim();render();return;}
    if(form.id==='menu-shopping-form'){
      const missing=form.purchaseCandidates||menuShoppingCandidates();
      const selected=[...form.querySelectorAll('[data-menu-buy]:checked')].map(input=>{
        const index=input.dataset.menuBuy,item=missing[Number(index)];
        const raw=String(form.querySelector(`[data-buy-quantity="${index}"]`)?.value||'').trim();
        const quantity=raw===''?null:Number(raw);
        const unit=String(form.querySelector(`[data-buy-unit="${index}"]`)?.value||'').trim();
        if(quantity!==null&&(!Number.isFinite(quantity)||quantity<=0))throw new Error(`请填写${item.name}的大于零的数量，或留空待确认。`);
        return {...item,purchaseQuantity:quantity,purchaseUnit:unit};
      });
      if(!selected.length){closeModal();return;}
      const added=[];
      for(const item of selected){
        if(state.shopping.some(line=>stockNameMatches(line.name,item.name)&&line.status==='pending'))continue;
        added.push({id:`shop-${Date.now()}-${Math.random().toString(16).slice(2)}`,name:item.name,quantity:item.purchaseQuantity,unit:item.purchaseUnit,category:'其他',source:`本餐菜单 · ${item.stockGroup==='short'?'冰箱已有，预计补买':item.stockGroup==='unrecorded'?'冰箱未记录，待核对':'冰箱记录待核对'} · 参考数量`,mealId:mealPlan.active?.id||mealPlan.menuId||mealPlan.roundMeal,status:'pending',completedAt:''});
      }
      const submit=form.querySelector('button[type="submit"]');
      if(submit?.disabled)return;
      if(submit)submit.disabled=true;
      state.shopping.push(...added);
      try{await persist();}catch(error){
        state.shopping=state.shopping.filter(item=>!added.includes(item));
        throw error;
      }
      closeModal();shoppingTab='pending';
      if(form.dataset.fromMenu!=='true'){
        if(currentTab==='recipes'){recipeSection='shopping';recipeScreen='browse';returnToMeal=false;}
        else{returnToMeal=true;currentTab='shopping';}
      }
      render();toast('已加入采购清单');return;
    }
    if(form.id==='meal-preference-form'){
      const data=new FormData(form);const adjustment={flavors:splitList(data.get('flavors')),appliances:splitList(data.get('appliances'))};
      mealPlan.request.preferences=adjustment;mealPlan.request.servings=Number(data.get('servings'));
      mealPlan.results=[];mealPlan.summary='当餐偏好已调整，请按当前条件重新搭配。';
      if(data.has('savePersonal')){state.preferences={...state.preferences,...adjustment,defaultServings:mealPlan.request.servings};delete mealPlan.request.preferences;}
      await persist();closeModal();render();toast(data.has('savePersonal')?'已保存个人偏好':'已应用这顿调整');return;
    }
    if(form.id==='preference-form'){
      const data=new FormData(form);
      let allergiesStatus=String(data.get('allergiesStatus')||'');
      let dietStatus=String(data.get('dietStatus')||'');
      const allergies=splitList(data.get('allergies'));
      const avoid=splitList(data.get('avoid'));
      if(allergiesStatus==='specified'&&allergies.length===1&&allergies[0]==='无')allergiesStatus='none';
      if(dietStatus==='specified'&&avoid.length===1&&avoid[0]==='无')dietStatus='none';
      if(!allergiesStatus||!dietStatus)throw new Error('请明确确认过敏与饮食禁忌；无也请选“确认无”。');
      if(allergiesStatus==='specified'&&!allergies.length)throw new Error('请填写过敏食材，或明确选择无过敏。');
      if(dietStatus==='specified'&&!avoid.length)throw new Error('请填写忌口，或明确选择无禁忌。');
      state.preferences={...state.preferences,allergiesStatus,dietStatus,allergies:allergiesStatus==='none'?[]:allergies,avoid:dietStatus==='none'?[]:avoid,appliances:splitList(data.get('appliances')),flavors:splitList(data.get('flavors'))};
      const servings=document.getElementById('preference-servings')?.value;
      if(servings){mealPlan.request.servings=Number(servings);state.preferences.defaultServings=Number(servings);}
      closeModal();
      await persist();
      if(recipeSection==='discover')await refreshRecommendations();else render();
      toast('偏好已保存并更新推荐');
      return;
    }
    if(form.id==='consumption-form'){
      const active=activeMeal();
      if(!active)throw new Error('找不到进行中的做饭方案。');
      const submit=form.querySelector('button[type="submit"]');
      if(submit?.disabled)return;
      if(submit)submit.disabled=true;
      updateConsumptionDraftFromForm();
      const draft=ensureConsumptionDraft(active);
      if(!draft.cookedDishIds.length)throw new Error('请至少保留一道已完成的菜，或稍后再记。');
      const items=consumptionItems(active);
      const consumption=[];
      const calibrations=[];
      const additions=[];
      const externalConsumption=[],unattributedLeftovers=[];
      let updatedItems=0,addedItems=0,skippedItems=0;
      for(const item of items){
        const accounting=itemAccounting(item,draft),{source,oldUse}=accounting;
        const isExternal=source==='new'||source==='mixed';
        if(source==='unverified')throw new Error(`请确认${item.name}的来源，或选「来源不确定」。`);
        if(source==='recorded'&&item.stocks.length&&draft.quantityModes[item.key]!=='remaining'&&draft.quantities[item.key]!==undefined&&draft.quantities[item.key]!==''&&oldUse>item.available){
          throw new Error(`${item.name}填写的用量超过可用库存，请修改数量或来源。`);
        }
        const answer=leftoverAnswer(draft,item.key);
        if(isExternal||source==='uncertain'&&answer){
          const canStock=canStockLeftover(item);
          const addToStock=canStock&&draft.leftovers[item.key]===true;
          if(!answer)throw new Error(`请确认${item.name}还有没有外购剩余。`);
          if(answer==='some'&&canStock&&draft.leftovers[item.key]===undefined){
            throw new Error(`请选择${item.name}的剩余是否入库。`);
          }
          const rawRemaining=draft.leftoverQuantities[item.key];
          const remaining=answer==='none'?0:rawRemaining==null||rawRemaining===''?null:Number(rawRemaining);
          if(answer==='some'&&(addToStock||remaining!==null)&&(!Number.isFinite(remaining)||remaining<=0)){
            throw new Error(`请填写${item.name}的实际剩余量。`);
          }
          if(source==='uncertain'){
            unattributedLeftovers.push({name:item.name,unit:item.unit,remaining,hasRemaining:answer==='some'});
          }else{
            const rawTotal=draft.quantities[item.key];
            const hasActual=rawTotal!=null&&rawTotal!=='';
            const total=hasActual?Number(rawTotal):item.quantityKnown?item.quantity:null;
            const oldAmount=source==='new'?0:accounting.calibration?Number((Number(item.stocks[0].quantity)-Number(draft.remainingQuantities[item.key])).toFixed(3)):oldUse;
            if(source==='mixed'&&(!Number.isFinite(oldAmount)||oldAmount<0||oldAmount>0&&!accounting.deduct&&!accounting.calibration)){
              throw new Error(`请核对${item.name}用了多少旧库存，或选「来源不确定」。`);
            }
            if(total!==null&&(!Number.isFinite(total)||total<oldAmount)){
              throw new Error(`${item.name}的总用量不能少于旧库存用量，请点「修改」核对。`);
            }
            externalConsumption.push({name:item.name,unit:item.unit,
              quantity:total===null?null:Number((total-oldAmount).toFixed(3)),
              basis:total===null?'unknown':hasActual?'confirmed':'estimated',
              remaining,hasRemaining:answer==='some',purchaseId:item.purchase?.id||'',expectedPurchase:item.purchase});
          }
        }
        if(accounting.calibration){const stock=item.stocks[0];calibrations.push({inventoryId:stock.id,remaining:Number(draft.remainingQuantities[item.key]),expectedItem:stock});updatedItems++;}
        if(accounting.deduct){
          const stocks=[...item.stocks].sort((a,b)=>(a.expiryDate||'9999').localeCompare(b.expiryDate||'9999'));
          let remainingUse=oldUse;
          for(const stock of stocks){
            if(remainingUse<=0)break;
            const quantity=Math.min(remainingUse,Number(stock.quantity));
            if(quantity>0)consumption.push({inventoryId:stock.id,quantity,expectedQuantity:Number(stock.quantity),expectedItem:stock,basis:accounting.basis});
            remainingUse=Number((remainingUse-quantity).toFixed(4));
          }
          if(remainingUse>0.0001)throw new Error(`${item.name}的库存刚刚发生变化，请重新核对后再确认。`);
          updatedItems++;
        }
        if(accounting.leftover){
          const quantity=Number(draft.leftoverQuantities[item.key]);
          const purchase=isExternal?item.purchase:null;
          additions.push({id:`inv-${Date.now()}-${addedItems}`,name:item.name,quantity,unit:item.unit,location:'冷藏',freshness:'新鲜',expiryDate:'',createdAt:today(),quantityBasis:'confirmed',quantityBasisUpdatedAt:new Date().toISOString(),origin:source==='uncertain'?'meal-leftover':'new-purchase',mealId:active.id,sourceShoppingId:purchase?.id||''});
          addedItems++;
        }
      }
      const recipeTitle=active.dishes.filter(dish=>draft.cookedDishIds.includes(dish.recipe.id)).map(dish=>dish.recipe.title).join(' + ')||'本餐';
      skippedItems=Math.max(0,items.length-updatedItems);
      const counts={update:updatedItems,add:addedItems,skip:skippedItems};
      await persistenceQueue.catch(()=>{});
      const result=await api('/api/cook',{method:'POST',body:JSON.stringify({
        operationId:active.operationId,
        recipe:{title:recipeTitle,servings:active.servings},
        consumption,calibrations,additions,externalConsumption,unattributedLeftovers,counts
      })});
      state=result.state;mealPlan=state.mealPlan;
      // The server commits inventory, completion and menu state in one transaction.
      if(!mealPlan.lastCompleted)throw new Error('服务返回格式不完整，请刷新查看本餐记录。');
      closeModal();recipeScreen='complete';currentTab='recipes';render();return;
    }
    if(form.id==='inventory-form'){
      const data=new FormData(form),id=form.dataset.id||`inv-${Date.now()}`;
      const item={id,name:String(data.get('name')).trim(),quantity:Number(data.get('quantity')),unit:String(data.get('unit')).trim(),location:String(data.get('location')),freshness:String(data.get('freshness')),expiryDate:String(data.get('expiryDate')||''),createdAt:today(),quantityBasis:'confirmed',quantityBasisUpdatedAt:new Date().toISOString(),lastConfirmedAt:new Date().toISOString(),lastConfirmedQuantity:Number(data.get('quantity'))};
      const current=state.inventory.find(entry=>entry.id===id);
      if(current)Object.assign(current,item);else state.inventory.push(item);
      await persist();closeModal();render();toast('库存已保存');return;
    }
    if(form.id==='edit-shopping-form'){
      const item=state.shopping.find(entry=>entry.id===form.dataset.id),data=new FormData(form),quantity=Number(data.get('quantity')),unit=String(data.get('unit')||'').trim();
      if(!item||!Number.isFinite(quantity)||quantity<=0||!unit||unit==='适量')throw new Error('请填写大于零的数量和明确单位。');
      item.quantity=quantity;item.unit=unit;await persist();closeModal();render();toast('采购数量已保存');return;
    }
    if(form.id==='shopping-form'){
      const data=new FormData(form);
      state.shopping.push({id:`shop-${Date.now()}`,name:String(data.get('name')).trim(),quantity:Number(data.get('quantity')),unit:String(data.get('unit')).trim(),category:String(data.get('category')),source:'手动新增',status:'pending',completedAt:''});
      await persist();closeModal();render();toast('已加入采购清单');return;
    }
    if(form.id==='ask-form'){
      const question=document.getElementById('agent-question').value.trim();
      if(question)await ask(question);
      return;
    }
  }catch(error){
    const submit=form.querySelector('button[type="submit"]');
    if(submit)submit.disabled=false;
    const message=error.message||'操作失败，请重试。';
    const errorNode=form.querySelector('.inline-error');
    if(errorNode)errorNode.textContent=message;
    else toast(message);
  }
});

window.addEventListener('pagehide',()=>stopSpeechRecognition(true));
loadState().then(()=>window.recipeFrameReady?.()).catch(error=>{app.innerHTML=`<section class="card empty"><b>无法启动厨房管家</b><span>${esc(error.message)}</span></section>`;});
