const el = (id) => document.getElementById(id);

let account = null;
let lists = [];
// Turnstile state. The widget can only be rendered once its container is
// visible, so loading the script and rendering the widget are separate steps.
const turnstile = { siteKey: '', scriptReady: false, widget: null, token: '' };

// --- API --------------------------------------------------------------------

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* empty body */ }
  if (!response.ok) {
    const error = new Error(payload.error ?? 'Something went wrong.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

// --- Rendering --------------------------------------------------------------

// The cycle count only earns space on the row once there is one.
function progressLabel(list) {
  const through = `${list.position} of ${list.total}`;
  if (list.cycles === 0) return through;
  return `${through} · ${list.cycles} ${list.cycles === 1 ? 'cycle' : 'cycles'}`;
}

function card(list) {
  const node = document.createElement('article');
  node.className = 'list';
  node.dataset.list = String(list.list);

  const heading = document.createElement('p');
  heading.className = 'list-name';
  const number = document.createElement('span');
  number.className = 'list-no';
  number.textContent = list.list;
  const name = document.createElement('span');
  name.textContent = list.name;
  heading.append(number, name);

  const reference = document.createElement('p');
  reference.className = 'reference';
  reference.textContent = list.reference;

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = progressLabel(list);

  const read = document.createElement('button');
  read.type = 'button';
  read.className = 'primary';
  read.dataset.action = 'read';
  read.textContent = 'Mark read';
  // Ten identical buttons need distinguishing for screen readers.
  read.setAttribute('aria-label', `Mark ${list.reference} read in ${list.name}`);

  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'undo';
  undo.dataset.action = 'undo';
  undo.textContent = '\u21ba';
  undo.hidden = !list.canUndo;
  undo.title = 'Undo the last chapter marked read';
  undo.setAttribute('aria-label', `Undo the last chapter marked read in ${list.name}`);

  const footer = document.createElement('div');
  footer.className = 'footer';
  footer.append(meta, undo);

  const detail = document.createElement('div');
  detail.className = 'detail';
  detail.append(heading, reference, footer);

  node.append(detail, read);
  return node;
}

function render() {
  const container = el('lists');
  container.replaceChildren(...lists.map(card));
  el('account-id').textContent = account;
}

function replaceCard(list) {
  lists = lists.map((existing) => (existing.list === list.list ? list : existing));
  const current = el('lists').querySelector(`[data-list="${list.list}"]`);
  if (current) current.replaceWith(card(list));
}

function toast(message) {
  let node = el('toast');
  if (!node) {
    node = document.createElement('p');
    node.id = 'toast';
    node.setAttribute('role', 'status');
    Object.assign(node.style, {
      position: 'fixed', left: '50%', bottom: '1.25rem', transform: 'translateX(-50%)',
      background: 'var(--ink)', color: 'var(--paper)', padding: '0.6rem 1rem',
      borderRadius: '7px', fontSize: '0.85rem', maxWidth: '90vw', textAlign: 'center',
      margin: '0', zIndex: '10',
    });
    document.body.append(node);
  }
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 3200);
}

// --- Screens ----------------------------------------------------------------

function showApp() {
  el('gate').hidden = true;
  el('app').hidden = false;
  render();
}

function showGate() {
  el('app').hidden = true;
  el('gate').hidden = false;
  loadTurnstile();
}

// --- Actions ----------------------------------------------------------------

async function act(listNo, action, button) {
  const buttons = button.closest('.list').querySelectorAll('button');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const { list } = await api(`/api/${action}`, { method: 'POST', body: { list: listNo } });
    replaceCard(list);
  } catch (error) {
    if (error.status === 401) { showGate(); return; }
    toast(error.message);
    buttons.forEach((b) => { b.disabled = false; });
  }
}

el('lists').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const listNo = Number(button.closest('.list').dataset.list);
  act(listNo, button.dataset.action, button);
});

el('signout').addEventListener('click', async () => {
  await api('/api/signout', { method: 'POST' }).catch(() => {});
  account = null;
  lists = [];
  showGate();
});

// --- Gate -------------------------------------------------------------------

