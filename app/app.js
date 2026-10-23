const LAST_SEEN_VK_KEY = 'vk-last-seen';

function fmtDate(iso) {
  const d = new Date(iso.replace(' ', 'T'));
  const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm} ${hh}:${mi}, ${days[d.getDay()]}`;
}

function fmtUpdated(iso) {
  const d = new Date(iso);
  return `обновлено ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function loadJson(path) {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (err) {
    console.warn(`[load] ${path} failed, пробую кэш`, err);
    document.getElementById('offline-banner').classList.remove('hidden');
    const cache = await caches.open('data-cache');
    const cached = await cache.match(path);
    if (cached) return cached.json();
    return null;
  }
}

function renderAfisha(data) {
  const list = document.getElementById('afisha-list');
  if (!data || !data.performances?.length) {
    list.innerHTML = '<div class="empty">Афиша пока не загружена</div>';
    return;
  }
  document.getElementById('updated').textContent = fmtUpdated(data.updatedAt);

  list.innerHTML = data.performances
    .map((p) => {
      const conductor = p.conductors?.length ? p.conductors.join(', ') : 'не указан';
      const cast = (p.cast ?? [])
        .map((c) => `<div class="cast-row"><span class="cast-role">${c.role}</span><span class="cast-names">${c.names.join(', ')}</span></div>`)
        .join('');
      const ticketBadge = p.hasTickets
        ? '<span class="badge">билеты есть</span>'
        : '<span class="badge no-tickets">билетов нет</span>';

      return `
        <div class="card" data-id="${p.id}">
          <div class="card-head" onclick="this.closest('.card').classList.toggle('open')">
            <div>
              <div class="card-title">${p.spectacle.title}</div>
              <div class="card-sub">${p.spectacle.author ?? ''} · ${p.spectacle.genre ?? ''}</div>
              <div class="card-sub">${ticketBadge}<span class="badge">${p.spectacle.age ?? ''}</span></div>
            </div>
            <div class="card-date">${fmtDate(p.date)}</div>
          </div>
          <div class="card-details">
            <div class="conductor">Дирижёр: ${conductor}</div>
            ${cast}
            ${p.spectacle.description ? `<div class="description">${p.spectacle.description}</div>` : ''}
          </div>
        </div>`;
    })
    .join('');
}

function renderVk(data) {
  const list = document.getElementById('vk-list');
  if (!data || !data.posts?.length) {
    list.innerHTML = '<div class="empty">Нет данных ВК. Нужно настроить VK_TOKEN в GitHub Actions.</div>';
    return;
  }

  const lastSeen = Number(localStorage.getItem(LAST_SEEN_VK_KEY) ?? 0);
  let maxDate = lastSeen;

  list.innerHTML = data.posts
    .map((post) => {
      const ts = new Date(post.date).getTime();
      maxDate = Math.max(maxDate, ts);
      const isNew = ts > lastSeen;
      const photos = post.photos?.length
        ? `<div class="vk-photos">${post.photos.map((url) => `<img src="${url}" loading="lazy" alt="расписание">`).join('')}</div>`
        : '';

      return `
        <div class="card">
          <div class="card-sub">${fmtDate(post.date.replace('T', ' ').slice(0, 16))}${isNew ? '<span class="new-badge">новое</span>' : ''}</div>
          <div class="vk-text">${post.text || ''}</div>
          ${photos}
          <a class="vk-link" href="${post.postUrl}" target="_blank" rel="noopener">Открыть в ВК</a>
        </div>`;
    })
    .join('');

  localStorage.setItem(LAST_SEEN_VK_KEY, String(maxDate));
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

async function init() {
  setupTabs();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((err) => console.warn('SW register failed', err));
  }

  const [afisha, vk] = await Promise.all([loadJson('data/afisha.json'), loadJson('data/vk.json')]);
  renderAfisha(afisha);
  renderVk(vk);
}

init();
