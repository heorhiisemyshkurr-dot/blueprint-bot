import { ActivityType, Routes } from 'discord.js';
import { config, fill } from './config.js';

/**
 * Считает участников с нужной ролью через REST, без кеша discord.js:
 * на хостинге память ограничена, держать в памяти весь состав сервера незачем.
 * Эндпоинт требует привилегированный Server Members Intent.
 */
export async function countRoleMembers(client, guildId, roleId) {
  let after = '0';
  let count = 0;
  let total = 0;

  for (;;) {
    const batch = await client.rest.get(Routes.guildMembers(guildId), {
      query: new URLSearchParams({ limit: '1000', after }),
    });
    if (!batch.length) break;

    for (const m of batch) {
      total++;
      if (m.roles.includes(roleId)) count++;
    }

    after = batch.at(-1).user.id;
    if (batch.length < 1000) break;
  }

  return { count, total };
}

const render = (template, fallback, count, total) =>
  fill(template ?? fallback)
    .replaceAll('{count}', String(count))
    .replaceAll('{total}', String(total));

let lastCount = null;
let lastDescription = null;

/**
 * Опис профілю бота (About Me). Ставиться і без лічильника —
 * тоді беремо шаблон без {count}. Ліміт Discord — 400 символів.
 */
export async function applyDescription(client, count = null) {
  const p = config.presence ?? {};
  if (p.updateDescription === false) return;

  const template = count === null ? p.descriptionFallback : p.descriptionTemplate;
  if (!template) return;

  const text = render(template, '', count ?? 0, 0).slice(0, 400);
  if (text === lastDescription) return;

  await client.application.edit({ description: text });
  lastDescription = text;
  console.log('Опис профілю бота оновлено.');
}

export async function refreshPresence(client) {
  const p = config.presence ?? {};
  if (!p.roleId) return;

  const guildId = p.guildId || client.guilds.cache.firstKey();
  if (!guildId) return;

  const { count, total } = await countRoleMembers(client, guildId, p.roleId);

  client.user.setPresence({
    activities: [
      {
        name: render(p.template, '{count} у складі {clan}', count, total),
        type: ActivityType[p.activityType ?? 'Watching'] ?? ActivityType.Watching,
      },
    ],
    status: 'online',
  });

  // описание дёргаем только когда число изменилось — у этого эндпоинта жёсткие лимиты
  if (count !== lastCount) await applyDescription(client, count);

  lastCount = count;
  return count;
}

/** Первый запуск + периодическое обновление. Ошибки не роняют бота. */
export function startPresenceLoop(client) {
  const p = config.presence ?? {};
  if (!p.roleId) return;

  const minutes = Math.max(5, p.intervalMinutes ?? 15);

  const tick = async () => {
    try {
      const count = await refreshPresence(client);
      if (count !== undefined) console.log(`Статус оновлено: учасників з роллю — ${count}`);
    } catch (error) {
      if (error?.status === 403) {
        console.error(
          'Не вдалося порахувати учасників: увімкни Server Members Intent у Developer Portal → Bot → Privileged Gateway Intents.',
        );
      } else {
        console.error('Помилка оновлення статусу:', error?.message ?? error);
      }
    }
  };

  tick();
  const timer = setInterval(tick, minutes * 60 * 1000);
  timer.unref?.();
}
