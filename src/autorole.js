import { Events, Routes } from 'discord.js';
import { config } from './config.js';

/** Выдаёт роль новичкам. Требует Server Members Intent. */
export function attachAutoRole(client) {
  const auto = config.autoRole ?? {};
  if (!auto.roleId) {
    console.log('Автороль: не налаштована.');
    return;
  }

  client.on(Events.GuildMemberAdd, async (member) => {
    if (auto.skipBots !== false && member.user.bot) return;
    if (auto.guildId && member.guild.id !== auto.guildId) return;

    try {
      await member.roles.add(auto.roleId, 'Автовидача ролі при вході');
      console.log(`Автороль: видано ${member.user.tag}`);
    } catch (error) {
      console.error(`Автороль: не вдалося видати ${member.user.tag} —`, error?.message ?? error);
    }
  });

  console.log(`Автороль: увімкнена, роль ${auto.roleId}.`);
}

/**
 * Разовая выдача роли тем, кто уже на сервере.
 * Возвращает отчёт, чтобы команда показала итог.
 */
export async function syncAutoRole(client, guild, roleId) {
  const result = { checked: 0, given: 0, skipped: 0, failed: 0 };
  let after = '0';

  for (;;) {
    const batch = await client.rest.get(Routes.guildMembers(guild.id), {
      query: new URLSearchParams({ limit: '1000', after }),
    });
    if (!batch.length) break;

    for (const raw of batch) {
      result.checked++;

      if (raw.user?.bot || raw.roles.includes(roleId)) {
        result.skipped++;
        continue;
      }

      try {
        await client.rest.put(Routes.guildMemberRole(guild.id, raw.user.id, roleId), {
          reason: 'Синхронізація авторолі',
        });
        result.given++;
      } catch {
        result.failed++;
      }
    }

    after = batch.at(-1).user.id;
    if (batch.length < 1000) break;
  }

  return result;
}
