const recipeLibrary = [
  {
    id:'tomato-egg-pancake',title:'番茄鸡蛋饼',subtitle:'早餐快手饼',mealTypes:['breakfast'],duration:15,waitMinutes:0,
    difficulty:'简单',appliances:['平底锅','灶台'],tags:['快手','临期优先'],reason:'优先使用临期番茄和现有鸡蛋，少量操作即可完成早餐。',
    imageUrl:'',imageAlt:'番茄鸡蛋饼成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'番茄',quantity:1,unit:'个'},{name:'鸡蛋',quantity:2,unit:'个'}],
    steps:['番茄洗净切小丁，鸡蛋打散。','将番茄丁拌入蛋液。','平底锅小火煎至两面熟透。']
  },
  {
    id:'banana-milk-oats',title:'香蕉牛奶燕麦碗',subtitle:'无需开火的早餐',mealTypes:['breakfast'],duration:8,waitMinutes:0,
    difficulty:'简单',appliances:['碗'],tags:['免开火'],reason:'准备简单，适合早晨快速搭配；库存数量需先确认。',
    imageUrl:'',imageAlt:'香蕉牛奶燕麦碗成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'香蕉',quantity:1,unit:'根'},{name:'牛奶',quantity:200,unit:'ml'},{name:'燕麦',quantity:40,unit:'g'}],
    auxiliaries:[{name:'坚果',quantity:null,unit:'适量',optional:true,category:'auxiliary',usedInSteps:['第3步']}],
    steps:['香蕉切片放入碗中。','加入燕麦和牛奶拌匀。','静置片刻后食用，也可按口味加入坚果。']
  },
  {
    id:'broccoli-egg-pancake',title:'西兰花鸡蛋饼',subtitle:'蔬菜早餐饼',mealTypes:['breakfast','snack'],duration:18,waitMinutes:0,
    difficulty:'简单',appliances:['平底锅','灶台'],tags:['临期优先','少步骤'],reason:'把建议优先食用的西兰花做成简单主食。',
    imageUrl:'',imageAlt:'西兰花鸡蛋饼成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'西兰花',quantity:0.5,unit:'颗'},{name:'鸡蛋',quantity:2,unit:'个'}],
    steps:['西兰花切碎，焯水后沥干。','鸡蛋打散后与西兰花拌匀。','平底锅小火煎熟即可。']
  },
  {
    id:'egg-rice-breakfast',title:'鸡蛋蔬菜炒饭',subtitle:'鸡蛋、蔬菜和米饭一锅搭配',mealTypes:['breakfast','lunch'],duration:15,waitMinutes:0,
    difficulty:'简单',appliances:['炒锅','灶台'],tags:['快手','库存友好'],reason:'用现有鸡蛋和大米搭配蔬菜，步骤少、易调整份量。',
    imageUrl:'',imageAlt:'鸡蛋蔬菜炒饭成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'鸡蛋',quantity:1,unit:'个'},{name:'大米',quantity:120,unit:'g'},{name:'西兰花',quantity:0.25,unit:'颗'}],
    steps:['米饭煮熟备用，西兰花切碎焯水。','鸡蛋炒至凝固后加入米饭。','加入西兰花翻炒均匀。']
  },
  {
    id:'tomato-egg-rice',title:'番茄鸡蛋盖饭',subtitle:'酸甜家常午餐',mealTypes:['lunch','dinner'],duration:22,waitMinutes:0,
    difficulty:'简单',appliances:['炒锅','灶台'],tags:['临期优先','库存友好'],reason:'优先使用临期番茄，搭配现有鸡蛋和大米。',
    imageUrl:'',imageAlt:'番茄鸡蛋盖饭成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'番茄',quantity:2,unit:'个'},{name:'鸡蛋',quantity:2,unit:'个'},{name:'大米',quantity:150,unit:'g'}],
    steps:['大米洗净煮熟，番茄切块、鸡蛋打散。','鸡蛋炒熟后盛出，番茄炒软出汁。','加入鸡蛋翻匀，浇在米饭上。']
  },
  {
    id:'chicken-broccoli-rice',title:'西兰花鸡胸肉饭',subtitle:'鸡胸肉、清炒西兰花和米饭',mealTypes:['lunch','dinner'],duration:25,waitMinutes:15,
    difficulty:'简单',appliances:['炒锅','灶台'],tags:['临期优先','高蛋白'],reason:'优先使用临期西兰花，搭配鸡胸肉和米饭组成一餐。',
    imageUrl:'',imageAlt:'西兰花鸡胸肉饭成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'鸡胸肉',quantity:160,unit:'g'},{name:'西兰花',quantity:1,unit:'颗'},{name:'大米',quantity:150,unit:'g'}],
    steps:['鸡胸肉需解冻，米饭洗净后开始烹煮。','西兰花切小朵焯水；鸡胸肉切块炒熟。','加入西兰花略炒，配米饭食用。']
  },
  {
    id:'chicken-carrot-rice',title:'鸡胸肉胡萝卜饭',subtitle:'鸡胸肉、胡萝卜和米饭',mealTypes:['lunch','dinner'],duration:30,waitMinutes:15,
    difficulty:'简单',appliances:['炒锅','灶台'],tags:['高蛋白'],reason:'主菜、蔬菜和主食搭配完整；胡萝卜库存状态需确认。',
    imageUrl:'',imageAlt:'鸡胸肉胡萝卜饭成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'鸡胸肉',quantity:160,unit:'g'},{name:'胡萝卜',quantity:1,unit:'根'},{name:'大米',quantity:150,unit:'g'}],
    steps:['鸡胸肉解冻切块，胡萝卜切片，米饭煮熟。','鸡胸肉炒至熟透，加入胡萝卜炒软。','配米饭装盘。']
  },
  {
    id:'broccoli-egg-rice',title:'西兰花鸡蛋饭',subtitle:'清炒西兰花、鸡蛋和米饭',mealTypes:['lunch','dinner'],duration:22,waitMinutes:0,
    difficulty:'简单',appliances:['炒锅','灶台'],tags:['临期优先','家常搭配'],reason:'先安排即将到期的西兰花，并用现有鸡蛋和大米搭配。',
    imageUrl:'',imageAlt:'西兰花鸡蛋饭成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'西兰花',quantity:0.75,unit:'颗'},{name:'鸡蛋',quantity:2,unit:'个'},{name:'大米',quantity:150,unit:'g'}],
    steps:['大米煮熟，西兰花切小朵焯水。','鸡蛋炒熟后盛出，西兰花炒至断生。','加入鸡蛋翻匀，搭配米饭。']
  },
  {
    id:'tomato-egg-dinner',title:'番茄炒蛋配米饭',subtitle:'番茄炒蛋与热米饭',mealTypes:['dinner','lunch'],duration:20,waitMinutes:0,
    difficulty:'简单',appliances:['炒锅','灶台'],tags:['临期优先','家常菜'],reason:'家常快手搭配，优先使用临期番茄。',
    imageUrl:'',imageAlt:'番茄炒蛋配米饭成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'番茄',quantity:2,unit:'个'},{name:'鸡蛋',quantity:3,unit:'个'},{name:'大米',quantity:150,unit:'g'}],
    steps:['大米洗净煮熟；番茄切块、鸡蛋打散。','鸡蛋炒熟后盛出，番茄炒软。','加入鸡蛋翻炒调味，搭配米饭食用。']
  },
  {
    id:'chicken-broccoli-skillet',title:'鸡胸肉西兰花炒饭',subtitle:'鸡胸肉、西兰花和米饭一锅搭配',mealTypes:['dinner','lunch'],duration:30,waitMinutes:15,
    difficulty:'简单',appliances:['炒锅','灶台'],tags:['临期优先','高蛋白'],reason:'利用临期西兰花和现有鸡胸肉，米饭可按需搭配。',
    imageUrl:'',imageAlt:'鸡胸肉西兰花炒饭成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'鸡胸肉',quantity:140,unit:'g'},{name:'西兰花',quantity:0.75,unit:'颗'},{name:'大米',quantity:160,unit:'g'}],
    steps:['鸡胸肉解冻，米饭煮熟备用。','西兰花切小朵焯水，鸡胸肉切块炒熟。','加入米饭和西兰花翻炒调味。']
  },
  {
    id:'egg-fried-rice-dinner',title:'鸡蛋炒饭配清炒西兰花',subtitle:'鸡蛋炒饭和一份蔬菜',mealTypes:['dinner','lunch'],duration:25,waitMinutes:0,
    difficulty:'简单',appliances:['炒锅','灶台'],tags:['库存友好','一锅料理'],reason:'鸡蛋炒饭搭配蔬菜，适合用现有库存安排家常晚餐。',
    imageUrl:'',imageAlt:'鸡蛋炒饭配清炒西兰花成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'鸡蛋',quantity:2,unit:'个'},{name:'大米',quantity:180,unit:'g'},{name:'西兰花',quantity:0.5,unit:'颗'}],
    steps:['米饭煮好备用，西兰花焯水。','鸡蛋炒熟后加入米饭炒散。','西兰花另锅清炒或与米饭一同装盘。']
  },
  {
    id:'warm-milk-banana',title:'温牛奶配香蕉',subtitle:'小份宵夜，无需复杂烹饪',mealTypes:['snack','breakfast'],duration:5,waitMinutes:0,
    difficulty:'简单',appliances:['微波炉或奶锅'],tags:['小份','少步骤'],reason:'份量小、操作简单，适合宵夜；食材库存需确认。',
    imageUrl:'',imageAlt:'温牛奶配香蕉成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'牛奶',quantity:150,unit:'ml'},{name:'香蕉',quantity:0.5,unit:'根'}],
    steps:['牛奶用奶锅或微波炉温热，避免煮沸溢出。','香蕉切片，与温牛奶一同食用。']
  },
  {
    id:'small-egg-rice',title:'小份鸡蛋饭',subtitle:'简单温热的宵夜主食',mealTypes:['snack'],duration:12,waitMinutes:0,
    difficulty:'简单',appliances:['炒锅','灶台'],tags:['小份','快手'],reason:'一人小份，使用少量鸡蛋和米饭快速完成。',
    imageUrl:'',imageAlt:'小份鸡蛋饭成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'鸡蛋',quantity:1,unit:'个'},{name:'大米',quantity:80,unit:'g'}],
    steps:['大米煮熟，鸡蛋打散。','鸡蛋炒熟后配少量米饭食用。']
  },
  {
    id:'tomato-egg-soup-snack',title:'番茄蛋花汤',subtitle:'小碗热汤，清爽少量',mealTypes:['snack','lunch'],duration:12,waitMinutes:0,
    difficulty:'简单',appliances:['汤锅','灶台'],tags:['小份','临期优先'],reason:'小份热汤优先使用临期番茄，步骤简单。',
    imageUrl:'',imageAlt:'番茄蛋花汤成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'番茄',quantity:1,unit:'个'},{name:'鸡蛋',quantity:1,unit:'个'}],
    steps:['番茄切块，加水煮至软。','鸡蛋打散，缓慢倒入汤中。','蛋液凝固后调味即可。']
  },
  {
    id:'broccoli-egg-small',title:'西兰花鸡蛋小煎饼',subtitle:'一人份小煎饼',mealTypes:['snack','breakfast'],duration:15,waitMinutes:0,
    difficulty:'简单',appliances:['平底锅','灶台'],tags:['小份','临期优先'],reason:'小份使用临期西兰花，准备和烹饪步骤都较少。',
    imageUrl:'',imageAlt:'西兰花鸡蛋小煎饼成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'西兰花',quantity:0.3,unit:'颗'},{name:'鸡蛋',quantity:1,unit:'个'}],
    steps:['西兰花切碎焯水。','与鸡蛋拌匀，平底锅小火煎熟。']
  },
  {
    id:'plain-egg-omelet',title:'家常鸡蛋饼',subtitle:'少量食材的简易早餐',mealTypes:['breakfast','snack'],duration:10,waitMinutes:0,
    difficulty:'简单',appliances:['平底锅','灶台'],tags:['快手','少步骤'],reason:'步骤少、份量容易调整；调味与配料按个人偏好确认。',
    imageUrl:'',imageAlt:'家常鸡蛋饼成品实拍图',imageSource:'',imageCredit:'',imageLicense:'',
    ingredients:[{name:'鸡蛋',quantity:2,unit:'个'},{name:'面粉',quantity:30,unit:'g'}],
    steps:['鸡蛋打散，加入面粉和适量清水搅匀。','平底锅少油加热，倒入蛋糊摊平。','小火煎熟后切块。']
  }
];

