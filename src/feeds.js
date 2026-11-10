import fs from 'node:fs';
import path from 'node:path';
import { config, dataDir, fill } from './config.js';

const seenFile = path.join(dataDir, 'feeds.json');

function readSeen() {
  try {
    return JSON.parse(fs.readFileSync(seenFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeSeen(db) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(seenFile, JSON.stringify(db, null, 2) + '\n', 'utf8');
}

const unescape = (s) =>
  String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? unescape(m[1]) : '';
};

/** Минимальный разбор RSS 2.0 и Atom — хватает для лент TikTok/YouTube. */
export function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);

  return blocks.map((b) => {
    // в Atom ссылка лежит в атрибуте href
    const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);
    const link = href ? unescape(href[1]) : tag(b, 'link');
    const id = tag(b, 'guid') || tag(b, 'id') || link || tag(b, 'title');
    return {
      id,
      link,
      title: tag(b, 'title'),
      date: tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated'),
    };
  });
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; LabBot/1.0; +https://discord.com)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function checkFeed(client, feed) {
  if (!feed.url || !feed.channelId) return;

  const items = parseFeed(await fetchFeed(feed.url)).filter((i) => i.id);
  if (!items.length) return;

  const db = readSeen();
  const known = db[feed.id] ?? null;

  // первый запуск: запоминаем ленту целиком и молчим, иначе зальём канал старыми видео
  if (!known) {
    db[feed.id] = items.map((i) => i.id).slice(0, 100);
    writeSeen(db);
    console.log(`Стрічка ${feed.id}: перша перевірка, запам'ятано ${items.length} записів без сповіщень.`);
    return;
  }

  const fresh = items.filter((i) => !known.includes(i.id)).slice(0, feed.maxPerCheck ?? 3);
  if (!fresh.length) return;

  const channel = await client.channels.fetch(feed.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.error(`Стрічка ${feed.id}: канал ${feed.channelId} недоступний.`);
    return;
  }

  // от старых к новым, чтобы в канале шли по порядку
  for (const item of fresh.reverse()) {
    const text = fill(feed.template ?? '{mention}\n{title}\n{link}')
      .replaceAll('{mention}', feed.mention ?? '')
      .replaceAll('{title}', item.title || '')
      .replaceAll('{link}', item.link || '')
      .trim();

    await channel.send({
      content: text,
      allowedMentions: feed.mention === '@everyone' ? { parse: ['everyone'] } : { parse: ['roles', 'users'] },
    });
    console.log(`Стрічка ${feed.id}: опубліковано ${item.link || item.id}`);
  }

  db[feed.id] = [...fresh.map((i) => i.id), ...known].slice(0, 100);
  writeSeen(db);
}

export function startFeedLoops(client) {
  for (const feed of config.feeds ?? []) {
    if (!feed.url) {
      console.log(`Стрічка ${feed.id}: URL не заданий — спостереження вимкнено.`);
      continue;
    }

    const minutes = Math.max(5, feed.intervalMinutes ?? 10);

    const tick = async () => {
      try {
        await checkFeed(client, feed);
      } catch (error) {
        console.error(`Стрічка ${feed.id}: помилка перевірки —`, error?.message ?? error);
      }
    };

    tick();
    const timer = setInterval(tick, minutes * 60 * 1000);
    timer.unref?.();
    console.log(`Стрічка ${feed.id}: перевірка кожні ${minutes} хв.`);
  }
}