function selectTab(which) {
  const signingIn = which === 'signin';
  el('tab-signin').setAttribute('aria-selected', String(signingIn));
  el('tab-signup').setAttribute('aria-selected', String(!signingIn));
  el('form-signin').hidden = !signingIn;
  el('form-signup').hidden = signingIn;
}

el('tab-signin').addEventListener('click', () => selectTab('signin'));
el('tab-signup').addEventListener('click', () => {
  selectTab('signup');
  renderTurnstile();
});

function showError(id, message) {
  const node = el(id);
  node.textContent = message;
  node.hidden = !message;
}

el('form-signin').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('signin-error', '');
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api('/api/signin', {
      method: 'POST',
      body: { id: el('signin-id').value, passphrase: el('signin-pass').value },
    });
    account = result.id;
    lists = result.lists;
    el('signin-pass').value = '';
    showApp();
  } catch (error) {
    showError('signin-error', error.message);
  } finally {
    button.disabled = false;
  }
});

el('form-signup').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('signup-error', '');
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    let token;
    if (turnstile.siteKey) {
      token = turnstile.token || (turnstile.widget !== null ? window.turnstile.getResponse(turnstile.widget) : '');
      if (!token) {
        showError('signup-error', 'Still waiting on the verification challenge. Give it a moment and try again.');
        return;
      }
    }
    const result = await api('/api/signup', {
      method: 'POST',
      body: { passphrase: el('signup-pass').value, turnstileToken: token },
    });
    account = result.id;
    lists = result.lists;
    el('signup-pass').value = '';
    el('issued-id').textContent = result.id;
    el('issued').hidden = false;
    showApp();
  } catch (error) {
    showError('signup-error', error.message);
    // Tokens are single use, so a retry needs a fresh challenge.
    turnstile.token = '';
    if (turnstile.widget !== null) window.turnstile.reset(turnstile.widget);
  } finally {
    button.disabled = false;
  }
});

el('issued-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el('issued-id').textContent);
    toast('ID copied to the clipboard.');
  } catch {
    toast('Copy failed. Select the ID and copy it by hand.');
  }
});

el('issued-ack').addEventListener('click', () => { el('issued').hidden = true; });

// Turnstile is only wired up when a site key is configured on the Worker.
async function loadTurnstile() {
  if (turnstile.siteKey || window.turnstileLoading) return;
  const { turnstileSiteKey } = await api('/api/config').catch(() => ({}));
  if (!turnstileSiteKey) return;
  turnstile.siteKey = turnstileSiteKey;
  window.turnstileLoading = true;
  window.onTurnstileReady = () => {
    turnstile.scriptReady = true;
    renderTurnstile();
  };
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileReady';
  script.async = true;
  script.addEventListener('error', () => {
    showError('signup-error', 'The verification challenge could not be loaded. Check your connection and reload.');
  });
  document.head.append(script);
}

// Rendering into a hidden container leaves the challenge unable to run, and so
// never produces a token. Only render once the signup form is actually shown.
function renderTurnstile() {
  if (!turnstile.scriptReady || turnstile.widget !== null) return;
  if (el('form-signup').hidden) return;
  try {
    turnstile.widget = window.turnstile.render('#turnstile', {
      sitekey: turnstile.siteKey,
      // The server requires this to match, so a token solved against some
      // other widget cannot be spent here.
      action: 'signup',
      theme: 'auto',
      callback: (token) => {
        turnstile.token = token;
        showError('signup-error', '');
      },
      'expired-callback': () => { turnstile.token = ''; },
      'error-callback': (code) => {
        turnstile.token = '';
        // Surfacing the code matters: a hostname missing from the widget's
        // allow list looks identical to a network problem without it.
        showError('signup-error', `Verification failed to load${code ? ` (${code})` : ''}. Reload the page and try again.`);
        return true;
      },
    });
  } catch (error) {
    showError('signup-error', 'Verification could not start. Reload the page and try again.');
  }
}

// --- Boot -------------------------------------------------------------------

(async function boot() {
  try {
    const result = await api('/api/state');
    account = result.id;
    lists = result.lists;
    showApp();
  } catch {
    showGate();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}());
