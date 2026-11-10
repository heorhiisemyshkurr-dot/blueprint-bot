import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { config, fill, getForm } from './config.js';
import { addTicket, getTicket, nextNumber, openTicketsOf, removeTicket, updateTicket } from './store.js';
import { buildTranscript } from './transcript.js';
import { applicationEmbed, dmEmbed, resultEmbed, ticketControls, welcomeEmbed } from './ui.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

export function staffRoleFor(form) {
  return form?.pingRoleId || config.recruiterRoleId || null;
}

/** Менеджер или админ — те, кто может решать по заявке. */
export function isStaff(member, form) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const role = staffRoleFor(form);
  return Boolean(role && member.roles.cache.has(role));
}

async function safeDM(user, payload) {
  try {
    await user.send(payload);
    return true;
  } catch {
    return false;
  }
}

async function log(guild, payload) {
  if (!config.logChannelId) return;
  try {
    const channel = await guild.channels.fetch(config.logChannelId);
    if (channel?.isTextBased()) await channel.send(payload);
  } catch {
    /* канал логов удалён или нет прав — не критично */
  }
}

/** Убирает из базы записи про уже удалённые каналы. */
async function pruneGhosts(guild, tickets) {
  const alive = [];
  for (const t of tickets) {
    const channel = await guild.channels.fetch(t.channelId).catch(() => null);
    if (channel) alive.push(t);
    else removeTicket(t.channelId);
  }
  return alive;
}

export async function createTicket(interaction, form, answers) {
  const { guild, user } = interaction;
  const max = config.maxOpenPerUser ?? 1;

  if (max > 0) {
    const open = await pruneGhosts(guild, openTicketsOf(user.id));
    if (open.length >= max) {
      await interaction.reply({
        content: `⚠️ У тебе вже є відкрита заявка: <#${open[0].channelId}>. Дочекайся відповіді або закрий її.`,
        ...EPHEMERAL,
      });
      return null;
    }
  }

  const number = nextNumber();
  const staffRole = staffRoleFor(form);
  const parent = form.categoryId || config.ticketCategoryId || null;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];
  if (staffRole) {
    overwrites.push({
      id: staffRole,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: `${form.channelPrefix ?? 'заявка'}-${String(number).padStart(4, '0')}`,
    type: ChannelType.GuildText,
    parent,
    topic: `Заявка #${number} · ${form.label ?? form.id} · ${user.tag} (${user.id})`,
    permissionOverwrites: overwrites,
  });

  const ticket = addTicket({
    channelId: channel.id,
    number,
    formId: form.id,
    userId: user.id,
    userTag: user.tag,
    status: 'open',
    claimedBy: null,
    answers,
    createdAt: Date.now(),
  });

  const sent = await channel.send({
    content: staffRole ? `<@&${staffRole}> нове замовлення від <@${user.id}>` : `Нове замовлення від <@${user.id}>`,
    embeds: [applicationEmbed({ form, answers, user, number }), welcomeEmbed({ form, user })],
    components: ticketControls({}),
    allowedMentions: { users: [user.id], roles: staffRole ? [staffRole] : [] },
  });
  await sent.pin().catch(() => {});
  updateTicket(channel.id, { messageId: sent.id });

  await interaction.reply({ content: `✅ Заявку створено: <#${channel.id}>`, ...EPHEMERAL });
  await log(guild, {
    embeds: [
      new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle(`📩 Заявку #${String(number).padStart(4, '0')} відкрито`)
        .setDescription(`Замовник: <@${user.id}> (\`${user.tag}\`)\nТип: **${form.label ?? form.id}**\nКанал: <#${channel.id}>`)
        .setTimestamp(),
    ],
  });

  return ticket;
}

/** Перерисовывает первое сообщение тикета под новый статус. */
async function refresh(channel, ticket) {
  if (!ticket?.messageId) return;
  const form = getForm(ticket.formId);
  if (!form) return;
  const message = await channel.messages.fetch(ticket.messageId).catch(() => null);
  if (!message) return;
  const user = await channel.client.users.fetch(ticket.userId).catch(() => null);
  if (!user) return;
  const embeds = [
    applicationEmbed({
      form,
      answers: ticket.answers,
      user,
      number: ticket.number,
      status: ticket.status,
      claimedBy: ticket.claimedBy,
    }),
    ...message.embeds.slice(1),
  ];
  await message
    .edit({ embeds, components: ticketControls({ status: ticket.status, claimed: Boolean(ticket.claimedBy) }) })
    .catch(() => {});
}

export async function claimTicket(interaction, ticket) {
  const updated = updateTicket(ticket.channelId, { claimedBy: interaction.user.id });
  await refresh(interaction.channel, updated);
  await interaction.reply({ content: `🙋 <@${interaction.user.id}> взяв заявку в роботу.` });
}

