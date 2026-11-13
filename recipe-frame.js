// Read-only adapters reuse main's naming and freshness rules without importing its UI.
window.RecipeStockBridge = {
  canonicalName(name) { return parent.findFoodKnowledge?.(name)?.canonical_name || name; },
  freshness(item) { return parent.freshnessFor?.(item); }
};
// Runs only inside recipe.html; shared data is exchanged through the server,
// never through a second localStorage or a second inventory database.
window.recipeFrameReady = () => {
  const channel = 'demo5018-recipes';
  const send = (type, extra={}) => parent.postMessage({channel,type,...extra}, location.origin);
  const syncHomeReturn = () => requestAnimationFrame(() => {
    if (returnTab !== 'home' || !currentDetailId) return;
    document.querySelectorAll('[data-action="back-recipes"].back-link').forEach(button => {
      button.textContent = '‹ 返回首页';
    });
  });
  let refreshing = Promise.resolve();
  const reloadSharedState = () => {
    refreshing = refreshing.catch(()=>{}).then(async () => {
      await persistenceQueue;
      const latest = await api('/api/state');
      state = latest;
      ensurePlan();
      render();
    });
    return refreshing;
  };
  window.addEventListener('message', async event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== channel) return;
    const message = event.data;
    try {
      if (message.type === 'flush') {
        stopSpeechRecognition(true);
        if (recommendationController) {
          recommendationController.abort();
          recommendationController = null;
          recommendationGeneration++;
          recommendationLoading = false;
        }
        await refreshing;
        await persistenceQueue;
        send('flushed', {id:message.id});
      } else if (message.type === 'refresh' || message.type === 'activate') {
        if (message.type === 'activate') returnTab = message.returnTab || null;
        await reloadSharedState();
        syncHomeReturn();
      } else if (message.type === 'open-detail') {
        await refreshing;
        returnTab = message.returnTab || returnTab;
        if (recipeById(message.recipeId)) {
          currentDetailId = message.recipeId;
          recipeScreen = 'browse';
          render();
          syncHomeReturn();
          window.scrollTo(0,0);
        } else toast('这道菜已更新，请重新选择。');
      }
    } catch (error) {
      if (message.type === 'flush') send('flushed',{id:message.id,error:error.message});
      else toast(error.message);
    }
  });
  document.addEventListener('click', event => {
    const homeBack = event.target.closest('[data-action="back-recipes"]');
    if (homeBack && returnTab === 'home' && currentDetailId) {
      event.preventDefault(); event.stopImmediatePropagation();
      currentDetailId = null;
      send('navigate',{tab:'home'});
      return;
    }
    const target = event.target.closest('[data-tab],[data-tab-go],[data-action="back-to-profile"]');
    if (!target) return;
    const tab = target.dataset.tab || target.dataset.tabGo || 'profile';
    if (tab === 'recipes') return;
    event.preventDefault(); event.stopImmediatePropagation();
    send('navigate',{tab});
  }, true);
  send('ready');
};
