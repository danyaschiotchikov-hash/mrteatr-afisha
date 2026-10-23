// Тянет последние посты ВК-группы хора — ТОЛЬКО чтение (wall.get).
// Никогда не пишет и не публикует в группу.
//
// Нужны переменные окружения:
//   VK_GROUP_DOMAIN — короткое имя группы из её ссылки (vk.com/<domain>)
//   VK_TOKEN        — токен сообщества с правом "wall" (создаётся самим админом
//                      группы: Управление группой → Работа с API → Создать ключ)

const VK_API = 'https://api.vk.com/method/wall.get';
const VK_VERSION = '5.199';

function stripHtml(s) {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export async function fetchVkPosts({ domain, token, count = 30 }) {
  if (!domain || !token) {
    throw new Error('VK_GROUP_DOMAIN / VK_TOKEN не заданы');
  }

  const url = `${VK_API}?domain=${encodeURIComponent(domain)}&count=${count}&access_token=${token}&v=${VK_VERSION}`;
  const res = await fetch(url);
  const json = await res.json();

  if (json.error) {
    throw new Error(`VK API: ${json.error.error_msg} (code ${json.error.error_code})`);
  }

  const items = json.response?.items ?? [];

  return items.map((post) => {
    const photos = (post.attachments ?? [])
      .filter((a) => a.type === 'photo')
      .map((a) => {
        const sizes = a.photo.sizes ?? [];
        const best = sizes.reduce((max, s) => (s.width > (max?.width ?? 0) ? s : max), null);
        return best?.url ?? null;
      })
      .filter(Boolean);

    return {
      id: post.id,
      date: new Date(post.date * 1000).toISOString(),
      text: stripHtml(post.text),
      photos,
      postUrl: `https://vk.com/wall-${post.owner_id < 0 ? -post.owner_id : post.owner_id}_${post.id}`,
    };
  });
}

if (process.argv[1]?.endsWith('update-vk.mjs')) {
  const fs = await import('node:fs/promises');
  const domain = process.env.VK_GROUP_DOMAIN;
  const token = process.env.VK_TOKEN;

  try {
    const posts = await fetchVkPosts({ domain, token });
    const result = { updatedAt: new Date().toISOString(), source: `https://vk.com/${domain}`, posts };
    await fs.writeFile('app/data/vk.json', JSON.stringify(result, null, 2), 'utf-8');
    console.log(`[vk] saved ${posts.length} posts`);
  } catch (err) {
    console.error(`[vk] ${err.message}`);
    // Не валим весь workflow, если VK ещё не настроен — просто оставляем предыдущий файл.
    process.exitCode = 0;
  }
}
