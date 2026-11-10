import {
  ActionRowBuilder,
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Options,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config, env, getForm, overriddenByEnv, pagesOf } from './config.js';
import { attachAutoRole } from './autorole.js';
import { commandMap } from './commands.js';
import { clearDraft, mergeDraft } from './drafts.js';
import { startFeedLoops } from './feeds.js';
import { applyDescription, startPresenceLoop } from './presence.js';
import { getTicket } from './store.js';
import { acceptTicket, claimTicket, closeTicket, createTicket, denyTicket, EPHEMERAL, isStaff } from './tickets.js';
import { formModal, nextStepButton } from './ui.js';

if (!env.token) {
  console.error('Нет DISCORD_TOKEN. Скопируй .env.example в .env и вставь токен бота.');
  process.exit(1);
}

// Боту нужны только каналы и роли: всё остальное не кешируем, чтобы влезать
// в лимит памяти бесплатного хостинга. Себя в кеше участников держим —
// на guild.members.me опираются проверки прав.
const cacheOptions = {
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 10,
    PresenceManager: 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    GuildEmojiManager: 0,
    GuildStickerManager: 0,
    GuildInviteManager: 0,
    GuildScheduledEventManager: 0,
    AutoModerationRuleManager: 0,
    StageInstanceManager: 0,
    VoiceStateManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
    GuildMemberManager: { maxSize: 5, keepOverLimit: (m) => m.id === m.client.user.id },
    UserManager: { maxSize: 5, keepOverLimit: (u) => u.id === u.client.user.id },
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 300, lifetime: 600 },
    users: { interval: 3600, filter: () => (u) => u.id !== u.client.user.id },
  },
};

function onReady(c) {
  console.log(`Бот запущен как ${c.user.tag}`);
  console.log(`Форм заявок: ${config.forms.map((f) => f.id).join(', ') || 'нет'}`);
  if (overriddenByEnv.length) console.log(`Из .env взято: ${overriddenByEnv.join(', ')}`);

  if (config.presence?.roleId && c.options.intents.has(GatewayIntentBits.GuildMembers)) {
    startPresenceLoop(c);
  } else {
    const p = config.presence ?? {};
    c.user.setPresence({
      activities: [
        {
          name: p.fallbackActivity ?? 'заявки',
          type: ActivityType[p.activityType ?? 'Watching'] ?? ActivityType.Watching,
        },
      ],
      status: 'online',
    });
    // без Server Members Intent лічильника немає, але опис профілю ставимо все одно
    applyDescription(c).catch((e) => console.error('Опис профілю:', e?.message ?? e));
  }

  startFeedLoops(c);
}

async function openForm(interaction, formId, page = 0) {
  const form = getForm(formId);
  if (!form) {
    await interaction.reply({ content: '⚠️ Такої форми більше немає — онови панель командою `/panel`.', ...EPHEMERAL });
    return;
  }
  if (page === 0) clearDraft(interaction.user.id, formId);
  await interaction.showModal(formModal(form, page));
}

/** Достаёт тикет текущего канала и проверяет права рекрутера. */
async function staffTicket(interaction) {
  const ticket = getTicket(interaction.channelId);
  if (!ticket) {
    await interaction.reply({ content: '⚠️ Заявку не знайдено в базі.', ...EPHEMERAL });
    return null;
  }
  if (!isStaff(interaction.member, getForm(ticket.formId))) {
    await interaction.reply({ content: '⛔ Це може зробити лише менеджер.', ...EPHEMERAL });
    return null;
  }
  return ticket;
}

