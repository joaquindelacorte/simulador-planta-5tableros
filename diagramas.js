(() => {
  'use strict';

  const tabs = [...document.querySelectorAll('[data-tab]')];
  const panels = [...document.querySelectorAll('[data-panel]')];
  const validTabs = new Set(tabs.map((tab) => tab.dataset.tab));

  function activateTab(name, updateHash = true) {
    if (!validTabs.has(name)) name = 't1';

    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    panels.forEach((panel) => {
      const active = panel.dataset.panel === name;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });

    if (updateHash && window.location.hash !== `#${name}`) {
      history.replaceState(null, '', `#${name}`);
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      activateTab(tabs[nextIndex].dataset.tab);
      tabs[nextIndex].focus();
    });
  });

  window.addEventListener('hashchange', () => activateTab(window.location.hash.slice(1), false));
  activateTab(window.location.hash.slice(1) || 't1', false);
})();