export async function acceptTicket(interaction, ticket) {
  await interaction.deferReply();
  const form = getForm(ticket.formId);
  const roleId = form?.acceptRoleId || config.memberRoleId;
  const member = await interaction.guild.members.fetch(ticket.userId).catch(() => null);
  const notes = [];

  if (member && roleId) {
    try {
      await member.roles.add(roleId, `Заявка #${ticket.number} одобрена`);
    } catch {
      notes.push('⚠️ Не вдалося видати роль — роль бота має бути вище за ту, яку видає.');
    }
  } else if (!roleId) {
    notes.push('ℹ️ Роль клієнта не налаштована (`/setup`), видай вручну.');
  } else {
    notes.push('⚠️ Замовника вже немає на сервері.');
  }

  if (member && config.prefixNickname && config.clanTag) {
    const nick = `${config.clanTag} ${member.displayName}`.slice(0, 32);
    await member.setNickname(nick).catch(() => notes.push('ℹ️ Нік не змінено — бракує прав.'));
  }

  const updated = updateTicket(ticket.channelId, {
    status: 'accepted',
    decidedBy: interaction.user.id,
    decidedAt: Date.now(),
  });
  await refresh(interaction.channel, updated);

  const user = member?.user ?? (await interaction.client.users.fetch(ticket.userId).catch(() => null));
  if (user) await safeDM(user, { embeds: [dmEmbed({ accepted: true, guildName: interaction.guild.name })] });

  await interaction.editReply({
    content: notes.join('\n') || undefined,
    embeds: [resultEmbed({ accepted: true, byId: interaction.user.id })],
  });

  await interaction.channel
    .setName(`✅-${form?.channelPrefix ?? 'заявка'}-${String(ticket.number).padStart(4, '0')}`)
    .catch(() => {});
  if (config.archiveCategoryId) {
    await interaction.channel.setParent(config.archiveCategoryId, { lockPermissions: false }).catch(() => {});
  }

  await log(interaction.guild, {
    embeds: [
      new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle(`✅ Замовлення #${String(ticket.number).padStart(4, '0')} прийнято`)
        .setDescription(`Замовник: <@${ticket.userId}>\nМенеджер: <@${interaction.user.id}>`)
        .setTimestamp(),
    ],
  });
}

export async function denyTicket(interaction, ticket, reason) {
  await interaction.deferReply();
  const updated = updateTicket(ticket.channelId, {
    status: 'denied',
    decidedBy: interaction.user.id,
    decidedAt: Date.now(),
    reason,
  });
  await refresh(interaction.channel, updated);

  const user = await interaction.client.users.fetch(ticket.userId).catch(() => null);
  if (user) await safeDM(user, { embeds: [dmEmbed({ accepted: false, reason, guildName: interaction.guild.name })] });

  await interaction.editReply({ embeds: [resultEmbed({ accepted: false, reason, byId: interaction.user.id })] });
  await interaction.channel.setName(`⛔-заявка-${String(ticket.number).padStart(4, '0')}`).catch(() => {});

  await log(interaction.guild, {
    embeds: [
      new EmbedBuilder()
        .setColor(config.colors.danger)
        .setTitle(`⛔ Заявку #${String(ticket.number).padStart(4, '0')} відхилено`)
        .setDescription(`Замовник: <@${ticket.userId}>\nМенеджер: <@${interaction.user.id}>\nПричина: ${reason || '—'}`)
        .setTimestamp(),
    ],
  });

  await closeTicket(interaction, updated, { reason: reason || 'відмова', silent: true });
}

export async function closeTicket(interaction, ticket, { reason = '', silent = false } = {}) {
  const channel = interaction.channel;
  const delay = Math.max(3, config.deleteDelaySeconds ?? 10);

  if (!silent) {
    const payload = {
      embeds: [
        new EmbedBuilder()
          .setColor(config.colors.neutral)
          .setTitle('🔒 Заявка закривається')
          .setDescription(
            [
              `Закрив: <@${interaction.user.id}>`,
              reason ? `Причина: ${reason}` : null,
              `Канал буде видалено через ${delay} сек.`,
            ]
              .filter(Boolean)
              .join('\n'),
          ),
      ],
    };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } else {
    await channel.send({ content: `🔒 Канал буде видалено через ${delay} сек.` }).catch(() => {});
  }

  // забираем право писать, чтобы в закрытую заявку уже не дописывали
  await channel.permissionOverwrites.edit(ticket.userId, { SendMessages: false }).catch(() => {});

  let file = null;
  try {
    file = await buildTranscript(channel, ticket);
  } catch {
    /* транскрипт не собрался — закрываем всё равно */
  }

  await log(interaction.guild, {
    embeds: [
      new EmbedBuilder()
        .setColor(config.colors.neutral)
        .setTitle(`🔒 Заявку #${String(ticket.number).padStart(4, '0')} закрито`)
        .setDescription(
          [
            `Замовник: <@${ticket.userId}> (\`${ticket.userTag}\`)`,
            `Підсумок: **${ticket.status}**`,
            `Закрив: <@${interaction.user.id}>`,
            reason ? `Причина: ${reason}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
        )
        .setTimestamp(),
    ],
    files: file ? [file] : [],
  });

  updateTicket(ticket.channelId, {
    status: ticket.status === 'open' ? 'closed' : ticket.status,
    closedAt: Date.now(),
  });

  setTimeout(async () => {
    await channel.delete(fill('Заявку закрито — {clan}')).catch(() => {});
    removeTicket(ticket.channelId);
  }, delay * 1000);
}

export { EPHEMERAL, getTicket };
