// Распознаёт расписание хора из фото в постах ВК через Claude API (vision).
// Фото — печатная таблица по дням с рукописными правками поверх, обычный OCR
// (Tesseract) с layout таблицы и рукописными вставками не справляется.
//
// Нужна переменная окружения:
//   ANTHROPIC_API_KEY — ключ API (console.anthropic.com)
// Если не задана — шаг просто пропускается, workflow не падает.

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5-5';
const MAX_POSTS = 6;
const MAX_PHOTOS_PER_POST = 4;

const PROMPT = `На фото — страница расписания хора музыкального театра: таблица по дням.

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

async function fetchImageBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`фото ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { data: buf.toString('base64'), mediaType: contentType.split(';')[0] };
}

async function askClaude(apiKey, imageBase64, mediaType) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Claude API: ${json.error.message}`);
  const text = json.content?.[0]?.text ?? '[]';
  const cleaned = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

function resolveYear(entryMonth, postDate) {
  const postYear = postDate.getFullYear();
  const postMonth = postDate.getMonth() + 1;
  return entryMonth < postMonth ? postYear + 1 : postYear;
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export async function buildSchedule({ posts, apiKey }) {
  const byDate = new Map();
  let sourcePostUrl = null;

  const candidates = posts
    .filter((p) => p.photos?.length)
    .slice(0, MAX_POSTS)
    .sort((a, b) => new Date(a.date) - new Date(b.date)); // от старых к новым — новые перезаписывают старые

  for (const post of candidates) {
    const postDate = new Date(post.date);
    for (const url of post.photos.slice(0, MAX_PHOTOS_PER_POST)) {
      try {
        const { data, mediaType } = await fetchImageBase64(url);
        const rows = await askClaude(apiKey, data, mediaType);
        if (!Array.isArray(rows) || !rows.length) continue;
        for (const row of rows) {
          if (!row.day || !row.month || !row.events?.length) continue;
          const year = resolveYear(row.month, postDate);
          const date = isoDate(year, row.month, row.day);
          byDate.set(date, { date, weekday: row.weekday ?? '', events: row.events });
        }
        sourcePostUrl = post.postUrl;
      } catch (err) {
        console.error(`[schedule] фото ${url}: ${err.message}`);
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
