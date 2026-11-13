// Compatibility boundary: main owns home/inventory/profile; recipes own their document.
// Do not import recipe CSS or register recipe handlers in the main document.
(() => {
  const mainRender = render;
  const mainPersist = persist;
  let frame = null;
  let frameReady = false;
  let pendingDetail = null;
  let initialRoute = true;
  let requestSequence = 0;
  let navigationPending = false;
  const waiting = new Map();
  const host = document.createElement('section');
  host.id = 'recipe-host';
  host.hidden = true;
  document.querySelector('.phone-shell').append(host);

  function send(type, extra = {}) {
    frame?.contentWindow.postMessage({channel:'demo5018-recipes', type, ...extra}, location.origin);
  }
  function mount() {
    if (frame) return;
    frame = document.createElement('iframe');
    frame.title = '吃什么：推荐、我的菜谱与制作流程';
    frame.src = '/recipe.html';
    frame.allow = "microphone 'self'";
    host.append(frame);
  }
  function sendDetail() {
    if (!frameReady || !pendingDetail) return;
    send('open-detail', {recipeId:pendingDetail, returnTab});
    pendingDetail = null;
  }
  function flush() {
    if (!frameReady) return Promise.resolve();
    const id = ++requestSequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { waiting.delete(id); reject(new Error('菜谱进度尚未保存，请稍后重试。')); }, 12000);
      waiting.set(id, {resolve, reject, timeout});
      send('flush', {id});
    });
  }
  async function leave(tab) {
    if (navigationPending) return;
    navigationPending = true;
    try {
      await flush();
      // Read the committed inventory/profile before another module can edit it.
      state = await api('/api/state');
      currentTab = tab;
      selectedRecipe = null;
      returnTab = null;
      inventoryEntryView = null;
      photoPreviewUrl = '';
      render();
    } catch (error) { toast(error.message); }
    finally { navigationPending = false; }
  }
  render = function renderIntegratedApp() {
    if (!state) return;
    if (initialRoute) {
      initialRoute = false;
      const route = location.hash.slice(1);
      if (['home','inventory','recipes','shopping','profile'].includes(route)) currentTab = route;
    }
    const recipeView = currentTab === 'recipes';
    document.body.classList.toggle('recipe-view', recipeView);
    host.hidden = !recipeView;
    header.hidden = recipeView;
    app.hidden = recipeView;
    if (recipeView) {
      stopCamera();
      mount();
      send('activate', {returnTab});
      sendDetail();
      document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.tab === 'recipes'));
    } else mainRender();
    history.replaceState(null, '', `#${currentTab}`);
  };
  persist = async function persistMainModule() {
    await mainPersist();
    if (frameReady) send('refresh');
  };
  document.querySelector('[data-tab="recipes"] small').textContent = '吃什么';
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action],[data-tab],[data-tab-go]');
    if (!target) return;
    const destination = target.dataset.tab || target.dataset.tabGo;
    if (currentTab === 'recipes' && destination && destination !== 'recipes') {
      event.preventDefault(); event.stopImmediatePropagation();
      leave(destination);
    } else if (target.dataset.action === 'open-recipe') {
      event.preventDefault(); event.stopImmediatePropagation();
      pendingDetail = target.dataset.id;
      if (!modalLayer.hidden) closeModal();
      currentTab = 'recipes';
      render();
    }
  }, true);
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame?.contentWindow || event.data?.channel !== 'demo5018-recipes') return;
    const message = event.data;
    if (message.type === 'ready') {
      frameReady = true;
      send('activate', {returnTab});
      sendDetail();
    } else if (message.type === 'flushed') {
      const pending = waiting.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout); waiting.delete(message.id);
        message.error ? pending.reject(new Error(message.error)) : pending.resolve();
      }
    } else if (message.type === 'navigate' && ['home','inventory','profile','shopping'].includes(message.tab)) {
      leave(message.tab);
    }
  });
  window.addEventListener('hashchange', () => {
    const tab = location.hash.slice(1);
    if (!['home','inventory','recipes','shopping','profile'].includes(tab) || tab === currentTab) return;
    if (currentTab === 'recipes') leave(tab);
    else { currentTab = tab; render(); }
  });
})();
