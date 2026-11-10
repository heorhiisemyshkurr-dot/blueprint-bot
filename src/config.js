import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = path.join(root, 'data');
const configPath = path.join(root, 'config.json');

export const env = {
  token: process.env.DISCORD_TOKEN ?? '',
  clientId: process.env.CLIENT_ID ?? '',
  guildId: process.env.GUILD_ID ?? '',
};

/**
 * На хостинге переменные окружения переживают переливку файлов, а config.json — нет.
 * Поэтому ID из .env имеют приоритет над записанными командой /setup.
 */
const ENV_IDS = {
  ticketCategoryId: 'TICKET_CATEGORY_ID',
  archiveCategoryId: 'ARCHIVE_CATEGORY_ID',
  recruiterRoleId: 'RECRUITER_ROLE_ID',
  memberRoleId: 'MEMBER_ROLE_ID',
  logChannelId: 'LOG_CHANNEL_ID',
};

export const overriddenByEnv = [];

function normalize(raw) {
  const cfg = { ...raw };

  overriddenByEnv.length = 0;
  for (const [key, envName] of Object.entries(ENV_IDS)) {
    const value = process.env[envName]?.trim();
    if (value) {
      cfg[key] = value;
      overriddenByEnv.push(`${key} ← ${envName}`);
    }
  }

  cfg.colors = { primary: '#CE422B', success: '#3BA55D', danger: '#ED4245', neutral: '#4F545C', ...(raw.colors ?? {}) };
  cfg.forms = (raw.forms ?? []).filter((f) => f?.id && Array.isArray(f.questions) && f.questions.length);
  return cfg;
}

/** В модалке Discord максимум 5 полей, поэтому длинные формы бьются на шаги. */
export const PAGE_SIZE = 5;

export function pagesOf(form) {
  const pages = [];
  for (let i = 0; i < form.questions.length; i += PAGE_SIZE) {
    pages.push(form.questions.slice(i, i + PAGE_SIZE));
  }
  return pages;
}

export let config = normalize(JSON.parse(fs.readFileSync(configPath, 'utf8')));

export function saveConfig(patch) {
  const merged = { ...config, ...patch };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  config = normalize(merged);
  return config;
}

export function getForm(id) {
  return config.forms.find((f) => f.id === id);
}

export function fill(text) {
  return String(text ?? '').replaceAll('{clan}', config.clanName).replaceAll('{tag}', config.clanTag);
}
