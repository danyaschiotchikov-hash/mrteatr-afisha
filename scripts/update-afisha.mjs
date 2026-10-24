// Тянет афишу с mrteatr.ru: список спектаклей + состав/дирижёра на конкретную дату.
// Публичный JSON API театра (найден в сетевых запросах сайта), парсинг HTML не нужен.

import { buildArchive, normalize } from './update-archive.mjs';

const BASE = 'https://mrteatr.ru';

// Название спектакля в афише и название папки с записью на Диске совпадают не всегда
// дословно ("Мистер Икс" / "Мистер Х", "Кошкин дом. Гастроли" / "Кошкин дом").
// Сначала ищем точное совпадение нормализованного названия, а если его нет —
// совпадение по вхождению подстроки, предпочитая более длинное (точное) совпадение.
function findRecordings(spectacleTitle, recordings, recordingKeys) {
  const key = normalize(spectacleTitle);

  if (recordingKeys.has(key)) {
    return recordings.filter((r) => r.key === key);
  }

  let bestKey = null;
  for (const rk of recordingKeys) {
    if (key.includes(rk) || rk.includes(key)) {
      if (!bestKey || rk.length > bestKey.length) bestKey = rk;
    }
  }
  if (!bestKey) return [];
  return recordings.filter((r) => r.key === bestKey);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (afisha-widget)' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function fetchAffiche() {
  const items = [];
  let page = 1;
  let pages = 1;
  do {
    const data = await fetchJson(`${BASE}/api/v1/affiche?page=${page}`);
    items.push(...data.items.items);
    pages = data.items.pages;
    page++;
  } while (page <= pages);
  return items;
}

// На странице спектакля /repertoire/<slug>/ в __NEXT_DATA__ лежит events[] —
// там для каждой даты (events[].id === affiche item id) уже готовы дирижёр и состав.
async function fetchSpectacleEvents(slug) {
  const res = await fetch(`${BASE}/repertoire/${slug}/`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (afisha-widget)' },
  });
  if (!res.ok) throw new Error(`repertoire/${slug} -> ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`repertoire/${slug}: __NEXT_DATA__ not found`);
  const data = JSON.parse(m[1]);
  const events = data?.props?.pageProps?.events ?? [];
  const bySlugData = data?.props?.pageProps?.data ?? null;
  return { events, spectacleDetail: bySlugData };
}

function pickRoleNames(persons) {
  return persons.map((p) => p.name);
}

export async function buildAfisha() {
  const raw = await fetchAffiche();

  let archive = { recordings: [] };
  try {
    archive = await buildArchive();
  } catch (err) {
    console.error(`[afisha] архив записей недоступен: ${err.message}`);
  }
  const recordingKeys = new Set(archive.recordings.map((r) => r.key));
  const recordingsCache = new Map(); // title -> matched recordings (чтобы не искать повторно)

  const slugs = [...new Set(raw.map((it) => it.spectacle.slug))];
  const eventsBySlug = new Map();
  const detailBySlug = new Map();

  for (const slug of slugs) {
    try {
      const { events, spectacleDetail } = await fetchSpectacleEvents(slug);
      eventsBySlug.set(slug, events);
      detailBySlug.set(slug, spectacleDetail);
    } catch (err) {
      console.error(`[afisha] ${slug}: ${err.message}`);
      eventsBySlug.set(slug, []);
      detailBySlug.set(slug, null);
    }
  }

  const performances = raw.map((it) => {
    const events = eventsBySlug.get(it.spectacle.slug) ?? [];
    const ev = events.find((e) => e.id === it.id);
    const conductors = (ev?.conductors ?? []).flatMap((c) => pickRoleNames(c.persons));
    const cast = (ev?.performers ?? []).map((p) => ({
      role: p.role,
      names: pickRoleNames(p.persons),
    }));
    const detail = detailBySlug.get(it.spectacle.slug);

    if (!recordingsCache.has(it.spectacle.title)) {
      const found = findRecordings(it.spectacle.title, archive.recordings, recordingKeys)
        .map((r) => ({ date: r.date, url: r.url }))
        .filter((r) => r.url)
        .sort((a, b) => b.date.localeCompare(a.date));
      recordingsCache.set(it.spectacle.title, found);
    }

    return {
      id: it.id,
      date: it.date,
      hasTickets: it.hasTickets,
      stage: it.stage,
      spectacle: {
        slug: it.spectacle.slug,
        title: it.spectacle.title,
        author: it.spectacle.author,
        genre: it.spectacle.genre,
        type: it.spectacle.type,
        age: it.spectacle.age,
        duration: it.spectacle.duration,
        intermission: it.spectacle.intermission,
        description: it.spectacle.description,
        image: it.spectacle.image ? `${BASE}${it.spectacle.image}` : null,
        premiereDate: detail?.premiereDate ?? null,
        authors: detail?.authors ?? [],
        recordings: recordingsCache.get(it.spectacle.title),
      },
      conductors,
      cast,
    };
  });

  performances.sort((a, b) => new Date(a.date) - new Date(b.date));

  return {
    updatedAt: new Date().toISOString(),
    source: `${BASE}/afisha/`,
    performances,
  };
}

// Запуск как самостоятельный скрипт: node scripts/update-afisha.mjs > app/data/afisha.json
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('update-afisha.mjs')) {
  const fs = await import('node:fs/promises');
  const result = await buildAfisha();
  await fs.writeFile('app/data/afisha.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log(`[afisha] saved ${result.performances.length} performances`);
}
