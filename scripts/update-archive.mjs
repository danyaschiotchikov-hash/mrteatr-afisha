// Тянет список папок-записей спектаклей с публичного Яндекс.Диска (только чтение,
// официальное публичное REST API, токен не нужен) и сопоставляет их с афишей —
// чтобы в карточке спектакля можно было открыть видеозапись конкретного показа.

const PUBLIC_KEY = 'https://disk.yandex.ru/d/VdZkIGtNvMAOuw';
const API = 'https://cloud-api.yandex.net/v1/disk/public/resources';

// У вложенных папок поле public_url в API часто отсутствует, но прямая ссылка
// вида "<публичная_ссылка>/<путь>" всегда открывает нужную папку в интерфейсе Диска.
function folderUrl(path) {
  return PUBLIC_KEY + path.split('/').map(encodeURIComponent).join('/');
}

// Папки верхнего уровня, где лежат записи самих спектаклей (не репетиций/лекций/концертов).
const CATEGORIES = ['Опера', 'Балет', 'Балет в опере'];

// Название папки на Диске — это "YYYY MM DD Название". Название там часто сокращено
// или пишется иначе, чем в афише на сайте (например "Мистер Х" вместо "Мистер Икс"),
// поэтому сверяем по нормализованному ключу + вручную прописанным синонимам.
const ALIASES = {
  'мистер х': 'мистер икс',
  'фигаро': 'свадьба фигаро',
  'зимняя сказка гала опера 2022': 'рождественский гала-концерт',
};

export function normalize(title) {
  let t = title
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[«»"'.,!?:;]/g, ' ')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIASES[t] ?? t;
}

const FOLDER_NAME_RE = /^(\d{4})[ .](\d{2})[ .](\d{2})\s+(.+)$/;

async function fetchAllItems(path) {
  const items = [];
  let offset = 0;
  const limit = 200;
  for (;;) {
    const url = `${API}?public_key=${encodeURIComponent(PUBLIC_KEY)}&path=${encodeURIComponent(path)}&limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    const data = await res.json();
    const batch = data._embedded?.items ?? [];
    items.push(...batch);
    offset += limit;
    if (offset >= (data._embedded?.total ?? 0)) break;
  }
  return items;
}

export async function buildArchive() {
  const recordings = [];

  for (const category of CATEGORIES) {
    let items;
    try {
      items = await fetchAllItems(`/${category}`);
    } catch (err) {
      console.error(`[archive] ${category}: ${err.message}`);
      continue;
    }

    for (const item of items) {
      if (item.type !== 'dir') continue;
      const m = item.name.match(FOLDER_NAME_RE);
      if (!m) continue;
      const [, y, mo, d, rawTitle] = m;
      recordings.push({
        date: `${y}-${mo}-${d}`,
        title: rawTitle.trim(),
        key: normalize(rawTitle),
        category,
        url: folderUrl(item.path),
      });
    }
  }

  recordings.sort((a, b) => a.date.localeCompare(b.date));

  return {
    updatedAt: new Date().toISOString(),
    source: PUBLIC_KEY,
    recordings,
  };
}

if (process.argv[1]?.endsWith('update-archive.mjs')) {
  const fs = await import('node:fs/promises');
  const result = await buildArchive();
  await fs.writeFile('app/data/archive.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log(`[archive] saved ${result.recordings.length} recordings`);
}
