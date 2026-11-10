import { REST, Routes } from 'discord.js';
import { commandData } from './commands.js';
import { env } from './config.js';

if (!env.token || !env.clientId) {
  console.error('Нужны DISCORD_TOKEN и CLIENT_ID в .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(env.token);
const route = env.guildId
  ? Routes.applicationGuildCommands(env.clientId, env.guildId)
  : Routes.applicationCommands(env.clientId);

try {
  const result = await rest.put(route, { body: commandData });
  console.log(`Зарегистрировано команд: ${result.length} (${env.guildId ? 'на сервере ' + env.guildId : 'глобально'})`);
  for (const c of result) console.log(` /${c.name}`);
} catch (error) {
  console.error('Не удалось зарегистрировать команды:', error);
  process.exit(1);
}
