// Распознаёт расписание хора из постов ВК через Claude API — ТОЛЬКО ЧТЕНИЕ,
// ничего никогда не публикует и не пишет в группу.
//
// Два источника на пост:
//   1. Фото — печатная таблица по дням с рукописными правками поверх,
//      обычный OCR (Tesseract) с layout таблицы и рукописными вставками
//      не справляется.
//   2. Текст поста — разовые организационные сообщения без фото (изменения
//      времени, отмены и т.п.), дополняют/уточняют то, что уже есть из фото.
//
// Нужна переменная окружения:
//   ANTHROPIC_API_KEY — ключ API (console.anthropic.com)
// Если не задана — шаг просто пропускается, workflow не падает.

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5-5';
const MAX_POSTS = 6;
const MAX_PHOTOS_PER_POST = 4;

const IMAGE_PROMPT = `На фото — страница расписания хора музыкального театра: таблица по дням.

Верни ТОЛЬКО JSON-массив без пояснений и без markdown-разметки, в формате:
[{"day":19,"month":10,"weekday":"пн","events":["ВЫХОДНОЙ"]}, ...]

Правила:
- "day"/"month" — число из левой колонки (например 19.10 → day:19, month:10).
- "weekday" — сокращение дня недели как написано (пн, вт, ...).
- "events" — отдельные пункты дня как отдельные строки текста, в порядке
  сверху вниз, с временем внутри строки как написано (например "18.00
  спектакль «Лючия ди Ламмермур»").
- Если время или пункт зачёркнуты и рядом/сверху вписано от руки новое
  значение — используй рукописное, зачёркнутое не включай.
- Если на фото нет таблицы расписания (другое фото из поста) — верни [].
- Не добавляй дни, которых нет на фото.`;

function textPrompt(postDateStr, text) {
  return `Это текст поста из ВК-группы хора музыкального театра, опубликован ${postDateStr}.

Если в тексте есть конкретные организационные сообщения с датами (время
репетиций/спектаклей/поездок, изменения расписания, отмены и т.п.) — верни
их. Если текст не содержит такой конкретики по датам (общие новости, анонсы
без привязки к датам и т.п.) — верни [].

Верни ТОЛЬКО JSON-массив без пояснений и без markdown-разметки, в формате:
[{"day":29,"month":10,"weekday":"чт","events":["18.00 оркестровая репетиция «Лебединое озеро»"]}]

Правила:
- "day"/"month" — дата события. Если дата не названа явно, но ясна из
  контекста (например "сегодня", "завтра") — вычисли её от даты публикации
  поста.
- "weekday" — сокращение дня недели, вычисли по дате.
- "events" — события этого дня из текста поста, как отдельные строки.
- Не придумывай события, которых нет в тексте.

Текст поста:
"""
${text}
"""`;
}

function extractJson(apiText) {
  const cleaned = apiText.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

async function fetchImageBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`фото ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { data: buf.toString('base64'), mediaType: contentType.split(';')[0] };
}

async function callClaude(apiKey, content) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content }] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Claude API: ${json.error.message}`);
  return extractJson(json.content?.[0]?.text ?? '[]');
}

async function askClaudeImage(apiKey, imageBase64, mediaType) {
  return callClaude(apiKey, [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
    { type: 'text', text: IMAGE_PROMPT },
  ]);
}

async function askClaudeText(apiKey, postDateStr, text) {
  return callClaude(apiKey, textPrompt(postDateStr, text));
}

function resolveYear(entryMonth, postDate) {
  const postYear = postDate.getFullYear();
  const postMonth = postDate.getMonth() + 1;
  return entryMonth < postMonth ? postYear + 1 : postYear;
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Фото-таблица — авторитетный полный снимок дня, перезаписывает целиком.
// Текст поста — точечное уточнение, добавляется к уже известным событиям дня.
function applyRows(byDate, rows, postDate, { overwrite }) {
  if (!Array.isArray(rows) || !rows.length) return false;
  let applied = false;
  for (const row of rows) {
    if (!row.day || !row.month || !row.events?.length) continue;
    const year = resolveYear(row.month, postDate);
    const date = isoDate(year, row.month, row.day);
    const weekday = row.weekday || '';
    if (overwrite || !byDate.has(date)) {
      byDate.set(date, { date, weekday, events: row.events });
    } else {
      const existing = byDate.get(date);
      const events = [...existing.events];
      for (const e of row.events) if (!events.includes(e)) events.push(e);
      byDate.set(date, { date, weekday: existing.weekday || weekday, events });
    }
    applied = true;
  }
  return applied;
}

export async function buildSchedule({ posts, apiKey }) {
  const byDate = new Map();
  let sourcePostUrl = null;

  const candidates = posts
    .slice(0, MAX_POSTS)
    .sort((a, b) => new Date(a.date) - new Date(b.date)); // от старых к новым — новые уточняют/перезаписывают старые

  for (const post of candidates) {
    const postDate = new Date(post.date);

    for (const url of (post.photos ?? []).slice(0, MAX_PHOTOS_PER_POST)) {
      try {
        const { data, mediaType } = await fetchImageBase64(url);
        const rows = await askClaudeImage(apiKey, data, mediaType);
        if (applyRows(byDate, rows, postDate, { overwrite: true })) sourcePostUrl = post.postUrl;
      } catch (err) {
        console.error(`[schedule] фото ${url}: ${err.message}`);
      }
    }

    if (post.text?.trim()) {
      try {
        const postDateStr = isoDate(postDate.getFullYear(), postDate.getMonth() + 1, postDate.getDate());
        const rows = await askClaudeText(apiKey, postDateStr, post.text);
        if (applyRows(byDate, rows, postDate, { overwrite: false })) sourcePostUrl = post.postUrl;
      } catch (err) {
        console.error(`[schedule] текст поста ${post.id}: ${err.message}`);
      }
    }
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { updatedAt: new Date().toISOString(), sourcePostUrl, days };
}

if (process.argv[1]?.endsWith('update-schedule.mjs')) {
  const fs = await import('node:fs/promises');
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.log('[schedule] ANTHROPIC_API_KEY не задан — пропускаю распознавание расписания');
  } else {
    try {
      const vk = JSON.parse(await fs.readFile('app/data/vk.json', 'utf-8'));
      const schedule = await buildSchedule({ posts: vk.posts ?? [], apiKey });
      await fs.writeFile('app/data/schedule.json', JSON.stringify(schedule, null, 2), 'utf-8');
      console.log(`[schedule] saved ${schedule.days.length} days`);
    } catch (err) {
      console.error(`[schedule] ${err.message}`);
      process.exitCode = 0;
    }
  }
}
