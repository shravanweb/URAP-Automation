// Script injected into pages opened by the recorder. It listens for user actions, builds
// selector candidates for the target element, and reports them through the exposed binding
// window.__urapRecord(event). In "pick" mode a click is swallowed and only reported as a pick.
export const RECORDER_SCRIPT = String.raw`
(() => {
  if (window.__urapRecorderInstalled) return;
  window.__urapRecorderInstalled = true;
  if (window.__urapMode === undefined) window.__urapMode = 'record';
  const send = (event) => { try { window.__urapRecord && window.__urapRecord(event); } catch (e) {} };
  const cssEscape = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
  const unique = (selector) => { try { return document.querySelectorAll(selector).length === 1; } catch (e) { return false; } };
  const text = (el) => String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const looksGenerated = (value) => /\d{4,}|[a-f0-9]{8,}|^(ember|react|ng|mui|css)-/i.test(value);
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    return null;
  };
  const labelOf = (el) => {
    if (el.id) {
      const label = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
      if (label && text(label)) return text(label);
    }
    const parent = el.closest('label');
    if (parent && text(parent)) return text(parent);
    return el.getAttribute('aria-label') || '';
  };
  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      if (node.id && !looksGenerated(node.id)) { parts.unshift('#' + cssEscape(node.id)); break; }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  };
  const xpathOf = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.id && !looksGenerated(node.id)) { parts.unshift('//*[@id="' + node.id + '"]'); return parts.join('/'); }
      const parent = node.parentNode;
      const same = parent ? [...parent.children].filter((child) => child.tagName === node.tagName) : [];
      parts.unshift(node.tagName.toLowerCase() + (same.length > 1 ? '[' + (same.indexOf(node) + 1) + ']' : ''));
      node = parent;
    }
    return '/' + parts.join('/');
  };
  const candidatesFor = (el) => {
    const list = [];
    const tag = el.tagName.toLowerCase();
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test');
    if (testId && el.getAttribute('data-testid')) list.push({ selectorType: 'testid', selector: testId });
    else if (testId) list.push({ selectorType: 'css', selector: '[' + (el.hasAttribute('data-test-id') ? 'data-test-id' : 'data-test') + '="' + testId + '"]' });
    if (el.id && !looksGenerated(el.id) && unique('#' + cssEscape(el.id))) list.push({ selectorType: 'css', selector: '#' + cssEscape(el.id) });
    const role = roleOf(el);
    const name = (el.getAttribute('aria-label') || (['button', 'link'].includes(role) ? (text(el) || el.getAttribute('value') || '') : labelOf(el))).trim();
    if (role && name && name.length <= 60) list.push({ selectorType: 'role', selector: role + '[name="' + name.replace(/"/g, '\\"') + '"]' });
    if (['input', 'textarea', 'select'].includes(tag)) {
      const label = labelOf(el);
      if (label && label.length <= 60) list.push({ selectorType: 'label', selector: label });
      const nameAttr = el.getAttribute('name');
      if (nameAttr && unique(tag + '[name="' + nameAttr + '"]')) list.push({ selectorType: 'css', selector: tag + '[name="' + nameAttr + '"]' });
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) list.push({ selectorType: 'placeholder', selector: placeholder });
    } else {
      const visible = text(el);
      if (visible && visible.length <= 50 && !role) list.push({ selectorType: 'text', selector: visible });
    }
    list.push({ selectorType: 'css', selector: cssPath(el) });
    list.push({ selectorType: 'xpath', selector: xpathOf(el) });
    const seen = new Set();
    return list.filter((item) => { const key = item.selectorType + '|' + item.selector; if (seen.has(key)) return false; seen.add(key); return true; });
  };
  const describe = (el) => ({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', text: text(el).slice(0, 80), candidates: candidatesFor(el) });
  let highlight;
  const showHighlight = (el) => {
    if (!highlight) {
      highlight = document.createElement('div');
      highlight.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #e8590c;background:rgba(232,89,12,.12);z-index:2147483647;transition:all .05s';
      document.documentElement.appendChild(highlight);
    }
    const r = el.getBoundingClientRect();
    Object.assign(highlight.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', display: 'block' });
  };
  document.addEventListener('mouseover', (event) => { if (window.__urapMode === 'pick' && event.target instanceof Element) showHighlight(event.target); }, true);
  document.addEventListener('click', (event) => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el) return;
    if (window.__urapMode === 'pick') {
      event.preventDefault(); event.stopPropagation();
      send({ kind: 'pick', url: location.href, element: describe(el) });
      return;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'select' || tag === 'option') return;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'image'].includes(type)) return;
    if (tag === 'textarea') return;
    const target = el.closest('button, a, [role=button], [role=link], input, label, [onclick]') || el;
    send({ kind: 'click', url: location.href, element: describe(target) });
  }, true);
  // Typing is recorded as it happens (input events) so the step order matches what the user did;
  // the recorder merges consecutive fills of one field into a single Type Into step.
  const lastFill = new WeakMap();
  const isTextField = (el) => {
    const tag = el.tagName.toLowerCase();
    return tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'button', 'submit', 'file', 'reset', 'image'].includes((el.getAttribute('type') || 'text').toLowerCase()));
  };
  const sendFill = (el) => {
    if (lastFill.get(el) === el.value) return;
    lastFill.set(el, el.value);
    const secret = (el.getAttribute('type') || '').toLowerCase() === 'password';
    send({ kind: 'fill', url: location.href, value: secret ? '' : el.value, secret, element: describe(el) });
  };
  document.addEventListener('input', (event) => {
    const el = event.target;
    if (!(el instanceof Element) || window.__urapMode === 'pick' || !isTextField(el)) return;
    sendFill(el);
  }, true);
  document.addEventListener('change', (event) => {
    const el = event.target;
    if (!(el instanceof Element) || window.__urapMode === 'pick') return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      const option = el.selectedOptions && el.selectedOptions[0];
      send({ kind: 'select', url: location.href, value: el.value, label: option ? text(option) : '', element: describe(el) });
    } else if (isTextField(el)) {
      sendFill(el);
    }
  }, true);
  document.addEventListener('keydown', (event) => {
    if (window.__urapMode === 'pick') return;
    if (event.key === 'Enter' && event.target instanceof Element && ['input'].includes(event.target.tagName.toLowerCase())) {
      const el = event.target;
      const secret = (el.getAttribute('type') || '').toLowerCase() === 'password';
      send({ kind: 'enter', url: location.href, value: secret ? '' : el.value, secret, element: describe(el) });
    }
  }, true);
})();
`;