async function route(interaction) {
  if (interaction.isChatInputCommand()) {
    const command = commandMap.get(interaction.commandName);
    if (command) await command.run(interaction);
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 't:pick') {
    await openForm(interaction, interaction.values[0]);
    return;
  }

  if (interaction.isButton()) {
    const [ns, action, arg] = interaction.customId.split(':');
    if (ns !== 't') return;

    if (action === 'open') {
      await openForm(interaction, arg);
      return;
    }

    if (action === 'next') {
      const page = Number(interaction.customId.split(':')[3] ?? 0);
      await openForm(interaction, arg, page);
      return;
    }

    if (action === 'claim') {
      const ticket = await staffTicket(interaction);
      if (ticket) await claimTicket(interaction, ticket);
      return;
    }

    if (action === 'accept') {
      const ticket = await staffTicket(interaction);
      if (ticket) await acceptTicket(interaction, ticket);
      return;
    }

    if (action === 'deny') {
      const ticket = await staffTicket(interaction);
      if (!ticket) return;
      const modal = new ModalBuilder()
        .setCustomId('t:denyreason')
        .setTitle('Відмова по заявці')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('Причина відмови (побачить замовник)')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('Не беремось за такий обсяг, немає вільних слотів...')
              .setMaxLength(400)
              .setRequired(false),
          ),
        );
      await interaction.showModal(modal);
      return;
    }

    if (action === 'close') {
      const ticket = getTicket(interaction.channelId);
      if (!ticket) {
        await interaction.reply({ content: '⚠️ Заявку не знайдено в базі.', ...EPHEMERAL });
        return;
      }
      if (!isStaff(interaction.member, getForm(ticket.formId)) && interaction.user.id !== ticket.userId) {
        await interaction.reply({ content: '⛔ Закрити може менеджер або автор заявки.', ...EPHEMERAL });
        return;
      }
      await closeTicket(interaction, ticket);
      return;
    }
  }

  if (interaction.isModalSubmit()) {
    const [ns, kind, formId, pageRaw] = interaction.customId.split(':');
    if (ns !== 't') return;

    if (kind === 'form') {
      const form = getForm(formId);
      if (!form) {
        await interaction.reply({ content: '⚠️ Форму не знайдено.', ...EPHEMERAL });
        return;
      }

      const pages = pagesOf(form);
      const page = Number(pageRaw ?? 0);
      const answers = {};
      for (const q of pages[page] ?? []) {
        answers[q.id] = interaction.fields.getTextInputValue(q.id) ?? '';
      }
      const merged = mergeDraft(interaction.user.id, formId, answers);

      if (page + 1 < pages.length) {
        await interaction.reply({
          content: `✅ Крок ${page + 1} з ${pages.length} збережено. Натисни кнопку, щоб продовжити.`,
          components: nextStepButton(formId, page + 1, pages.length),
          ...EPHEMERAL,
        });
        return;
      }

      clearDraft(interaction.user.id, formId);
      await createTicket(interaction, form, merged);
      return;
    }

    if (kind === 'denyreason') {
      const ticket = await staffTicket(interaction);
      if (ticket) await denyTicket(interaction, ticket, interaction.fields.getTextInputValue('reason')?.trim() ?? '');
    }
  }
}

async function onInteraction(interaction) {
  try {
    await route(interaction);
  } catch (error) {
    console.error('Ошибка обработки взаимодействия:', error);
    const payload = { content: '❌ Щось зламалося. Напиши нам напряму.', ...EPHEMERAL };
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  }
}

function buildClient(withMembers) {
  const intents = [GatewayIntentBits.Guilds];
  if (withMembers) intents.push(GatewayIntentBits.GuildMembers);

  const client = new Client({ intents, ...cacheOptions });
  client.once(Events.ClientReady, onReady);
  client.on(Events.InteractionCreate, onInteraction);
  if (withMembers) attachAutoRole(client);
  return client;
}

/**
 * Счётчик роли требует привилегированного Server Members Intent. Если он выключен
 * в Developer Portal, Discord рвёт соединение — тогда поднимаемся без него,
 * чтобы заявки продолжали работать.
 */
async function start() {
  const wantsMembers = Boolean(config.presence?.roleId || config.autoRole?.roleId);
  const client = buildClient(wantsMembers);

  try {
    await client.login(env.token);
  } catch (error) {
    const disallowed = error?.code === 'DisallowedIntents' || /disallowed intents/i.test(String(error?.message));
    if (!wantsMembers || !disallowed) throw error;

    console.error('Server Members Intent вимкнений у Developer Portal — лічильник ролі та автороль не працюватимуть.');
    console.error('Увімкни його: Developer Portal → Bot → Privileged Gateway Intents → Server Members Intent.');
    client.destroy();
    await buildClient(false).login(env.token);
  }
}

process.on('unhandledRejection', (error) => console.error('unhandledRejection:', error));

start().catch((error) => {
  console.error('Не удалось запустить бота:', error);
  process.exit(1);
});
