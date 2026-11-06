const app = document.getElementById('app');
const header = document.getElementById('app-header');
const modalLayer = document.getElementById('modal-layer');
const toastNode = document.getElementById('toast');
let state = null;
let currentTab = 'home';
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
let returnToMeal = false;
let recipeSection = 'discover';
let recipeScreen = 'browse';
let recipeSearch = '';
let recipeTagFilter = '';
let recipeSourceFilter = '';
let inventorySearch = '';
let pendingRecipeAction = '';
let replaceMenuIndex = null;
let defaultMeal = mealForDate(new Date());
let explicitMeal = '';
let mealPlan = null;
let recommendationError = '';
let recommendationNotice = '';
let menuAdjustmentNotice = false;
let recommendationController = null;
let recommendationGeneration = 0;
let speechRecognition = null;
let speechTargetId = '';
let speechStatus = 'idle';
let pendingSpeechText = '';
let pendingSpeechTarget = '';

const MEALS = {
  breakfast:{label:'早餐',title:'早餐吃什么',homeAction:'帮我安排早餐'},
  lunch:{label:'午餐',title:'午餐吃什么',homeAction:'帮我安排午餐'},
  dinner:{label:'晚餐',title:'今晚吃什么',homeAction:'帮我安排晚饭'},
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
function effectiveMeal(){return activeMeal()?.meal||explicitMeal||mealPlan?.roundMeal||defaultMeal;}
function mealLabel(id=effectiveMeal()){return MEALS[id]?.label||MEALS.dinner.label;}
function mealTitle(id=effectiveMeal()){return MEALS[id]?.title||MEALS.dinner.title;}
function safeInventory(item){
  return !['不可食用','已确认不可食用','丢弃','变质','状态存疑','待确认'].includes(item.status)&&
    !['不可食用','已确认不可食用','变质','状态存疑','待确认'].includes(item.freshness);
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
  if(!hasConfirmedPreferences()){preferenceModal();return;}
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
  mealPlan.results=mealPlan.results.filter(id=>{const recipe=[...recipeLibrary,...state.recipes,...mealPlan.aiRecipes].find(item=>item.id===id);return !recipe||recipe.recommendationSource!=='AI'||isSingleDish(recipe);});
  explicitMeal=mealPlan.request.explicitMeal||mealFromText(mealPlan.request.dish);
  if(!activeMeal()&&!mealPlan.menu.length&&!explicitMeal&&mealPlan.resultMeal!==defaultMeal)mealPlan.roundMeal=defaultMeal;
}
async function api(url,options={}){
  let response;
  try{response=await fetch(url,{headers:{'Content-Type':'application/json'},...options});}
  catch(error){if(error?.name==='AbortError')throw error;throw new Error('无法连接本地预览服务，请确认 4570 服务正在运行后重试。');}
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
  render();
  if(!state.mealPlan)await persist();
  if(!activeMeal()&&!mealPlan.menu.length&&(!mealPlan.results.length||mealPlan.recommendationProvider!=='ai'))await refreshRecommendations();
}
function toast(message){toastNode.textContent=message;toastNode.classList.add('show');setTimeout(()=>toastNode.classList.remove('show'),2800);}
function modal(content){modalLayer.hidden=false;modalLayer.innerHTML=`<div class="modal" role="dialog" aria-modal="true">${content}</div>`;}
function closeModal(){modalLayer.hidden=true;modalLayer.innerHTML='';}
function headerContent(){
  const title=currentTab==='recipes'?mealTitle(activeMeal()?.meal||effectiveMeal()):({home:'食光管家',inventory:'我的冰箱',shopping:'采购清单',profile:'我的'}[currentTab]||'食光管家');
  const sub=currentTab==='recipes'?'按餐次和库存安排一顿':({home:'今天，先吃掉家里的好食材',inventory:'食材台账',shopping:'按需补购',profile:'偏好与饮食记录'}[currentTab]||'');
  header.innerHTML=`<div class="topline"><div><p class="eyebrow">${esc(sub)}</p><h1>${esc(title)}</h1></div>${currentTab==='recipes'&&returnTab==='profile'?'<button class="header-back-action" data-action="back-to-profile">‹ 返回我的</button>':'<button class="header-action help-action" data-action="show-help" aria-label="帮助">?</button>'}</div>`;
}
function allRecipes(){return [...recipeLibrary,...state.recipes,...mealPlan.aiRecipes];}
function recipeById(id){return allRecipes().find(recipe=>recipe.id===id)||null;}
function effectiveRequestDish(){return cleanDishText(mealPlan.request.dish);}
function inventoryMatches(ingredient){
  return state.inventory.filter(item=>item.name===ingredient.name&&(item.unit||'')===(ingredient.unit||'')&&safeInventory(item)&&Number.isFinite(Number(item.quantity))&&Number(item.quantity)>0);
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
  // 调味料单独提醒：不视作已拥有，也不因未登记而排除主要食材齐备的菜。
  return [...(recipe.ingredients||[]),...(recipe.auxiliaries||[])].filter(item=>!item.optional&&!/^(水|清水)$/.test(item.name||'')&&!isSeasoning(item));
}
function sourceCoverage(item){
  const available=state.inventory.filter(stock=>stock.name===item.name&&safeInventory(stock)&&stock.quantity!=null&&stock.quantity!==''&&Number.isFinite(Number(stock.quantity))&&Number(stock.quantity)>0);
  const amountKnown=item.quantity!=null&&item.quantity!==''&&Number.isFinite(Number(item.quantity))&&Number(item.quantity)>0;
  if(!amountKnown)return {hasStock:available.length>0,needsPurchase:available.length===0,uncertain:available.length>0};
  const compatible=available.filter(stock=>item.unit&&(stock.unit||'')===item.unit);
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
      const additional=view.ingredients.filter(item=>!isSeasoning(item)&&!/^(清水|水)$/.test(item.name));
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
      return item&&(item.freshness==='即将到期'||(item.expiryDate&&item.expiryDate<=today()));
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
  if(typedMeal&&!activeMeal())mealPlan.roundMeal=typedMeal;
  if(!mealPlan.roundMeal)mealPlan.roundMeal=mealForDate(new Date());
  return effectiveMeal();
}
function recommendationSignature(meal){
  const p=preferences();
  return JSON.stringify([meal,effectiveRequestDish(),mealPlan.request.servings,mealPlan.request.duration,mealPlan.request.mode,
    p.allergiesStatus,p.allergies,p.dietStatus,p.avoid,p.appliances,recipeSection]);
}
async function refreshRecommendations({rotate=false}={}){
  if(!hasConfirmedPreferences()){preferenceModal();return;}
  if(recommendationController)recommendationController.abort();
  const controller=new AbortController();
  recommendationController=controller;
  const generation=++recommendationGeneration;
  const previousResults=[...mealPlan.results];
  const meal=recommendationMeal();
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
  if(typedMeal)mealPlan.roundMeal=typedMeal;
  else if(!activeMeal())mealPlan.roundMeal=defaultMeal=mealForDate(new Date());
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
  const ingredients=[...(recipe.ingredients||[]),...(recipe.auxiliaries||[]),...(recipe.seasonings||[])];
  const recorded=ingredients.filter(item=>inventoryMatches(item).length);
  const unknown=ingredients.filter(item=>item.quantity==null||!inventoryMatches(item).length);
  const unsafe=ingredients.some(ingredient=>state.inventory.some(item=>item.name===ingredient.name&&!safeInventory(item)));
  const expiring=ingredients.some(item=>item.allocations.some(allocation=>{
    const stock=state.inventory.find(entry=>entry.id===allocation.inventoryId);
    return stock&&(stock.freshness==='即将到期'||(stock.expiryDate&&stock.expiryDate<=today()));
  }));
  const status=unsafe?'有食材已标记状态存疑或不可食用，未用于匹配':!recorded.length?'冰箱暂无可用记录，食材待确认':unknown.length?'主要食材已有记录，未记录食材待确认':recipe.ingredients.every(item=>item.covered>=item.quantity)?'主要食材库存记录充足':'主要食材已有记录，数量待确认';
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

function recipeCard(id){
  const recipe=recipeForView(recipeById(id));
  if(!recipe)return '';
  const selected=mealPlan.menu.some(entry=>entry.recipeId===id);
  const stock=stockSummary(recipe);
  const totalTime=Number(recipe.duration||0)+Number(recipe.waitMinutes||0);
  const time=recipe.duration?`${totalTime}分钟${Number(recipe.waitMinutes)>0?`（含等待${recipe.waitMinutes}分）`:''}`:'用时待确认';
  const expiringItems=requiredFoodSources(recipe).filter(item=>item.allocations?.some(allocation=>{const stockItem=state.inventory.find(entry=>entry.id===allocation.inventoryId);return stockItem&&(stockItem.freshness==='即将到期'||(stockItem.expiryDate&&stockItem.expiryDate<=today()));})).map(item=>item.name);
  const reason=stock.expiring?`建议优先食用：${[...new Set(expiringItems)].join('、')}`:recipe.reason||'按餐次与偏好筛选';
  const ingredients=[...recipe.ingredients,...(recipe.auxiliaries||[]),...(recipe.seasonings||[])];
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
    const seasoningItems=[...(recipe.ingredients||[]),...(recipe.auxiliaries||[]),...(recipe.seasonings||[])].filter(item=>isSeasoning(item));
    const seasoningNames=[...new Set(seasoningItems.map(item=>`${item.name}${item.optional?'（可选）':''}`))];
    const seasoningText=seasoningNames.length?`调味料：${seasoningNames.join('、')} · 请自行核对`:'调味料：菜谱未列出，请查看做法';
    const fallbackReason=mealPlan.request.mode==='use-first'?'优先使用冰箱已有食材。':mealPlan.request.mode==='supplement'?'搭配冰箱食材，另需补购部分食材。':'换一种口味，探索新的做法。';
    const fullReason=String(recipe.reason||fallbackReason).trim();
    const shortReason=fullReason.length>72?`${fullReason.slice(0,72)}…`:fullReason;
    return `<article class="meal-card ${selected?'is-selected':''}">${imageMarkup(recipe)}<div class="meal-card-content"><div class="meal-card-heading"><h3>${esc(recipe.title)}</h3>${selected?'<span class="selected-badge">已加入</span>':''}</div><div class="meal-card-meta"><span>${esc(time)}</span><span>${esc(recipe.servings||mealPlan.request.servings)}人份</span></div>${tags}<p class="recipe-card-reason">${esc(shortReason)}</p><p class="recipe-card-seasonings">${esc(seasoningText)}</p>${freshness}<div class="meal-card-actions"><button class="secondary-button" data-action="recipe-detail" data-id="${esc(id)}">查看做法</button><button class="${selected?'secondary-button':'primary-button'}" data-action="${selected?'remove-menu-item':'choose-meal'}" data-id="${esc(id)}">${selected?'移出本餐':'加入本餐'}</button></div>${recipe.isUserRecipe?`<div class="saved-recipe-actions"><button class="text-button" data-action="edit-saved-recipe" data-id="${esc(id)}">编辑</button><button class="text-button danger-text" data-action="delete-saved-recipe" data-id="${esc(id)}">删除</button></div>`:''}</div></article>`;
  }
  return `<article class="meal-card ${selected?'is-selected':''}">${imageMarkup(recipe)}<div class="meal-card-content"><div class="meal-card-heading"><div><h3>${esc(recipe.title)}</h3><p class="meal-composition">${esc([...(recipe.dishes||[]),recipe.subtitle||recipe.title].filter(Boolean).join(' · '))}</p></div>${selected?'<span class="selected-badge">✓ 已加入</span>':''}</div><div class="meal-card-meta"><span>${time}</span><span>${mealPlan.request.servings}人份</span><span>${esc((recipe.appliances||[]).join('、')||'厨具待确认')}</span></div>${freshness}<p class="meal-reason">${esc(reason)}</p><p class="stock-state">${esc(stockLine)}</p><div class="meal-card-actions"><button class="${selected?'secondary-button':'primary-button'}" data-action="${selected?'remove-menu-item':'choose-meal'}" data-id="${esc(id)}">${selected?'✓ 已加入 · 移除':'选这顿'}</button><button class="secondary-button" data-action="recipe-detail" data-id="${esc(id)}">${selected?'查看做法':'查看搭配'}</button></div>${recipe.isUserRecipe?`<div class="saved-recipe-actions"><button class="text-button" data-action="edit-saved-recipe" data-id="${esc(id)}">编辑</button><button class="text-button danger-text" data-action="delete-saved-recipe" data-id="${esc(id)}">删除</button><small>${recipe.reviewStatus==='user-reviewed'?'已由用户核对保存':'待补充核对'}</small></div>`:''}</div></article>`;
}
function recipeCards(){
  return mealPlan.results.map(recipeCard).join('');
}
function preferenceSummary(){
  const p=preferences();
  if(!hasConfirmedPreferences(p))return '过敏与忌口待确认';
  const avoid=(p.avoid||[]).filter(item=>item!=='无');
  const allergies=(p.allergies||[]).filter(item=>item!=='无');
  const appliances=(p.appliances||[]).filter(item=>item!=='无');
  const parts=[];
  parts.push(allergies.length?`过敏：${allergies.join('、')}`:'已确认无过敏');
  parts.push(avoid.length?`忌口：${avoid.join('、')}`:'已确认无忌口');
  if((p.flavors||[]).length)parts.push((p.flavors||[]).join('、'));
  if(appliances.length)parts.push('已设置厨具限制');
  parts.push(`${mealPlan?.request?.servings||p.defaultServings||2}人`);
  return `${mealPlan?.request?.preferences?'本餐已调整，禁忌沿用个人登记':'已沿用个人偏好'}：${parts.join(' · ')}`;
}
function mealMenuButton(){
  return `<button class="meal-menu-entry" data-action="open-meal-menu">本餐菜单 · 已选${mealPlan.menu.length}道</button>`;
}
function menuRecipe(entry){
  return recipeForView(recipeById(entry.recipeId),entry.servings||mealPlan.request.servings);
}
function isSeasoning(item){
  return item.category==='seasoning'||/^(食盐|盐|白糖|糖|食用油|植物油|油|生抽|老抽|酱油|料酒|蚝油|醋|香油|芝麻油|胡椒粉|辣椒粉|辣椒酱|豆瓣酱|番茄酱|淀粉|味精|鸡精)$/.test(item.name);
}
function menuInventorySummary(){
  const grouped=new Map();
  for(const entry of mealPlan.menu){
    const recipe=menuRecipe(entry);
    if(!recipe)continue;
    for(const ingredient of [...(recipe.ingredients||[]),...(recipe.auxiliaries||[]),...(recipe.seasonings||[])]){
      if(/^(清水|水)$/.test(ingredient.name))continue;
      const seasoning=isSeasoning(ingredient);
      const key=`${ingredient.name}|${ingredient.unit||''}|${seasoning?'seasoning':'food'}`;
      const current=grouped.get(key)||{name:ingredient.name,unit:ingredient.unit||'',quantity:0,known:true,recipes:[],category:seasoning?'seasoning':ingredient.category||'main',optional:ingredient.optional===true};
      if(ingredient.quantity==null||ingredient.quantity===''||!Number.isFinite(Number(ingredient.quantity))||Number(ingredient.quantity)<=0)current.known=false;
      else current.quantity=Number((current.quantity+Number(ingredient.quantity)).toFixed(2));
      current.recipes.push(recipe.title);grouped.set(key,current);
    }
  }
  return [...grouped.values()].map(item=>{
    const records=state.inventory.filter(stock=>stock.name===item.name);
    const valid=records.filter(stock=>safeInventory(stock)&&stock.quantity!=null&&stock.quantity!==''&&Number.isFinite(Number(stock.quantity))&&Number(stock.quantity)>=0);
    const compatible=valid.filter(stock=>item.unit&&(stock.unit||'')===item.unit);
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
function menuShoppingCandidates(){return menuInventorySummary().filter(item=>item.category!=='seasoning'&&(item.gap>0||item.gap===null));}

function estimatedMinutes(recipe){
  return Number.isFinite(Number(recipe.duration))?Number(recipe.duration):null;
}
function menuEstimatedDuration(){
  return collectMenuAllocations().estimatedMinutes??'待估';
}
function mealMenuPage(){
  const ingredients=menuInventorySummary().filter(item=>item.category!=='seasoning');
  const hasGaps=menuShoppingCandidates().length>0;
  const scheduleDuration=collectMenuAllocations().estimatedMinutes;
  const timeCopy=scheduleDuration==null?'总用时待估':`总用时约 ${scheduleDuration} 分钟（保守串行）`;
  return `<div class="recipe-page meal-menu-page"><button class="text-button back-link" data-action="back-to-recipes">‹ 返回菜谱</button><h2>这一顿，就这样安排。</h2><p class="menu-subtitle">可以换一道，也可以少做一道。</p><div class="meal-quick-adjust"><label>本餐人数<select id="menu-servings"><option value="1" ${mealPlan.request.servings===1?'selected':''}>1人</option><option value="2" ${mealPlan.request.servings===2?'selected':''}>2人</option></select></label><span>${mealLabel()} · ${timeCopy}</span></div>${mealPlan.menu.length?`<div class="menu-dishes">${mealPlan.menu.map((entry,index)=>{const recipe=menuRecipe(entry);return recipe?`<article class="menu-dish card">${imageMarkup(recipe)}<div><strong>${esc(recipe.title)}</strong><small>${entry.servings||mealPlan.request.servings}人份</small><div class="menu-dish-actions"><button class="text-button" data-action="recipe-detail" data-id="${esc(entry.recipeId)}">查看做法</button><button class="text-button" data-action="replace-menu-item" data-index="${index}">换一道</button><button class="text-button danger-text" data-action="remove-menu-item" data-id="${esc(entry.recipeId)}">移除</button></div></div></article>`:''}).join('')}</div><button class="secondary-button full-button" data-action="add-another-dish">再添一道</button><div class="section-title"><h2>整餐食材摘要</h2></div><section class="card">${ingredients.map(item=>`<div class="inventory-item"><div class="item-main"><strong>${esc(item.name)} <small>${item.category==='seasoning'?'调味料':item.category==='auxiliary'?'辅料':'主要食材'}</small></strong><p>${item.known?`参考需要 ${item.quantity} ${esc(item.unit)}`:'参考用量待确认'} · ${esc(item.status)}</p></div></div>`).join('')}</section>${hasGaps?'<p class="meta">只在库存可比较且有明确缺口时提醒；未记录不代表家里没有，开始制作不会扣库存。</p>':''}<div class="meal-menu-actions">${hasGaps?'<button class="secondary-button" data-action="menu-shopping">确认采购食材</button>':'<span class="menu-no-gaps">目前没有明确缺口</span>'}<button class="primary-button" data-action="start-cooking">开始制作</button></div><p class="meta menu-inventory-note">现在不扣库存，做完后再确认。</p>`:'<section class="card empty"><b>本餐还没有菜</b><span>从发现菜谱或我的菜谱添加一道或多道菜。</span><button class="primary-button" data-action="back-to-recipes">去选菜</button></section>'}${mealMenuButton()}</div>`;
}
function recipeTabs(active){
  return `<div class="recipe-tabs" role="tablist" aria-label="菜谱功能">${[['discover','发现菜谱'],['saved','我的菜谱'],['shopping','采购清单']].map(([id,label])=>`<button role="tab" aria-selected="${active===id}" class="${active===id?'active':''}" data-action="recipe-section" data-section="${id}">${label}</button>`).join('')}</div>`;
}
function recipeShoppingPage(){
  const count=mealPlan.menu.length;
  return `<div class="recipe-page recipe-shopping-page">${recipeTabs('shopping')}<div class="section-title"><div><h2>采购清单</h2><p class="meta">与采购页共用同一份清单</p></div></div><section class="card recipe-shopping-source"><div><strong>从已选菜谱添加</strong><p class="meta">${count?`本餐已选 ${count} 道，核对食材后加入清单。`:'先选择菜谱，再核对需要购买的食材。'}</p></div><button class="secondary-button" data-action="shopping-from-menu">${count?'核对并添加':'去选菜'}</button></section>${shoppingPage()}</div>`;
}
function myRecipesPage(){
  const query=recipeSearch.trim().toLowerCase();
  const saved=state.recipes.filter(recipe=>(!query||`${recipe.title} ${(recipe.ingredients||[]).map(item=>item.name).join(' ')} ${recipe.tags?.join(' ')} ${recipe.platform||''}`.toLowerCase().includes(query))&&(!recipeTagFilter||recipe.tags?.includes(recipeTagFilter))&&(!recipeSourceFilter||recipe.platform===recipeSourceFilter));
  const tags=[...new Set(state.recipes.flatMap(recipe=>recipe.tags||[]))];
  const sources=[...new Set(state.recipes.map(recipe=>recipe.platform).filter(Boolean))];
  return `<div class="recipe-page my-recipes-page">${recipeTabs('saved')}<div class="section-title"><h2>我的菜谱</h2><button class="primary-button import-button" data-action="open-import">导入菜谱</button></div><form class="recipe-search" id="saved-recipe-search">${voiceInput('saved-recipe-query','我的菜谱搜索',`<input id="saved-recipe-query" name="search" value="${esc(recipeSearch)}" placeholder="搜索我的菜谱">`)}<button class="secondary-button" type="submit">搜索</button></form><div class="saved-filters"><select id="tag-filter"><option value="">全部标签</option>${tags.map(tag=>`<option ${recipeTagFilter===tag?'selected':''}>${esc(tag)}</option>`).join('')}</select><select id="source-filter"><option value="">全部来源</option>${sources.map(source=>`<option ${recipeSourceFilter===source?'selected':''}>${esc(source)}</option>`).join('')}</select></div>${state.recipeDrafts.length?`<section class="card"><strong>待核对草稿 · ${state.recipeDrafts.length}</strong>${state.recipeDrafts.map(draft=>`<div class="draft-row"><div><b>${esc(draft.title||'未命名草稿')}</b><small>${esc(draft.parseStatus||'内容尚未解析')} · ${draft.uncertainties?.length||0} 项待确认</small></div><button class="secondary-button" data-action="edit-recipe-draft" data-id="${esc(draft.id)}">继续编辑</button></div>`).join('')}</section>`:''}${saved.length?`<div class="meal-grid">${saved.map(recipe=>recipeCard(recipe.id)).join('')}</div>`:`<section class="card empty"><b>${state.recipes.length?'没有匹配的菜谱':'还没有保存的菜谱'}</b><span>导入公开链接或粘贴正文，DeepSeek 会整理为待核对菜谱；截图可保存，暂不自动识别。</span><button class="primary-button" data-action="open-import">导入菜谱</button></section>`}${mealMenuButton()}</div>`;
}
function recipePage(){
  if(currentDetailId)return recipeDetailPage(currentDetailId);
  if(recipeScreen==='menu')return mealMenuPage();
  if(recipeScreen==='cooking')return cookingPage();
  if(recipeScreen==='complete')return completePage();
  if(recipeSection==='saved')return myRecipesPage();
  if(recipeSection==='shopping')return recipeShoppingPage();
  const meal=effectiveMeal();
  const active=activeMeal();
  const intent=mealPlan.intent?.sourceText===mealPlan.request.dish?mealPlan.intent:null;
  const intentSummary=intent?[intent.ingredients?.length?`用上：${intent.ingredients.join('、')}`:'',intent.dish||intent.preference||'',intent.appliancesToAvoid?.length?`避开厨具：${intent.appliancesToAvoid.join('、')}`:'',intent.methodsToAvoid?.length?`避开做法：${intent.methodsToAvoid.join('、')}`:''].filter(Boolean).join(' · '):'';
  const intentPanel=intent?`<section class="request-understanding"><div class="request-summary"><strong>需求摘要</strong><span>${esc(intentSummary||'未识别到额外要求')}</span><button type="button" class="text-button" data-action="toggle-recipe-intent">${mealPlan.intentEditing?'收起':'编辑摘要'}</button></div>${mealPlan.intentEditing?`<div class="request-editor"><label>优先用上<input id="intent-ingredients" value="${esc((intent.ingredients||[]).join('、'))}" placeholder="可编辑食材"></label><label>菜品 / 口味<input id="intent-preference" value="${esc([intent.dish,intent.preference].filter(Boolean).join(' · '))}" placeholder="可编辑要求"></label><label>限制厨具<input id="intent-appliances" value="${esc((intent.appliancesToAvoid||[]).join('、'))}" placeholder="例如：烤箱"></label><label>限制做法<input id="intent-methods" value="${esc((intent.methodsToAvoid||[]).join('、'))}" placeholder="例如：油炸"></label><label class="allow-additional-choice"><input id="intent-allow-additional" type="checkbox" ${mealPlan.request.allowAdditionalIngredients!==false?'checked':''}>可以搭配其他食材</label>${(intent.conflicts||[]).length?`<p class="intent-conflict">需要留意：${esc(intent.conflicts.join('；'))}</p>`:''}<button type="button" class="text-button" data-action="apply-recipe-intent" ${recommendationLoading?'disabled':''}>按调整后的需求重新搭配</button></div>`:''}</section>`:'';
  return `<div class="recipe-page discover-page">
    <p class="recipe-subtitle">不用先整理整个冰箱，先选一顿喜欢的。</p>${recipeTabs('discover')}
    ${active?`<section class="active-meal-banner"><strong>${active.status==='awaiting_confirmation'?'本餐待确认消耗':`正在制作：${active.dishes.map(item=>esc(item.recipe.title)).join('、')}`}</strong><button class="text-button" data-action="${active.status==='awaiting_confirmation'?'finish-cooking':'continue-cooking'}">${active.status==='awaiting_confirmation'?'确认消耗':'继续制作'}</button>${menuAdjustmentNotice?'<small role="status">请先完成或结束当前制作，再调整本餐菜单。</small>':''}</section>`:''}
    <form class="recipe-search" id="recipe-query">${voiceInput('dish-query','用餐需求',`<input name="dish" id="dish-query" value="${esc(mealPlan.request.dish)}" placeholder="说说家里有什么，想吃什么" aria-label="说说家里有什么，想吃什么" autocomplete="off">`)}<button type="submit" class="primary-button" ${recommendationLoading?'disabled':''}>${recommendationLoading?'生成中…':'帮我搭配'}</button></form>
    <div class="recipe-quick-controls"><span class="meal-readonly">${mealLabel(meal)}</span><label>人数<select id="servings-select">${[...new Set([1,2,3,4,5,6,8,10,12,mealPlan.request.servings])].sort((a,b)=>a-b).map(value=>`<option value="${value}" ${mealPlan.request.servings===value?'selected':''}>${value}人</option>`).join('')}</select></label><label>时间<select id="duration-select">${[...new Set([15,20,30,45,60,90,mealPlan.request.duration])].sort((a,b)=>a-b).map(value=>`<option value="${value}" ${mealPlan.request.duration===value?'selected':''}>${value}分钟内</option>`).join('')}</select></label><button class="compact-control" data-action="reset-meal">重新安排</button></div>
    <section class="preference-strip"><span>${esc(preferenceSummary())}</span><div class="preference-actions">${hasConfirmedPreferences()?'<button class="secondary-button" data-action="use-personal">无修改，与个人登记一致</button><button class="text-button" data-action="meal-preferences">这顿调整一下</button>':'<button class="secondary-button" data-action="edit-preferences">首次确认过敏与忌口</button>'}</div></section>
    <section class="meal-mode-panel"><strong>这顿想怎么安排？</strong><div class="meal-mode-controls" role="group" aria-label="推荐方式">${[['use-first','用家里的'],['supplement','顺手补几样'],['explore','换点新花样']].map(([value,label])=>`<button class="${mealPlan.request.mode===value?'active':''}" data-action="meal-mode" data-mode="${value}" aria-pressed="${mealPlan.request.mode===value}">${label}</button>`).join('')}</div><small>${({ 'use-first':'主要食材和配菜来自冰箱；调味料不参与推荐，下方另行提示。','supplement':'部分来自冰箱，其余食材可补购。','explore':'不考虑冰箱食材，随机探索菜谱，点击“换一批”刷新。'})[mealPlan.request.mode]||'尽量不出门，用好现有食材。'}</small></section>
    ${intentPanel}
    <div class="section-title recipe-results-title"><div><h2>给你这几种选择</h2><p>每张卡片是一道菜，可自由加入本餐。 · ${mealPlan.request.servings}人 · ${mealPlan.request.duration}分钟内</p></div><button class="text-button" data-action="more-recipes" ${recommendationLoading?'disabled':''}>换一批</button></div>
    ${recommendationNotice?`<p class="meta recommendation-notice">${esc(recommendationNotice)}</p>`:''}
    ${recommendationError?`<section class="card error-card"><span>${esc(recommendationError)}</span><button class="secondary-button" data-action="retry-recommendation">重试</button></section>`:''}
    ${recommendationLoading?'<div class="loading"><span class="spinner"></span>正在理解需求并生成文字菜谱…<button class="text-button" data-action="cancel-recommendation">取消</button></div>':''}
    ${mealPlan.results.length?`<div class="meal-grid">${recipeCards()}</div>`:recommendationLoading?'':`<section class="card empty recipe-empty"><b>${recommendationError?'暂时无法生成推荐':mealPlan.summary.includes('没有找到')||mealPlan.summary.includes('暂未找到')?'没有符合条件的方案':'这组条件下没有更多方案'}</b><span>${recommendationError?'保留了原有条件和方案；可以重试 AI 推荐。':mealPlan.request.mode==='use-first'?'暂未找到主要食材符合冰箱记录的单道菜；请核对食材数量，或重新推荐。调味料会另行提醒。':'可调整时间或偏好；不会擅自放宽过敏、忌口或厨具限制。'}</span>${mealPlan.request.mode==='use-first'?'<button class="secondary-button" data-action="retry-recommendation">重新推荐</button><button class="text-button" data-action="meal-mode" data-mode="supplement">试试顺手补几样</button>':'<button class="secondary-button" data-action="focus-conditions">调整条件</button>'}</section>`}
    ${mealPlan.lastCompleted?`<section class="last-cooked card"><span>最近完成：${esc(mealPlan.lastCompleted.recipe.title)}</span>${mealPlan.lastCompleted.consumedNothing?'<small>本次未扣减库存</small>':`<button class="text-button" data-action="undo-cook" data-operation="${esc(mealPlan.lastCompleted.operationId)}">撤销本次消耗</button>`}</section>`:''}
    <button class="help-link" data-action="show-help">关于 AI 推荐与图片</button>
    ${mealMenuButton()}
  </div>`;
}
function recipeDetailPage(id){
  const recipe=recipeForView(recipeById(id));
  if(!recipe)return '<section class="card empty"><b>找不到这套菜谱</b><button data-action="back-recipes">返回推荐</button></section>';
  const stock=stockSummary(recipe);
  const ingredientGroups=[
    ['主要食材',recipe.ingredients||[]],
    ['辅料',recipe.auxiliaries||[]],
    ['调味料',recipe.seasonings||[]]
  ];
  const uncertainties=recipe.uncertainties||[];
  return `<div class="recipe-detail"><button class="text-button back-link" data-action="back-recipes">‹ 返回${recipeSection==='saved'?'我的菜谱':'发现菜谱'}</button>${imageMarkup(recipe,true)}<div class="detail-title"><h2>${esc(recipe.title)}</h2><p>${esc(recipe.subtitle||'')}</p><button class="text-button" data-action="toggle-favorite" data-id="${esc(id)}">${state.favorites.includes(id)?'♥ 已收藏':'♡ 收藏菜谱'}</button></div><div class="meal-card-meta"><span>${recipe.duration?`原文用时 ${recipe.duration}分钟`:'原文未提供用时'}</span><span>${recipe.servings}人份</span><span>${esc((recipe.appliances||[]).join('、')||'厨具待确认')}</span></div><p class="meal-reason">${esc(recipe.reason||'')}</p>${recipe.parseStatus==='not-configured'?'<p class="meta">分享内容尚未解析；以下信息由用户手动核对，不是模型提取结果。</p>':''}${uncertainties.length?`<p class="meta">待确认：${esc(uncertainties.join('、'))}</p>`:''}<p class="stock-state">${esc(stock.status)}</p>${ingredientGroups.map(([label,items])=>`<div class="section-title"><h2>${label}</h2></div><section class="card">${items.map(ingredient=>`<div class="inventory-item"><div class="item-main"><strong>${esc(ingredient.name)}${ingredient.form?`（${esc(ingredient.form)}）`:''}${ingredient.optional?' · 可选':''}</strong><p>${ingredient.quantity==null?'用量待确认':`${esc(ingredient.quantity)} ${esc(ingredient.unit||'')}${ingredient.quantityType==='suggested'?' · 建议值':''}`}${ingredient.suggestion?' · 建议补充':''}${ingredient.usedInSteps?.length?` · ${esc(ingredient.usedInSteps.join('、'))}`:''}</p></div></div>`).join('')||'<p class="meta">暂无记录</p>'}</section>`).join('')}<div class="section-title"><h2>图文制作步骤</h2></div><div class="step-flow">${recipe.steps.map((step,index)=>`<article class="flow-step"><span class="step-number">${index+1}</span><div class="flow-step-content"><h3>${esc(step.title||`第 ${index+1} 步`)}</h3>${step.imageUrl?`<div class="step-image"><img onerror="this.parentElement.innerHTML='图片暂不可用 · 文字制作仍可继续'" src="${esc(step.imageUrl)}" alt="${esc(step.imageType==='ai-step'?'AI步骤示意':'用户上传步骤图片')}" loading="lazy">${step.imageType==='ai-step'?'<small>AI步骤示意</small>':''}</div>`:'<div class="step-image-placeholder">步骤图待补充 · 图片生成服务未配置</div>'}<p>${esc(step.text)}</p>${step.ingredients?.length?`<small>用量：${esc(step.ingredients.join('、'))}</small>`:''}<small>${step.minutes?`${step.timeType==='estimated'?'估计':'原文'} ${step.minutes} 分钟`:'用时待确认'}</small>${step.completion?`<small>完成判断：${esc(step.completion)}</small>`:''}</div></article>`).join('')||'<p class="meta">制作步骤待补充</p>'}</div><section class="image-credit">${recipe.sourceUrl?`来源：${esc(recipe.platform||'外部来源')} · <a href="${esc(recipe.sourceUrl)}" target="_blank" rel="noreferrer">打开原链接</a>${recipe.author?` · 作者 ${esc(recipe.author)}`:''}`:'来源：用户手动录入'}<br>${recipe.imageUrl?`图片类型：${esc(recipe.imageType||'来源图片')} · ${esc(recipe.imageSource||'来源待补充')} · ${esc(recipe.imageCredit||'署名待补充')} · ${esc(recipe.imageLicense||'授权待核实')}`:'图片尚未添加'}</section><div class="sticky-actions">${recipe.isUserRecipe?`<button class="secondary-button" data-action="edit-saved-recipe" data-id="${esc(id)}">编辑菜谱</button>`:'<button class="secondary-button" data-action="back-recipes">返回菜谱</button>'}<button class="primary-button" data-action="add-menu-item" data-id="${esc(id)}">加入本餐</button></div></div>`;
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
  modal(`<h2>关于菜谱功能</h2><p>发现页由服务端 DeepSeek AI 理解食材和做法需求并生成文字菜谱。模型不可用时会明确提示，不会用预设菜名搜索冒充生成结果。</p><p>当前未接入实时网页检索，因此“换点新花样”显示为“AI创意灵感 · 未核验近期热度”，不会声称近期热门或提供虚构来源。</p><p>语音输入使用浏览器内置语音识别（支持情况因浏览器而异）；本应用不会上传或保存录音，浏览器语音服务可能按其自身规则处理音频。拒绝权限或不支持时仍可打字。</p><p>支持读取部分公开菜谱链接并由 DeepSeek 提取内容；不支持登录后内容和图片识别；菜品图片来自 SerpApi 网络搜索，来源和授权需核对；链接、正文和截图会保存为待核对草稿。库存、偏好、草稿和我的菜谱保存在本地 data.json，不支持跨设备同步。</p><p>选菜与开始制作不会扣库存，完成后确认实际消耗才更新。</p><div class="modal-actions"><button class="primary-button" data-action="close-modal">知道了</button></div>`);
}
function preferenceModal(){
  const p=state.preferences||{};
  const allergies=(p.allergies||[]).filter(item=>item!=='无').join('、');
  const avoid=(p.avoid||[]).filter(item=>item!=='无').join('、');
  modal(`<h2>个人偏好登记</h2>${hasConfirmedPreferences()?'<button type="button" class="secondary-button" data-action="use-personal">无修改，与个人登记一致</button>':'<p>首次确认一次过敏和饮食禁忌，之后每餐自动沿用。</p>'}<p class="meta">这里修改长期登记；只想改这顿，请使用发现页的“这顿调整一下”。</p><label>默认人数</label><select id="preference-servings">${[1,2,3,4,5,6,8,10,12].map(value=>`<option value="${value}" ${mealPlan.request.servings===value?'selected':''}>${value}人</option>`).join('')}</select><form id="preference-form"><label>过敏情况</label><select name="allergiesStatus" required><option value="">请选择</option><option value="none" ${p.allergiesStatus==='none'?'selected':''}>确认无过敏</option><option value="specified" ${p.allergiesStatus==='specified'?'selected':''}>有过敏食材</option></select><label>过敏食材（逗号分隔）</label><input name="allergies" value="${esc(allergies)}" placeholder="例如：花生、虾；无过敏请选上方“确认无过敏”"><label>饮食禁忌 / 忌口</label><select name="dietStatus" required><option value="">请选择</option><option value="none" ${p.dietStatus==='none'?'selected':''}>确认无禁忌或忌口</option><option value="specified" ${p.dietStatus==='specified'?'selected':''}>有禁忌或忌口</option></select><label>禁忌或忌口食材（逗号分隔）</label><input name="avoid" value="${esc(avoid)}" placeholder="例如：香菜；无忌口请选上方“确认无禁忌”"><label>限制厨具（逗号分隔）</label><input name="appliances" value="${esc((p.appliances||[]).filter(item=>item!=='无').join('、'))}" placeholder="例如：烤箱、空气炸锅"><label>口味偏好</label><input name="flavors" value="${esc((p.flavors||[]).join('、'))}" placeholder="例如：清淡、微辣"><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存偏好</button></div></form>`);
}
function mealPreferenceModal(){
  if(!hasConfirmedPreferences()){preferenceModal();return;}
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
  pendingRecipeAction='';
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
function openRecipeImport(){
  modal(`<h2>导入菜谱</h2><p class="meta">DeepSeek 会从公开链接或粘贴正文中提取菜名、食材和步骤，生成待核对草稿。无法读取的页面请粘贴正文；截图暂不自动识别。</p><form id="recipe-import-form"><label>小红书／抖音分享链接（可选）</label><input name="sourceUrl" type="url" placeholder="粘贴分享链接"><label>分享文字或菜谱正文（可选）</label><textarea name="sourceText" rows="5" placeholder="粘贴分享文案或原文；导入后原文会保存在待核对草稿"></textarea><label>上传菜谱图片或截图（可多选）</label><input name="images" type="file" accept="image/*" multiple><p class="meta">图片仅保存在此应用本地数据文件中。单张不超过 4 MB，最多 5 张。</p><p class="inline-error" id="import-error"></p><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">生成待核对草稿</button></div></form>`);
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
  const sourceUrl=String(data.get('sourceUrl')||'').trim()||(sourceText.match(/https?:\/\/[^\s]+/i)?.[0]||'').replace(/[，。！？、）)]+$/,'');
  const files=[...(form.elements.images.files||[])];
  if(!sourceUrl&&!sourceText&&!files.length)throw new Error('请粘贴分享链接、正文或上传图片。');
  if(sourceUrl&&!/^https?:\/\//i.test(sourceUrl))throw new Error('请使用有效的 http 或 https 分享链接。');
  if(files.length>5||files.some(file=>file.size>4*1024*1024)||files.reduce((sum,file)=>sum+file.size,0)>8*1024*1024)throw new Error('最多上传 5 张图片，每张不超过 4 MB，合计不超过 8 MB。');
  const platform=/xiaohongshu\.com|xhslink\.com/i.test(sourceUrl+sourceText)?'小红书':/douyin\.com|iesdouyin\.com/i.test(sourceUrl+sourceText)?'抖音':sourceUrl?'其他链接':sourceText?'粘贴正文':'图片上传';
  const submit=form.querySelector('button[type="submit"]');
  if(submit){submit.disabled=true;submit.textContent='正在保存导入内容…';}
  const draft={id:`draft-${Date.now()}-${Math.random().toString(16).slice(2)}`,title:'',servings:2,ingredients:[],seasonings:[],steps:[],appliances:[],mealTypes:[],tags:[],duration:null,waitMinutes:0,sourceUrl,sourceText,platform,author:'',images:await Promise.all(files.map(imageDataUrl)),imageUrl:'',imageType:'',parseStatus:'pending',uncertainties:['菜名未解析','食材与用量未解析','制作步骤未解析','来源作者未核实'],createdAt:new Date().toISOString()};
  state.recipeDrafts.unshift(draft);await persist();
  if(sourceUrl||sourceText){if(submit)submit.textContent='正在解析菜谱…';await parseDraftWithDeepSeek(draft);}
  closeModal();recipeEditorModal(draft.id,true);
}
async function parseDraftWithDeepSeek(draft){
  try{
    const parsed=await api('/api/recipe-import/parse',{method:'POST',body:JSON.stringify({sourceUrl:draft.sourceUrl,sourceText:draft.sourceText})});
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
  return '原文与图片已保存在草稿；可用 DeepSeek 解析公开链接或正文，截图暂不自动识别。';
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
  modal(`<h2>${isDraft?'编辑待核对草稿':'编辑我的菜谱'}</h2><p class="meta">${esc(isDraft?importDraftSummary(recipe):'用户保存的菜谱；来源元信息保持可编辑。')}</p><form id="recipe-editor-form" data-id="${esc(id)}" data-draft="${isDraft}"><label>菜名</label><input name="title" required value="${esc(recipe.title)}" placeholder="请核对并填写菜名"><label>参考人数</label><select name="servings"><option value="1" ${Number(recipe.servings)===1?'selected':''}>1人</option><option value="2" ${Number(recipe.servings||2)===2?'selected':''}>2人</option><option value="4" ${Number(recipe.servings)===4?'selected':''}>4人</option></select><label>主要食材与用量（每行：名称 数量 单位；适量可直接写“名称 适量”）</label><textarea name="ingredients" rows="5" placeholder="番茄 2 个&#10;鸡蛋 2 个">${esc(ingredients)}</textarea><label>辅料（每行一项）</label><textarea name="auxiliaries" rows="2" placeholder="清水 待确认">${esc(auxiliaries)}</textarea><label>调味料（每行一项）</label><textarea name="seasonings" rows="2" placeholder="食盐 适量">${esc(seasonings)}</textarea><label>制作步骤（每行一步）</label><textarea name="steps" rows="6" placeholder="请核对或补充步骤">${esc(steps)}</textarea><label>原文用时（未提供请留空，不会自动编造）</label><input name="duration" type="number" min="1" max="600" value="${esc(recipe.duration||'')}" placeholder="原文未提供"><label>厨具</label><input name="appliances" value="${esc((recipe.appliances||[]).join('、'))}" placeholder="例如：炒锅、灶台"><label>适用餐次（逗号分隔）</label><input name="mealTypes" value="${esc((recipe.mealTypes||[]).join('、'))}" placeholder="breakfast、lunch、dinner、snack"><label>标签</label><input name="tags" value="${esc((recipe.tags||[]).join('、'))}"><label>来源链接</label><input name="sourceUrl" type="url" value="${esc(recipe.sourceUrl||'')}"><label>来源平台／作者（可核实后填写）</label><div class="recipe-editor-grid"><input name="platform" value="${esc(recipe.platform||'')}" placeholder="平台"><input name="author" value="${esc(recipe.author||'')}" placeholder="作者"></div><label>原始分享文字（来源内容，不等于解析结果）</label><textarea name="sourceText" rows="4">${esc(recipe.sourceText||'')}</textarea>${imageOptions?`<label>使用导入图片作为封面</label><select name="coverImage"><option value="">不设封面</option>${imageOptions}</select>`:''}<p class="meta">解析结果需核对原文；截图不会被自动识别。</p><p class="inline-error" id="editor-error"></p><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button>${isDraft?'<button type="button" class="secondary-button" data-action="parse-recipe-draft">解析链接或正文</button><button type="button" class="secondary-button" data-action="save-recipe-draft">保存草稿</button>':''}<button class="primary-button" type="submit">${isDraft?'保存到我的菜谱':'保存修改'}</button></div></form>`);
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
function collectMenuAllocations(){
  const available=new Map(state.inventory.map(item=>[item.id,safeInventory(item)&&Number.isFinite(Number(item.quantity))?Number(item.quantity):0]));
  const dishes=mealPlan.menu.map(entry=>{
    const recipe=recipeForView(recipeById(entry.recipeId),entry.servings);
    if(!recipe)return null;
    const sourceIngredients=[...(recipe.ingredients||[]),...(recipe.auxiliaries||[]),...(recipe.seasonings||[])];
    const ingredients=sourceIngredients.map(ingredient=>{
      let remaining=Number(ingredient.quantity)||0;const allocations=[];
      if(ingredient.quantity!=null&&Number.isFinite(Number(ingredient.quantity))&&(ingredient.unit||'')){
        for(const stock of state.inventory.filter(item=>item.name===ingredient.name&&safeInventory(item)&&(item.unit||'')===(ingredient.unit||'')).sort((a,b)=>(a.expiryDate||'9999').localeCompare(b.expiryDate||'9999'))){
          const quantity=Math.min(remaining,available.get(stock.id)||0);
          if(quantity>0){allocations.push({inventoryId:stock.id,name:ingredient.name,quantity,unit:ingredient.unit});remaining=Number((remaining-quantity).toFixed(2));available.set(stock.id,(available.get(stock.id)||0)-quantity);}
          if(remaining<=0)break;
        }
      }
      return {...ingredient,allocations};
    });
    return {recipe,ingredients,cooked:false};
  }).filter(Boolean);
  let sharedRiceScheduled=false;
  const taskQueues=[];
  dishes.forEach((dish,dishIndex)=>{
    const steps=dish.recipe.steps||[];
    const tasks=steps.flatMap((rawStep,index)=>{
      const step=typeof rawStep==='string'?{title:`第 ${index+1} 步`,text:rawStep}:rawStep;
      let text=step.text;
      let title=step.title||`第 ${index+1} 步`;
      let taskDish=dish.recipe.title;
      let stepIngredients=step.ingredients?.length?step.ingredients:dish.ingredients.map(item=>`${item.name}${item.form?`（${item.form}）`:''} ${item.quantity??'用量待确认'} ${item.unit||''}`);
      let sharedRiceStep=false;
      let prepTask=null;
      if(/煮饭|大米.*煮|米饭.*煮/.test(text)){
        const riceClause=/[^，。；]*?(?:煮饭|大米[^，。；]*煮|米饭[^，。；]*煮)[^，。；]*/;
        if(!sharedRiceScheduled){
          sharedRiceScheduled=true;
          sharedRiceStep=true;
          const riceText=text.match(riceClause)?.[0]||text;
          const prepText=text.replace(riceClause,'').replace(/^[，。；\s]+|[，。；\s]+$/g,'');
          const nonRiceIngredients=stepIngredients.filter(line=>!/大米|米饭|熟饭/.test(line));
          stepIngredients=stepIngredients.filter(line=>/大米|米饭|熟饭/.test(line));
          if(prepText)prepTask={id:`task-${dishIndex}-${index}-prep`,dishIndex,dish:dish.recipe.title,title:'一次备好蔬菜和配料',text:prepText,minutes:null,timeType:'unknown',imageUrl:'',imageType:'',ingredients:nonRiceIngredients,completion:'备料完成后再按菜谱继续',category:1,done:false};
          text=riceText;
          title='先把本餐米饭煮上';
          taskDish='整餐共享准备';
        }else{
          text=text.replace(riceClause,'').replace(/^[，。；\s]+|[，。；\s]+$/g,'');
          stepIngredients=stepIngredients.filter(line=>!/大米|米饭|熟饭/.test(line));
          if(!text)return null;
        }
      }
      if(!sharedRiceStep&&/炒.*鸡蛋|鸡蛋.*炒/.test(text)&&text.includes('番茄'))title='先炒鸡蛋，再炒番茄';
      else if(!sharedRiceStep&&/洗.*切|切.*焯水|备料|准备.*蔬菜/.test(text))title='一次备好蔬菜和配料';
      else if(!sharedRiceStep&&/检查.*米饭|米饭.*完成|米饭煮熟/.test(text))title='检查米饭，准备开饭';
      const category=/煮饭|煮熟|煮好|烧水|预热|开始/.test(text)?0:/洗|切|剥|解冻|浸泡|焯水|准备|打散/.test(text)?1:/装盘|盛出/.test(text)?3:2;
      const minutes=step.minutes!=null&&step.minutes!==''&&Number.isFinite(Number(step.minutes))?Number(step.minutes):null;
      const task={id:`task-${dishIndex}-${index}`,dishIndex,dish:taskDish,title,text,minutes,timeType:step.minutes?'known':'unknown',imageUrl:step.imageUrl||'',imageType:step.imageType||'',ingredients:stepIngredients,completion:step.completion||'',category,done:false};
      return prepTask?[task,prepTask]:[task];
    }).filter(Boolean);
    if(Number(dish.recipe.waitMinutes)>0&&!steps.some(step=>/静置|浸泡|腌|解冻|等待|醒/.test(safeStepText(step)))){
      tasks.splice(Math.min(tasks.length,1),0,{id:`task-${dishIndex}-wait`,dishIndex,dish:dish.recipe.title,title:'等待或准备时间',text:'按菜谱记录预留等待时间；期间可检查其他备料，但本排程按保守串行估算。',minutes:Number(dish.recipe.waitMinutes),timeType:'known',imageUrl:'',imageType:'',ingredients:[],completion:'等待时间结束后再继续',category:0,done:false});
    }
    taskQueues.push(tasks);
  });
  const taskList=[];
  while(taskQueues.some(queue=>queue.length)){
    const available=taskQueues.map(queue=>queue[0]).filter(Boolean).sort((a,b)=>a.category-b.category||a.dishIndex-b.dishIndex);
    const next=available[0];
    taskQueues[next.dishIndex].shift();
    taskList.push(next);
  }
  const riceTask=taskList.find(task=>task.title==='先把本餐米饭煮上');
  if(riceTask){
    const riceAmounts=new Map();
    for(const dish of dishes){
      for(const ingredient of dish.ingredients.filter(item=>['大米','生米'].includes(item.name)&&!['熟饭','熟米饭'].includes(item.form))){
        const key=`${ingredient.name}|${ingredient.unit||''}`;
        const item=riceAmounts.get(key)||{name:ingredient.name,unit:ingredient.unit||'',quantity:0,known:true};
        if(ingredient.quantity==null||!Number.isFinite(Number(ingredient.quantity)))item.known=false;
        else item.quantity=Number((item.quantity+Number(ingredient.quantity)).toFixed(3));
        riceAmounts.set(key,item);
      }
    }
    if(riceAmounts.size)riceTask.ingredients=[...riceAmounts.values()].map(item=>`${item.name}（生米） ${item.known?item.quantity:'用量待确认'} ${item.unit}`.trim());
  }
  let minute=0,hasUnknownTime=false;taskList.forEach((task,index)=>{task.index=index;task.startMinute=hasUnknownTime?null:minute;if(task.minutes==null)hasUnknownTime=true;else if(!hasUnknownTime)minute+=task.minutes;task.endMinute=hasUnknownTime?null:minute;});
  return {dishes,timeline:taskList,estimatedMinutes:hasUnknownTime?null:minute};
}
function showMenuAdjustmentNotice(){
  menuAdjustmentNotice=true;currentTab='recipes';recipeSection='discover';recipeScreen='browse';currentDetailId=null;render();
  document.querySelector('.active-meal-banner')?.scrollIntoView({block:'nearest'});
}
function addRecipeToMenu(recipeId){
  if(activeMeal()){showMenuAdjustmentNotice();return;}
  if(mealPlan.menu.some(entry=>entry.recipeId===recipeId)&&replaceMenuIndex===null){modal(`<h2>这道菜已加入本餐</h2><p>同一道菜不会重复添加。可直接前往菜单查看或调整份量。</p><div class="modal-actions"><button class="secondary-button" data-action="close-modal">继续浏览</button><button class="primary-button" data-action="open-meal-menu">打开本餐菜单</button></div>`);return;}
  if(!hasConfirmedPreferences()){pendingRecipeAction=recipeId;preferenceModal();return;}
  const recipe=recipeById(recipeId);
  if(!recipe)return;
  const blocked=[...(preferences().allergies||[]),...(preferences().avoid||[])].filter(item=>item&&item!=='无');
  if(blocked.some(item=>(recipe.ingredients||[]).some(ingredient=>ingredient.name.includes(item)))){toast('这道菜包含已设置的过敏或忌口食材，不能加入本餐');return;}
  if(replaceMenuIndex!==null){
    mealPlan.menu[replaceMenuIndex]={recipeId,servings:mealPlan.request.servings};
    replaceMenuIndex=null;
  }else mealPlan.menu.push({recipeId,servings:mealPlan.request.servings});
  persist().then(()=>{recipeScreen='menu';currentTab='recipes';currentDetailId=null;render();}).catch(error=>toast(error.message));
}
function chooseRecommendedMeal(recipeId){
  if(activeMeal()){showMenuAdjustmentNotice();return;}
  if(mealPlan.menu.some(entry=>entry.recipeId===recipeId)){
    recipeScreen='menu';currentTab='recipes';render();return;
  }
  addRecipeToMenu(recipeId);
}
function removeRecipeFromMenu(recipeId){
  if(activeMeal()){showMenuAdjustmentNotice();return;}
  mealPlan.menu=mealPlan.menu.filter(entry=>entry.recipeId!==recipeId);
  persist().then(render).catch(error=>toast(error.message));
}
function openMenuShopping(){
  const summary=menuInventorySummary(),missing=menuShoppingCandidates();
  const groups=[['short','冰箱已有 · 预计需要补买'],['unrecorded','冰箱未记录 · 请核对家里是否有'],['uncertain','冰箱记录待核对']];
  const rows=groups.map(([group,title])=>{const items=missing.map((item,index)=>({item,index})).filter(row=>row.item.stockGroup===group);if(!items.length)return '';return `<section class="purchase-group"><h3>${title}</h3>${items.map(({item,index})=>`<div class="purchase-choice"><label class="missing-choice"><input type="checkbox" data-menu-buy="${index}" checked><span><strong>${esc(item.name)}</strong><small>${esc(item.status)} · ${item.known?`菜谱参考 ${esc(item.quantity)} ${esc(item.unit)}`:'菜谱用量待确认'} · ${item.suggestedQuantity!=null?`建议购买 ${esc(item.suggestedQuantity)} ${esc(item.unit)}`:'购买量待确认'}</small></span></label><details><summary>修改数量或单位</summary><div class="shopping-quantity-row"><input aria-label="${esc(item.name)}购买数量" data-buy-quantity="${index}" type="number" min="0" step="any" value="${item.suggestedQuantity==null?'':item.suggestedQuantity}" placeholder="数量待确认"><input aria-label="${esc(item.name)}购买单位" data-buy-unit="${index}" value="${esc(item.unit==='适量'?'':item.unit||'')}" placeholder="单位待确认"></div></details></div>`).join('')}</section>`;}).join('');
  const covered=summary.filter(item=>item.category!=='seasoning'&&item.stockGroup==='covered');
  const seasonings=[...new Set(summary.filter(item=>item.category==='seasoning').map(item=>item.name))];
  const reminder=`${covered.length?`<p class="meta"><strong>冰箱已有，参考用量可覆盖：</strong>${covered.map(item=>esc(item.name)).join('、')}</p>`:''}${seasonings.length?`<p class="meta"><strong>调味料提醒：</strong>${seasonings.map(esc).join('、')}。请检查是否备齐，不加入采购清单。</p>`:''}`;
  modal(`<h2>确认采购食材</h2><p class="meta">参考菜谱用量及冰箱记录，默认勾选需要核对的食材；未记录不代表家里没有。数量有变化时可修改。已有同名待买食材不会重复加入。</p><form id="menu-shopping-form">${rows}${reminder}${!missing.length?'<p class="meta">没有需要加入采购清单的食材。</p>':''}<div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">${missing.length?'取消':'知道了'}</button>${missing.length?'<button class="primary-button" type="submit">确认加入采购清单</button>':''}</div></form>`);
}
async function startCooking(){
  const latest=await api('/api/state');
  state=latest;mealPlan=state.mealPlan;
  if(activeMeal()){recipeScreen=activeMeal().status==='awaiting_confirmation'?'cook-confirm':'cooking';render();if(activeMeal().status==='awaiting_confirmation')consumptionModal();return;}
  if(!mealPlan.menu.length){toast('请先加入一道或多道菜');return;}
  const gaps=menuInventorySummary().filter(item=>item.gap>0||item.status.includes('存疑')||item.status.includes('不可食用'));
  if(gaps.length){
    modal(`<h2>食材轻量提醒</h2><p>以下食材建议核对；开始制作不会扣库存，也不会改动长期库存。</p>${gaps.map(item=>`<p><strong>${esc(item.name)}</strong> · ${esc(item.status)}</p>`).join('')}<div class="modal-actions"><button class="secondary-button" data-action="menu-shopping">加入采购清单</button><button class="secondary-button" data-action="close-modal">换一道菜</button><button class="primary-button" data-action="confirm-ready">我已备齐，继续制作</button></div>`);
    return;
  }
  beginMealCooking();
}
async function beginMealCooking(){
  const {dishes,timeline,estimatedMinutes:minutes}=collectMenuAllocations();
  mealPlan.active={id:`meal-${Date.now()}`,meal:effectiveMeal(),status:'cooking',dishes,timeline,stepIndex:0,estimatedMinutes:minutes,servings:mealPlan.request.servings,operationId:`cook-${Date.now()}-${Math.random().toString(16).slice(2)}`,createdAt:new Date().toISOString()};
  recipeScreen='cooking';currentTab='recipes';currentDetailId=null;await persist();render();
}
function cookingPage(){
  const active=activeMeal();
  if(!active)return mealMenuPage();
  if(active.status==='awaiting_confirmation')return `<div class="cooking-page"><h2>这顿吃好了，顺手记一下。</h2><p>按参考用量整理好了，只改和实际不同的地方。</p><p>库存尚未更新。</p><button class="primary-button full-button" data-action="finish-cooking">确认用量</button></div>`;
  const completed=active.timeline.filter(step=>step.done).length;
  const current=active.stepIndex>=active.timeline.length?null:active.timeline[active.stepIndex];
  const nextSteps=active.timeline.slice(active.stepIndex+1);
  const totalTime=active.estimatedMinutes==null?'总用时待估':`总用时约 ${active.estimatedMinutes} 分钟（保守串行）`;
  const totalSteps=active.timeline.length;
  const progressPercent=totalSteps?Math.round(completed/totalSteps*100):0;
  const spatulaPosition=Math.min(96,Math.max(4,progressPercent));
  const stage=current?.category<=1?'备料':current?.category>=3?'装盘':'烹饪';
  return `<div class="cooking-page"><header class="cooking-header"><button class="text-button back-link" data-action="exit-cooking">‹ 退出并保存进度</button><h2>一起，把这顿饭做好。</h2><p class="meta">${mealLabel(active.meal)} · ${active.servings}人 · ${esc(active.dishes.map(item=>item.recipe.title).join('＋'))} · ${totalTime}</p><button class="text-button" data-action="view-amounts">查看全部食材</button></header><section class="cooking-progress"><div class="progress-label"><strong>制作进度 ${completed}／${totalSteps}步</strong><small>仅记录你确认完成的操作</small></div><div class="progress-track" role="progressbar" aria-label="用户确认的制作步骤进度" aria-valuemin="0" aria-valuemax="${totalSteps}" aria-valuenow="${completed}"><span class="progress-fill" style="width:${progressPercent}%"></span><svg class="cooking-spatula" style="left:${spatulaPosition}%" viewBox="0 0 32 32" aria-hidden="true"><path d="M8 3h16l-2 12-6 5-6-5L8 3Zm8 18 2 2-7 7-2-2 7-7Z"/></svg></div><div class="progress-stages"><span class="${stage==='备料'?'active':''}">备料</span><span class="${stage==='烹饪'?'active':''}">烹饪</span><span class="${stage==='装盘'?'active':''}">装盘</span></div></section>${current?`<section class="current-cook-step"><div class="current-step-heading"><span class="step-number">${current.index+1}</span><div><small>${esc(current.dish)} · ${current.index+1}/${totalSteps}</small><h3>${esc(current.title)}</h3></div></div><div class="flow-step-content">${current.imageUrl?`<div class="step-image"><img onerror="this.parentElement.innerHTML='图片暂不可用 · 文字制作仍可继续'" src="${esc(current.imageUrl)}" alt="${esc(current.imageType==='ai-step'?'AI步骤示意':'用户上传步骤图片')}">${current.imageType==='ai-step'?'<small>AI步骤示意</small>':''}</div>`:'<div class="step-image-placeholder">步骤图待补充 · 文字步骤可独立完成</div>'}<p>${esc(current.text)}</p><small>${current.timeType==='known'?`原文/用户提供 ${current.minutes} 分钟`:'用时待确认，不计入总时长'}</small>${current.startMinute!=null&&current.endMinute!=null?`<small>参考排程：第 ${current.startMinute}–${current.endMinute} 分钟</small>`:''}${current.ingredients.length?`<small>本步食材：${esc(current.ingredients.join('、'))}</small>`:''}${current.completion?`<small>完成判断：${esc(current.completion)}</small>`:''}</div><button class="primary-button full-button" data-action="next-step">${current.done?'已完成，继续下一步':'完成这一步'}</button>${current.done?'<button class="text-button full-button" data-action="toggle-step-done">取消这一步的完成标记</button>':''}</section>`:'<section class="card empty"><b>制作步骤已看完</b><span>也可以直接结束制作，按实际完成的菜确认用量。</span></section>'}<details class="upcoming-steps"><summary>后续流程 · ${nextSteps.length} 步</summary><div class="step-flow">${nextSteps.map(step=>`<article class="flow-step"><span class="step-number">${step.index+1}</span><div class="flow-step-content"><small>${esc(step.dish)}</small><h3>${esc(step.title)}</h3><button class="text-button" data-action="view-step" data-index="${step.index}">查看这一步</button><p>${esc(step.text)}</p>${step.minutes==null?'<small>用时待确认</small>':`<small>原文/用户提供 ${step.minutes} 分钟</small>`}</div></article>`).join('')}</div></details><div class="cooking-actions has-finish"><button class="secondary-button" data-action="previous-step" ${active.stepIndex===0?'disabled':''}>上一步</button><button class="secondary-button" data-action="exit-cooking">保存进度</button><button class="primary-button" data-action="finish-cooking">我已做完</button></div></div>`;
}
function ensureConsumptionDraft(active){
  if(active.consumptionDraft){const d=active.consumptionDraft;d.inventorySnapshot ||= clone(state.inventory);d.remainingQuantities ||= {};d.quantityModes ||= {};return d;}
  const cooked=active.dishes.filter(dish=>dish.cooked).map(dish=>dish.recipe.id);
  active.consumptionDraft={
    inventorySnapshot:clone(state.inventory),
    remainingQuantities:{},quantityModes:{},editSection:'',editKey:'',
    mode:'reference',
    cookedDishIds:cooked.length?cooked:active.dishes.map(dish=>dish.recipe.id),
    sources:{},
    quantities:{},
    mixedQuantities:{},
    leftovers:{},
    leftoverQuantities:{}
  };
  return active.consumptionDraft;
}
function consumptionItems(active){
  const draft=ensureConsumptionDraft(active);
  const cooked=new Set(draft.cookedDishIds);
  const grouped=new Map();
  for(const dish of active.dishes){
    if(!cooked.has(dish.recipe.id))continue;
    for(const ingredient of dish.ingredients||[]){
      if(/^(清水|水)$/.test(ingredient.name))continue;
      const key=`${ingredient.name}|${ingredient.unit||''}`;
      const item=grouped.get(key)||{key,name:ingredient.name,unit:ingredient.unit||'',quantity:0,quantityKnown:true,category:ingredient.category||'main',dishIds:[]};
      if(ingredient.quantity==null||!Number.isFinite(Number(ingredient.quantity)))item.quantityKnown=false;
      else item.quantity=Number((item.quantity+Number(ingredient.quantity)).toFixed(3));
      if(!item.dishIds.includes(dish.recipe.id))item.dishIds.push(dish.recipe.id);
      grouped.set(key,item);
    }
  }
  return [...grouped.values()].map(item=>{
    const named=draft.inventorySnapshot.filter(stock=>stock.name===item.name);
    const compatible=named.filter(stock=>(stock.unit||'')===item.unit);
    const stocks=compatible.filter(stock=>safeInventory(stock)&&Number.isFinite(Number(stock.quantity))&&Number(stock.quantity)>0);
    const available=stocks.reduce((sum,stock)=>sum+Number(stock.quantity),0);
    const stateLabel=stocks.length?`库存 ${available} ${item.unit}`:compatible.length?'库存待确认':named.length?'单位不兼容，待核对':'未记录，家里可能有';
    const ambiguous=named.some(stock=>!safeInventory(stock))||named.length>0&&compatible.length===0;
    return {...item,stocks,available,stateLabel,ambiguous,source:draft.sources[item.key]||'recorded'};
  });
}
function updateConsumptionDraftFromForm(){
  const active=activeMeal(),form=document.getElementById('consumption-form');
  if(!active||!form)return;
  const draft=ensureConsumptionDraft(active);
  draft.mode=form.querySelector('[name="consumption-mode"]:checked')?.value||draft.mode;

  if(form.querySelector('[data-cooked-dish]'))draft.cookedDishIds=[...form.querySelectorAll('[data-cooked-dish]:checked')].map(input=>input.dataset.cookedDish);
  for(const input of form.querySelectorAll('[data-quantity-mode]'))draft.quantityModes[input.dataset.quantityMode]=input.value;
  for(const input of form.querySelectorAll('[data-remaining-quantity]'))draft.remainingQuantities[input.dataset.remainingQuantity]=input.value;
  for(const input of form.querySelectorAll('[data-consumption-source]'))draft.sources[input.dataset.consumptionSource]=input.value;
  for(const input of form.querySelectorAll('[data-new-ingredient]')){const key=input.dataset.newIngredient;if(input.checked&&(!draft.sources[key]||draft.sources[key]==='recorded'))draft.sources[key]='new';if(!input.checked&&draft.sources[key]&&draft.sources[key]!=='recorded')draft.sources[key]='recorded';}
  for(const input of form.querySelectorAll('[data-consumption-quantity]'))draft.quantities[input.dataset.consumptionQuantity]=input.value;
  for(const input of form.querySelectorAll('[data-mixed-quantity]'))draft.mixedQuantities[input.dataset.mixedQuantity]=input.value;
  for(const input of form.querySelectorAll('[data-add-leftover]'))draft.leftovers[input.dataset.addLeftover]=input.checked;
  for(const input of form.querySelectorAll('[data-leftover-quantity]'))draft.leftoverQuantities[input.dataset.leftoverQuantity]=input.value;
}
function itemAccounting(item,draft){
  const source=draft.sources[item.key]||'recorded';
  const raw=draft.quantities[item.key];
  const actual=raw!==undefined&&raw!=='';
  const amount=actual?Number(raw):item.quantity;
  const mixed=draft.mixedQuantities[item.key];
  const oldUse=source==='mixed'?(mixed==null||mixed===''?NaN:Number(mixed)):amount;
  const remaining=draft.remainingQuantities[item.key];
  const calibration=draft.quantityModes[item.key]==='remaining'&&['recorded','mixed'].includes(source)&&item.stocks.length===1&&!item.ambiguous&&remaining!==undefined&&remaining!==''&&Number.isFinite(Number(remaining))&&Number(remaining)>=0;
  const deduct=draft.quantityModes[item.key]!=='remaining'&&['recorded','mixed'].includes(source)&&!item.ambiguous&&(item.quantityKnown||actual||source==='mixed')&&Number.isFinite(oldUse)&&oldUse>0&&oldUse<=item.available;
  const leftover=['new','mixed'].includes(source)&&draft.leftovers[item.key]&&Number(draft.leftoverQuantities[item.key])>0;
  return {source,oldUse,calibration,deduct,leftover,basis:actual||source==='mixed'?'confirmed':'estimated'};
}
function consumptionCounts(items,draft){
  let update=0,add=0,skip=0;
  for(const item of items){const a=itemAccounting(item,draft);if(a.deduct||a.calibration)update++;else skip++;if(a.leftover)add++;}
  return {update,add,skip};
}
function quantityEditor(item,draft,mixed=false){
  const key=esc(item.key),mode=draft.quantityModes[item.key]||'used';
  return `<label>填写方式<select data-quantity-mode="${key}"><option value="used" ${mode==='used'?'selected':''}>${mixed?'其中用了多少旧库存':'实际使用量'}</option><option value="remaining" ${mode==='remaining'?'selected':''}>现在旧库存还剩多少</option></select></label>${mode==='remaining'?`<label>当前实际剩余（${esc(item.unit)}）<input type="number" min="0" step="any" data-remaining-quantity="${key}" value="${esc(draft.remainingQuantities[item.key]??'')}" placeholder="不确定可留空，本项暂不更新"></label><p class="meta">${item.stocks.length===1?'按此次实物盘点设为新基准，不重复扣参考量。':'存在多个批次或没有兼容库存，请到冰箱分别盘点；本项暂不更新。'}</p>`:`<label>${mixed?'其中用了多少旧库存':'实际使用量'}（${esc(item.unit)}）<input type="number" min="0" step="any" ${mixed?'data-mixed-quantity':'data-consumption-quantity'}="${key}" value="${esc((mixed?draft.mixedQuantities[item.key]:draft.quantities[item.key])??'')}" placeholder="${mixed?'只填明确用过的旧库存，不确定留空':'留空沿用参考用量'}"></label>`}`;
}
function consumptionModal(){
  const active=activeMeal();if(!active)return;
  const draft=ensureConsumptionDraft(active),items=consumptionItems(active),counts=consumptionCounts(items,draft);
  const includesNew=items.some(item=>['new','mixed'].includes(draft.sources[item.key]));
  const adjusted=items.some(item=>draft.quantityModes[item.key]==='remaining'||draft.quantities[item.key]!==undefined||draft.sources[item.key]==='mixed');
  const label=counts.update?(adjusted?'按确认用量更新库存':'从库存按参考量更新'):includesNew?'确认完成，不扣旧库存':'确认完成，库存保持不变';
  const hints=items.filter(item=>!draft.sources[item.key]&&state.shopping.some(p=>p.name===item.name&&p.unit===item.unit&&p.status==='bought'&&!state.inventory.some(stock=>stock.sourceShoppingId===p.id)));
  let editor='';
  if(draft.editSection==='dishes')editor=`<h3>有道菜没做</h3>${active.dishes.map(dish=>`<label class="confirm-choice"><input type="checkbox" data-cooked-dish="${esc(dish.recipe.id)}" ${draft.cookedDishIds.includes(dish.recipe.id)?'checked':''}>${esc(dish.recipe.title)}</label>`).join('')}`;
  if(draft.editSection==='new')editor=`<h3>哪些食材用了新买的？</h3><button type="button" class="text-button" data-action="all-new-ingredients">全部是新买的</button><p class="meta">未勾选食材，从已登记库存按参考量更新。</p>${items.map(item=>{const source=draft.sources[item.key]||'recorded',selected=source!=='recorded';return `<article class="confirm-ingredient"><label class="confirm-choice"><input type="checkbox" data-new-ingredient="${esc(item.key)}" ${selected?'checked':''}>${esc(item.name)}</label>${selected?`<label>来源<select data-consumption-source="${esc(item.key)}"><option value="new" ${source==='new'?'selected':''}>全部新买</option><option value="mixed" ${source==='mixed'?'selected':''}>新旧都用了</option><option value="uncertain" ${source==='uncertain'?'selected':''}>不确定，稍后再记</option></select></label>${source==='mixed'?quantityEditor(item,draft,true):''}${source!=='uncertain'?`<label class="confirm-choice"><input type="checkbox" data-add-leftover="${esc(item.key)}" ${draft.leftovers[item.key]?'checked':''}>把剩下的记入冰箱</label>${draft.leftovers[item.key]?`<label>新买部分实际剩余（${esc(item.unit)}）<input type="number" min="0" step="any" data-leftover-quantity="${esc(item.key)}" value="${esc(draft.leftoverQuantities[item.key]??'')}"></label><p class="meta">仅记录实际剩余，新批次保留独立日期；不推算购买总量。</p>`:''}`:''}`:''}</article>`;}).join('')}`;
  if(draft.editSection==='amount')editor=`<h3>哪项用量不一样？</h3><div class="ingredient-picker">${items.map(item=>`<button type="button" class="secondary-button" data-action="edit-amount-item" data-key="${esc(item.key)}">${esc(item.name)}</button>`).join('')}</div>${items.filter(item=>item.key===draft.editKey).map(item=>`<h3>${esc(item.name)}</h3><p class="meta">参考 ${item.quantityKnown?`${item.quantity} ${esc(item.unit)}`:'用量未知'} · ${esc(item.stateLabel)}</p>${['new','uncertain'].includes(draft.sources[item.key])?'<p>此项已设为不扣旧库存。来源设置仍保留，请在“用了新买的”中修改。</p>':quantityEditor(item,draft,draft.sources[item.key]==='mixed')}`).join('')}`;
  if(draft.editSection==='choose')editor=`<div class="exception-choices">${[['dishes','有道菜没做'],['new','用了新买的'],['amount','用量不一样']].map(([section,title])=>`<button type="button" class="secondary-button" data-action="consumption-section" data-section="${section}">${title}</button>`).join('')}</div>`;
  const names=active.dishes.filter(dish=>draft.cookedDishIds.includes(dish.recipe.id)).map(dish=>dish.recipe.title);
  modal(`<h2>这顿做好了。</h2><form id="consumption-form"><p>${esc(names.join('、')||'未选制作菜品')}</p><p>已按参考用量整理，预计更新${counts.update}种食材。</p><p class="meta consumption-exception-prompt">没做某道菜、用了新买的，或用量不同？ <button type="button" class="text-button" data-action="consumption-section" data-section="choose">修改一下</button></p>${editor?`<section class="exception-editor">${editor}${draft.editSection!=='choose'?'<button type="button" class="text-button" data-action="consumption-section" data-section="">收起调整，查看提交摘要</button>':''}</section>`:''}${hints.map(item=>`<p class="purchase-source-hint">${esc(item.name)}是刚买的那份吗？<button type="button" class="text-button" data-action="purchase-source" data-key="${esc(item.key)}" data-source="new">是，不扣旧库存</button><button type="button" class="text-button" data-action="purchase-source" data-key="${esc(item.key)}" data-source="recorded">不是，用家里的</button></p>`).join('')}<details class="consumption-details"><summary>查看用量（${items.length}项）</summary>${items.map(item=>{const a=itemAccounting(item,draft);return `<p><strong>${esc(item.name)}</strong> · ${a.calibration?`盘点剩余 ${esc(draft.remainingQuantities[item.key])}`:a.deduct?`扣减 ${a.oldUse}`:'保持不变'} ${esc(item.unit)}${a.basis==='estimated'&&a.deduct?'（参考估算）':''}${item.ambiguous?' · 状态或单位待核对':!a.deduct&&!a.calibration&&a.source==='recorded'?' · 用量未知或库存不足，暂不更新':''}</p>`;}).join('')}</details><p class="consumption-source-notice">将从已登记库存按参考量扣减，新买直接使用的食材请修改来源。已调整项按你的确认处理。</p><p class="meta">${adjusted?'按确认用量':'按参考量'}更新${counts.update}项，另有${counts.skip}项保持不变${counts.add?`，补记新批次${counts.add}项`:''}。</p><p class="inline-error" id="consumption-error"></p><button class="primary-button full-button" type="submit">${label}</button><button type="button" class="text-button full-button" data-action="later-consumption">稍后再记</button></form>`);
}
function newPurchaseExceptionModal(){const draft=ensureConsumptionDraft(activeMeal());draft.editSection='new';consumptionModal();}
function completePage(){
  const result=mealPlan.lastCompleted;
  if(!result)return '<section class="card empty"><b>找不到本餐记录</b><button class="primary-button" data-action="recipe-discover">返回发现</button></section>';
  const counts=result.counts||{update:0,add:0,skip:0};
  const canUndo=!result.undone&&result.operationId&&(counts.update>0||counts.add>0);
  const resultMessage=result.undone?'库存已恢复到确认前的状态。':counts.update||counts.add?result.basis==='reference'?'已按参考量估算更新，数量可能与实物不同。':'已按你的确认更新库存。':'这次没有改动库存。';
  return `<section class="card completion-card"><h2>${result.undone?'本次更新已撤销':'这一餐记好了。'}</h2><p>${resultMessage}</p><p>${esc(result.recipe?.title||'本餐')}</p><div class="completion-counts"><span>${result.basis==='reference'?'按参考量':'按确认用量'}更新${counts.update}项</span><span>补记${counts.add}项</span><span>另有${counts.skip}项保持不变</span></div><div class="completion-actions"><button class="secondary-button" data-tab-go="inventory">看看我的冰箱</button><button class="primary-button" data-action="recipe-discover">返回发现</button></div>${canUndo?`<button class="text-button full-button" data-action="undo-cook" data-operation="${esc(result.operationId)}">撤销本次记账</button>`:''}</section>`;
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
  if(target.id==='tag-filter'){recipeTagFilter=target.value;render();return;}
  if(target.id==='source-filter'){recipeSourceFilter=target.value;render();return;}
  if(target.dataset.dishCooked){
    const active=activeMeal(),dish=active?.dishes.find(item=>item.recipe.id===target.dataset.dishCooked);
    if(dish){dish.cooked=target.checked;persist().catch(error=>toast(error.message));}
    return;
  }
  if(target.dataset.cookedDish){
    const active=activeMeal();
    if(active){
      const draft=ensureConsumptionDraft(active);
      updateConsumptionDraftFromForm();
      draft.cookedDishIds=[...document.querySelectorAll('[data-cooked-dish]:checked')].map(input=>input.dataset.cookedDish);
      // Shared reference amounts are derived again; explicit source and actual amounts remain unchanged.
      active.dishes.forEach(dish=>{dish.cooked=draft.cookedDishIds.includes(dish.recipe.id);});
      persist().then(consumptionModal).catch(error=>toast(error.message));
    }
    return;
  }
  if(target.dataset.newIngredient||target.dataset.quantityMode||target.dataset.remainingQuantity||target.name==='consumption-mode'||target.dataset.consumptionSource||target.dataset.consumptionQuantity||
     target.dataset.mixedQuantity||target.dataset.addLeftover!==undefined||target.dataset.leftoverQuantity){
    const active=activeMeal();
    if(active){
      updateConsumptionDraftFromForm();
      const scrollTop=modalLayer.querySelector('.modal')?.scrollTop||0;
      persist().then(()=>{consumptionModal();const modalNode=modalLayer.querySelector('.modal');if(modalNode)modalNode.scrollTop=scrollTop;}).catch(error=>toast(error.message));
    }
    return;
  }
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
    if(action==='toggle-favorite'){const id=target.dataset.id;state.favorites=state.favorites.includes(id)?state.favorites.filter(value=>value!==id):[...state.favorites,id];await persist();render();toast(state.favorites.includes(id)?'已收藏':'已取消收藏');return;}
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
    if(action==='apply-recipe-intent'){
      const ingredients=splitList(document.getElementById('intent-ingredients')?.value||'');
      const preference=String(document.getElementById('intent-preference')?.value||'').trim();
      const appliancesToAvoid=splitList(document.getElementById('intent-appliances')?.value||'');
      const methodsToAvoid=splitList(document.getElementById('intent-methods')?.value||'');
      mealPlan.request.allowAdditionalIngredients=document.getElementById('intent-allow-additional')?.checked===true;
      mealPlan.intent={...(mealPlan.intent||{}),ingredients,preference,dish:'',appliancesToAvoid,methodsToAvoid,sourceText:mealPlan.request.dish,explicitlyEdited:true};
      mealPlan.intentEditing=false;
      await refreshRecommendations();return;
    }
    if(action==='toggle-recipe-intent'){mealPlan.intentEditing=!mealPlan.intentEditing;render();return;}
    if(action==='recipe-section'){recipeSection=target.dataset.section;recipeScreen='browse';currentDetailId=null;render();return;}
    if(action==='open-meal-menu'){recipeScreen='menu';currentDetailId=null;currentTab='recipes';render();return;}
    if(action==='back-to-recipes'){recipeScreen='browse';render();return;}
    if(action==='add-menu-item'){addRecipeToMenu(target.dataset.id);return;}
    if(action==='choose-meal'){chooseRecommendedMeal(target.dataset.id);return;}
    if(action==='remove-menu-item'){removeRecipeFromMenu(target.dataset.id);return;}
    if(action==='add-another-dish'){recipeScreen='browse';recipeSection='discover';currentDetailId=null;render();return;}
    if(action==='replace-menu-item'){replaceMenuIndex=Number(target.dataset.index);recipeScreen='browse';recipeSection='discover';render();toast('选择一道菜替换本餐中的菜品');return;}
    if(action==='clear-menu'){mealPlan.menu=[];await persist();recipeScreen='browse';render();return;}
    if(action==='menu-shopping'){openMenuShopping();return;}
    if(action==='shopping-from-menu'){if(!mealPlan.menu.length){recipeSection='discover';render();}else openMenuShopping();return;}
    if(action==='start-cooking'){await startCooking();return;}
    if(action==='confirm-ready'){closeModal();await beginMealCooking();return;}
    if(action==='open-import'){openRecipeImport();return;}
    if(action==='edit-recipe-draft'){recipeEditorModal(target.dataset.id,true);return;}
    if(action==='edit-saved-recipe'){recipeEditorModal(target.dataset.id,false);return;}
    if(action==='parse-recipe-draft'){
      const form=document.getElementById('recipe-editor-form');
      const draft=state.recipeDrafts.find(item=>item.id===form?.dataset.id);
      if(!form||!draft)return;
      const current=recipeEditorValues(form);Object.assign(draft,current,{reviewStatus:'pending'});
      if(!draft.sourceUrl&&!draft.sourceText){toast('请填写来源链接或粘贴菜谱正文。');return;}
      await persist();target.disabled=true;target.textContent='正在解析…';
      await parseDraftWithDeepSeek(draft);recipeEditorModal(draft.id,true);return;
    }
    if(action==='save-recipe-draft'){const form=document.getElementById('recipe-editor-form');if(form)await saveRecipeEditor(form,false);return;}
    if(action==='delete-saved-recipe'){
      modal(`<h2>删除这道菜谱？</h2><p>删除后不会影响已加入本餐的菜谱快照。</p><div class="modal-actions"><button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-delete-recipe" data-id="${esc(target.dataset.id)}">删除</button></div>`);return;
    }
    if(action==='confirm-delete-recipe'){state.recipes=state.recipes.filter(item=>item.id!==target.dataset.id);mealPlan.menu=mealPlan.menu.filter(entry=>entry.recipeId!==target.dataset.id);await persist();closeModal();render();return;}
    if(action==='retry-recipe-image'){const image=target.parentElement.querySelector('img');if(image){target.parentElement.querySelector('.image-failed-label')?.remove();target.parentElement.classList.remove('image-failed');image.hidden=false;image.src=image.getAttribute('src');}return;}
    if(action==='show-help'){showHelp();return;}
    if(action==='close-modal'){closeModal();return;}
    if(action==='meal-preferences'){mealPreferenceModal();return;}
    if(action==='use-personal'){await usePersonalPreferences();return;}
    if(action==='consumption-section'||action==='edit-amount-item'){updateConsumptionDraftFromForm();const d=ensureConsumptionDraft(activeMeal());if(action==='consumption-section')d.editSection=target.dataset.section;else d.editKey=target.dataset.key;await persist();consumptionModal();return;}
    if(action==='edit-preferences'){captureRecipeInput();preferenceModal();return;}
    if(action==='meal-recommend'){currentTab='recipes';currentDetailId=null;mealPlan.request.dish='';explicitMeal='';defaultMeal=mealForDate(new Date());if(!activeMeal())mealPlan.roundMeal=defaultMeal;await refreshRecommendations();return;}
    if(action==='open-inventory'){inventoryModalForAction();return;}
    if(action==='edit-inventory'){inventoryModalForAction(target.dataset.id);return;}
    if(action==='inventory-location'){document.querySelectorAll('[data-action="inventory-location"]').forEach(button=>button.classList.toggle('active',button===target));document.getElementById('inventory-list').innerHTML=inventoryList(target.dataset.location);return;}
    if(action==='recipe-detail'){detailScrollPosition=window.scrollY;currentDetailId=target.dataset.id;recipeScreen='browse';currentTab='recipes';render();window.scrollTo(0,0);return;}
    if(action==='back-recipes'){currentDetailId=null;render();window.scrollTo(0,detailScrollPosition);return;}
    if(action==='select-meal'){addRecipeToMenu(target.dataset.id);return;}
    if(action==='continue-cooking'){recipeScreen=activeMeal()?.status==='awaiting_confirmation'?'cook-confirm':'cooking';render();if(activeMeal()?.status==='awaiting_confirmation')consumptionModal();return;}
    if(action==='view-step'){const active=activeMeal();if(active){active.stepIndex=Number(target.dataset.index);await persist();render();}return;}
    if(action==='previous-step'){const active=activeMeal();if(active){active.stepIndex=Math.max(0,active.stepIndex-1);await persist();recipeScreen='cooking';render();}return;}
    if(action==='next-step'){const active=activeMeal();if(active){const step=active.timeline[active.stepIndex];if(step){step.done=true;const dish=active.dishes[step.dishIndex];if(dish&&active.timeline.filter(item=>item.dishIndex===step.dishIndex).every(item=>item.done))dish.cooked=true;}active.stepIndex=Math.min(active.timeline.length,active.stepIndex+1);await persist();recipeScreen='cooking';render();}return;}
    if(action==='toggle-step-done'){const active=activeMeal(),step=active?.timeline[active.stepIndex];if(active&&step){step.done=false;const dish=active.dishes[step.dishIndex];if(dish)dish.cooked=false;await persist();render();}return;}
    if(action==='finish-cooking'){const latest=await api('/api/state');state=latest;mealPlan=state.mealPlan;const active=activeMeal();if(active){const early=active.status==='cooking'&&active.timeline.some(step=>!step.done);active.status='awaiting_confirmation';const d=ensureConsumptionDraft(active);if(early&&active.dishes.length>1)d.editSection='dishes';await persist();consumptionModal();}return;}
    if(action==='later-consumption'){const active=activeMeal();if(active){active.status='awaiting_confirmation';await persist();closeModal();recipeScreen='browse';currentTab='recipes';render();toast('已保存待确认状态，库存未变');}return;}
    if(action==='exit-cooking'){await persist();recipeScreen='menu';currentTab='recipes';render();toast('制作进度已保存');return;}
    if(action==='view-amounts'){const active=activeMeal();if(active)modal(`<h2>整餐参考用量</h2>${active.dishes.flatMap(dish=>dish.ingredients.map(item=>`<p>${esc(item.name)}：${item.quantity==null?'用量待确认':`${item.quantity} ${esc(item.unit)}`} · ${esc(dish.recipe.title)}</p>`)).join('')}<button class="primary-button full-button" data-action="close-modal">关闭</button>`);return;}
    if(action==='reset-meal'){confirmResetIfActive();return;}
    if(action==='confirm-reset'){await resetMeal();return;}
    if(action==='meal-mode'){captureRecipeInput();mealPlan.request.mode=target.dataset.mode;if(target.dataset.mode==='explore'&&!String(mealPlan.request.dish||'').trim()&&mealPlan.intent&&!mealPlan.intent.explicitlyEdited)mealPlan.intent.ingredients=[];await refreshRecommendations();if(mealPlan.menu.length)toast('本餐菜单已保留；采购建议可能需要重新核对');return;}
    if(action==='manual-mode'){const active=activeMeal();if(active){ensureConsumptionDraft(active).mode='manual';await persist();consumptionModal();}return;}
    if(action==='new-purchase-exception'){updateConsumptionDraftFromForm();newPurchaseExceptionModal();return;}
    if(action==='all-new-ingredients'){updateConsumptionDraftFromForm();const active=activeMeal();if(active){const draft=ensureConsumptionDraft(active);consumptionItems(active).forEach(item=>{draft.sources[item.key]='new';});await persist();consumptionModal();}return;}
    if(action==='purchase-source'){const active=activeMeal();if(active){ensureConsumptionDraft(active).sources[target.dataset.key]=target.dataset.source;await persist();consumptionModal();}return;}
    if(action==='partial-new-ingredients'){const list=document.querySelector('.partial-new-list');if(list){list.hidden=false;target.closest('.modal-actions').hidden=true;}return;}
    if(action==='save-partial-new'){const active=activeMeal();if(active){const draft=ensureConsumptionDraft(active);document.querySelectorAll('[data-new-ingredient]:checked').forEach(input=>{draft.sources[input.dataset.newIngredient]='new';});await persist();consumptionModal();}return;}
    if(action==='back-to-consumption'){consumptionModal();return;}
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
    if(action==='recipe-discover'){recipeScreen='browse';recipeSection='discover';currentTab='recipes';render();return;}
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
    if(form.id==='recipe-import-form'){await createImportDraft(form);return;}
    if(form.id==='recipe-editor-form'){await saveRecipeEditor(form,true);return;}
    if(form.id==='saved-recipe-search'){recipeSearch=String(new FormData(form).get('search')||'');render();return;}
    if(form.id==='inventory-search'){inventorySearch=String(new FormData(form).get('search')||'').trim();render();return;}
    if(form.id==='menu-shopping-form'){
      const missing=menuShoppingCandidates();
      const selected=[...form.querySelectorAll('[data-menu-buy]:checked')].map(input=>{
        const index=input.dataset.menuBuy,item=missing[Number(index)];
        const raw=String(form.querySelector(`[data-buy-quantity="${index}"]`)?.value||'').trim();
        const quantity=raw===''?null:Number(raw);
        const unit=String(form.querySelector(`[data-buy-unit="${index}"]`)?.value||'').trim();
        if(quantity!==null&&(!Number.isFinite(quantity)||quantity<=0))throw new Error(`请填写${item.name}的大于零的数量，或留空待确认。`);
        return {...item,purchaseQuantity:quantity,purchaseUnit:unit};
      });
      if(!selected.length)throw new Error('请勾选需要加入清单的食材。');
      for(const item of selected){
        if(state.shopping.some(line=>line.name===item.name&&line.status==='pending'))continue;
        state.shopping.push({id:`shop-${Date.now()}-${Math.random().toString(16).slice(2)}`,name:item.name,quantity:item.purchaseQuantity,unit:item.purchaseUnit,category:'其他',source:`本餐菜单 · ${item.stockGroup==='short'?'冰箱已有，预计补买':item.stockGroup==='unrecorded'?'冰箱未记录，待核对':'冰箱记录待核对'} · 参考数量`,mealId:mealPlan.active?.id||mealPlan.menuId||mealPlan.roundMeal,status:'pending',completedAt:''});
      }
      await persist();closeModal();shoppingTab='pending';if(currentTab==='recipes'){recipeSection='shopping';recipeScreen='browse';returnToMeal=false;}else{returnToMeal=true;currentTab='shopping';}render();toast('已加入你勾选的食材');return;
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
      const pendingId=pendingRecipeAction;pendingRecipeAction='';
      closeModal();
      await persist();
      if(recipeSection==='discover')await refreshRecommendations();else render();
      if(pendingId)addRecipeToMenu(pendingId);
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
      for(const dish of active.dishes)dish.cooked=draft.cookedDishIds.includes(dish.recipe.id);
      const items=consumptionItems(active);
      const consumption=[];
      const calibrations=[];
      const additions=[];
      let updatedItems=0,addedItems=0,skippedItems=0;
      for(const item of items){
        const source=draft.sources[item.key]||'recorded';
        const accounting=itemAccounting(item,draft),oldUse=accounting.oldUse;
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
        if(['new','mixed'].includes(source)&&draft.leftovers[item.key]){
          const value=draft.leftoverQuantities[item.key];
          const quantity=Number(value);
          if(!value||!Number.isFinite(quantity)||quantity<=0)throw new Error(`请填写${item.name}的新买剩余数量，或取消补记入库。`);
          const purchase=state.shopping.find(line=>line.name===item.name&&line.unit===item.unit&&['bought','archived'].includes(line.status));
          if(purchase&&state.inventory.some(stock=>stock.sourceShoppingId===purchase.id))throw new Error(`${item.name}对应的采购已入库，请按已记录库存处理，避免重复补记。`);
          additions.push({id:`inv-${Date.now()}-${addedItems}`,name:item.name,quantity,unit:item.unit,location:'冷藏',freshness:'新鲜',expiryDate:'',createdAt:today(),quantityBasis:'confirmed',quantityBasisUpdatedAt:new Date().toISOString(),origin:'new-purchase',mealId:active.id,sourceShoppingId:purchase?.id||''});
          addedItems++;
        }
      }
      const recipeTitle=active.dishes.filter(dish=>dish.cooked).map(dish=>dish.recipe.title).join(' + ')||'本餐';
      skippedItems=Math.max(0,items.length-updatedItems);
      const counts={update:updatedItems,add:addedItems,skip:skippedItems};
      const result=await api('/api/cook',{method:'POST',body:JSON.stringify({
        operationId:active.operationId,
        recipe:{title:recipeTitle,servings:active.servings},
        consumption,calibrations,additions,counts,quantityBasis:draft.mode==='reference'?'estimated':'confirmed'
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
loadState().catch(error=>{app.innerHTML=`<section class="card empty"><b>无法启动厨房管家</b><span>${esc(error.message)}</span></section>`;});