recipeLibrary.forEach(recipe=>{
  recipe.ingredients=(recipe.ingredients||[]).map(ingredient=>({
    category:'main',
    ...ingredient,
    form:ingredient.name==='大米'?'生米':ingredient.form,
    usedInSteps:(recipe.steps||[]).reduce((indexes,step,index)=>{
      const text=typeof step==='string'?step:step.text||'';
      const matches=text.includes(ingredient.name)||
        ingredient.name==='大米'&&/米饭|大米|煮饭/.test(text);
      if(matches)indexes.push(`第${index+1}步`);
      return indexes;
    },[])
  }));
  recipe.auxiliaries=recipe.auxiliaries||[];
  recipe.seasonings=recipe.seasonings||[];
  const stepTexts=(recipe.steps||[]).map(step=>typeof step==='string'?step:step.text||'');
  const waterSteps=stepTexts.reduce((indexes,text,index)=>{
    if(/加水|煮饭|大米.*煮|米饭.*煮|煮至/.test(text))indexes.push(`第${index+1}步`);
    return indexes;
  },[]);
  if(waterSteps.length&&!recipe.auxiliaries.some(item=>item.name==='清水')){
    recipe.auxiliaries.push({name:'清水',quantity:null,unit:'待确认',optional:false,suggestion:true,quantityType:'unknown',category:'auxiliary',usedInSteps:waterSteps});
  }
  const oilSteps=stepTexts.reduce((indexes,text,index)=>{
    if(/煎|炒|少油|加油/.test(text))indexes.push(`第${index+1}步`);
    return indexes;
  },[]);
  const seasoningSteps=stepTexts.reduce((indexes,text,index)=>{
    if(/调味|适量盐|加盐|食盐/.test(text))indexes.push(`第${index+1}步`);
    return indexes;
  },[]);
  if(oilSteps.length&&!recipe.seasonings.some(item=>item.name==='食用油')){
    recipe.seasonings.push({name:'食用油',quantity:null,unit:'适量',optional:true,suggestion:true,quantityType:'suggested',category:'seasoning',usedInSteps:oilSteps});
  }
  if(seasoningSteps.length&&!recipe.seasonings.some(item=>item.name==='食盐')){
    recipe.seasonings.push({name:'食盐',quantity:null,unit:'适量',optional:true,suggestion:true,quantityType:'suggested',category:'seasoning',usedInSteps:seasoningSteps});
  }
  recipe.steps=(recipe.steps||[]).map((rawStep,index)=>{
    const step=typeof rawStep==='string'?{title:`第 ${index+1} 步`,text:rawStep}:rawStep;
    const listed=[...(recipe.ingredients||[]),...(recipe.auxiliaries||[]),...(recipe.seasonings||[])]
      .filter(item=>item.usedInSteps.includes(`第${index+1}步`))
      .map(item=>`${item.name}${item.form?`（${item.form}）`:''}${item.quantity==null?'':` ${item.quantity} ${item.unit||''}`}`);
    return {...step,ingredients:step.ingredients?.length?step.ingredients:listed};
  });
});
