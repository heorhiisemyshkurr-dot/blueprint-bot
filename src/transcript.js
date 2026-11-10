import { AttachmentBuilder } from 'discord.js';
import { config } from './config.js';

function escape(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function fetchAll(channel, limit = 500) {
  const all = [];
  let before;
  while (all.length < limit) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.reverse();
}

/** Собирает HTML-транскрипт канала и возвращает его вложением. */
export async function buildTranscript(channel, ticket) {
  const messages = await fetchAll(channel);

  const rows = messages
    .map((m) => {
      const time = new Date(m.createdTimestamp).toLocaleString('ru-RU');
      const body = [];
      if (m.content) body.push(`<div class="text">${escape(m.content).replaceAll('\n', '<br>')}</div>`);
      for (const e of m.embeds) {
        const fields = (e.fields ?? [])
          .map((f) => `<div class="field"><b>${escape(f.name)}</b><div>${escape(f.value).replaceAll('\n', '<br>')}</div></div>`)
          .join('');
        body.push(
          `<div class="embed" style="border-color:${e.hexColor ?? config.colors.primary}">` +
            (e.title ? `<div class="etitle">${escape(e.title)}</div>` : '') +
            (e.description ? `<div class="text">${escape(e.description).replaceAll('\n', '<br>')}</div>` : '') +
            fields +
            '</div>',
        );
      }
      for (const a of m.attachments.values()) {
        body.push(`<div class="attach"><a href="${escape(a.url)}">📎 ${escape(a.name)}</a></div>`);
      }
      return (
        '<div class="msg">' +
        `<img class="pfp" src="${escape(m.author.displayAvatarURL({ extension: 'png', size: 64 }))}" alt="">` +
        '<div class="body">' +
        `<div class="head"><span class="name">${escape(m.author.tag)}</span><span class="time">${escape(time)}</span></div>` +
        (body.join('') || '<div class="text muted">— пустое сообщение —</div>') +
        '</div></div>'
      );
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Транскрипт #${ticket?.number ?? ''} — ${escape(channel.name)}</title>
<style>
  :root { color-scheme: dark; --bg:#1a1b1e; --card:#232428; --line:#36373d; --text:#e6e6e8; --muted:#9a9ba1; --accent:${config.colors.primary}; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--text); font:15px/1.5 "Segoe UI", system-ui, sans-serif; }
  .wrap { max-width:820px; margin:0 auto; }
  header { border-left:4px solid var(--accent); padding:12px 16px; background:var(--card); border-radius:8px; margin-bottom:20px; }
  header h1 { margin:0 0 6px; font-size:20px; }
  header p { margin:2px 0; color:var(--muted); font-size:13px; }
  .msg { display:flex; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); }
  .pfp { width:40px; height:40px; border-radius:50%; flex:none; }
  .body { min-width:0; flex:1; }
  .head { display:flex; gap:10px; align-items:baseline; }
  .name { font-weight:600; color:#fff; }
  .time { font-size:12px; color:var(--muted); }
  .text { white-space:pre-wrap; word-wrap:break-word; }
  .muted { color:var(--muted); }
  .embed { margin:6px 0; padding:10px 12px; background:var(--card); border-left:4px solid var(--accent); border-radius:6px; }
  .etitle { font-weight:600; margin-bottom:4px; }
  .field { margin-top:8px; font-size:14px; }
  .field b { color:#fff; }
  .attach a { color:var(--accent); }
</style></head><body><div class="wrap">
<header>
  <h1>🪓 ${escape(config.clanName)} — транскрипт</h1>
  <p>Канал: #${escape(channel.name)}</p>
  <p>Заявка: #${String(ticket?.number ?? 0).padStart(4, '0')} · тип: ${escape(ticket?.formId ?? '—')} · статус: ${escape(ticket?.status ?? '—')}</p>
  <p>Кандидат: ${escape(ticket?.userTag ?? '—')} (${escape(ticket?.userId ?? '—')})</p>
  <p>Сообщений: ${messages.length} · выгружено: ${new Date().toLocaleString('ru-RU')}</p>
</header>
${rows}
</div></body></html>`;

  return new AttachmentBuilder(Buffer.from(html, 'utf8'), {
    name: `transcript-${String(ticket?.number ?? 0).padStart(4, '0')}-${channel.name}.html`,
  });
}
