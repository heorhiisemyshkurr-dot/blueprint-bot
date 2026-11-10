import fs from 'node:fs';
import path from 'node:path';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config, fill, pagesOf, root } from './config.js';

const BAR = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

/**
 * Картинка берётся либо из локального файла (attachment://), либо из ссылки.
 * Возвращает ссылку для эмбеда и, если нужно, вложение.
 */
function picture(file, url, fallbackName) {
  if (file) {
    const full = path.resolve(root, file);
    if (fs.existsSync(full)) {
      const ext = path.extname(full) || '.png';
      const name = `${fallbackName}${ext}`;
      return { url: `attachment://${name}`, attachment: new AttachmentBuilder(full, { name }) };
    }
    console.warn(`Файл картинки не найден: ${full}`);
  }
  return url ? { url, attachment: null } : { url: null, attachment: null };
}

const WRAPS = { bolditalic: '***', bold: '**', italic: '_', none: '' };

/**
 * Разметка панели: в конфиге лежит чистый текст, стиль задаётся здесь.
 * Markdown в Discord не переносится через строки, поэтому оборачиваем каждую отдельно.
 */
function emphasize(text, style = 'bolditalic') {
  const wrap = WRAPS[style] ?? WRAPS.bolditalic;
  if (!wrap) return text;
  return String(text)
    .split('\n')
    .map((line) => (line.trim() ? `${wrap}${line.trim()}${wrap}` : line))
    .join('\n');
}

/** Блоки панели и правил описываются одинаково — текстом или списком пунктов. */
function sectionField(section, style) {
  const value = section.items?.length
    ? section.items.map((i) => ` **›** ${emphasize(fill(i), style)}`).join('\n')
    : emphasize(fill(section.text ?? ''), style);
  if (!value) return null;
  return {
    name: `${section.emoji ? section.emoji + ' ' : ''}${fill(section.title ?? '')}`.slice(0, 256),
    value: value.slice(0, 1024),
    inline: Boolean(section.inline),
  };
}

/** Общий сборщик эмбеда из блоков: используют и панель набора, и правила. */
function sectionsEmbed(cfg, { bannerFile, bannerUrl, logoFile, logoUrl, bannerName }) {
  const style = cfg.textStyle ?? 'bolditalic';

  const embed = new EmbedBuilder()
    .setColor(cfg.color || config.colors.primary)
    .setTitle(fill(cfg.title ?? '{clan}'))
    .setTimestamp();

  if (cfg.description) embed.setDescription(`${emphasize(fill(cfg.description), style)}\n\n${BAR}`);

  for (const s of cfg.sections ?? []) {
    const field = sectionField(s, style);
    if (field) embed.addFields(field);
  }

  const logo = picture(logoFile, logoUrl, 'logo');
  const banner = picture(bannerFile, bannerUrl, bannerName);
  if (logo.url) embed.setThumbnail(logo.url);
  if (banner.url) embed.setImage(banner.url);
  if (cfg.footer) embed.setFooter({ text: fill(cfg.footer) });

  return { embed, files: [logo.attachment, banner.attachment].filter(Boolean) };
}

export function panelMessage() {
  const p = config.panel ?? {};
  const sections = p.sections ?? (p.requirements ? [{ title: 'Вимоги', emoji: '📋', items: p.requirements }] : []);
  const { embed, files } = sectionsEmbed(
    { ...p, sections },
    {
      bannerFile: config.bannerFile,
      bannerUrl: config.bannerUrl,
      logoFile: config.logoFile,
      logoUrl: config.logoUrl,
      bannerName: 'banner',
    },
  );
  return { embeds: [embed], components: formPicker(), files };
}

export function partnersMessage() {
  const p = config.partners ?? {};
  const { embed, files } = sectionsEmbed(p, {
    bannerFile: p.bannerFile,
    bannerUrl: p.bannerUrl,
    logoFile: p.logoFile ?? config.logoFile,
    logoUrl: p.logoUrl ?? config.logoUrl,
    bannerName: 'partners',
  });

  // кнопка ведёт на ту же форму заявки, что и панель набора
  const components = [];
  const form = config.forms.find((f) => f.id === (p.formId ?? 'alliance'));
  if (form && p.showFormButton !== false) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`t:open:${form.id}`)
          .setLabel(form.label ?? form.id)
          .setStyle(ButtonStyle.Primary)
          .setEmoji(form.emoji || '🤝'),
      ),
    );
  }

  return { embeds: [embed], components, files };
}

/**
 * Інформаційна панель. Якщо в конфігу вказано formId — під нею зʼявляється
 * кнопка заявки, як у головної панелі.
 */
export function announcementMessage(key) {
  const a = config.announcements?.[key];
  if (!a) return null;

  const { embed, files } = sectionsEmbed(a, {
    bannerFile: a.bannerFile,
    bannerUrl: a.bannerUrl,
    logoFile: a.logoFile ?? config.logoFile,
    logoUrl: a.logoUrl ?? config.logoUrl,
    bannerName: `announce-${key}`,
  });

  const components = [];
  const form = a.formId ? config.forms.find((f) => f.id === a.formId) : null;
  if (form) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`t:open:${form.id}`)
          .setLabel(a.buttonLabel ?? form.label ?? form.id)
          .setStyle(ButtonStyle.Primary)
          .setEmoji(form.emoji || '📩'),
      ),
    );
  }

  return { embeds: [embed], components, files };
}

export function rulesMessage() {
  const r = config.rules ?? {};
  const { embed, files } = sectionsEmbed(r, {
    bannerFile: r.bannerFile,
    bannerUrl: r.bannerUrl,
    logoFile: r.logoFile ?? config.logoFile,
    logoUrl: r.logoUrl ?? config.logoUrl,
    bannerName: 'rules',
  });
  return { embeds: [embed], files };
}

export function formPicker() {
  // формы с onPanel: false живут на своих панелях (например, рекламная)
  const forms = config.forms.filter((f) => f.onPanel !== false);
  if (!forms.length) return [];

  if (forms.length > 3) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('t:pick')
      .setPlaceholder('Обери тип заявки')
      .addOptions(
        forms.map((f) => ({
          label: f.label ?? f.id,
          value: f.id,
          description: f.description?.slice(0, 100),
          emoji: f.emoji || undefined,
        })),
      );
    return [new ActionRowBuilder().addComponents(menu)];
  }

  const buttons = forms.map((f) =>
    new ButtonBuilder()
      .setCustomId(`t:open:${f.id}`)
      .setLabel(f.label ?? f.id)
      .setStyle(ButtonStyle.Primary)
      .setEmoji(f.emoji || '📩'),
  );
  return [new ActionRowBuilder().addComponents(buttons)];
}

export function formModal(form, page = 0) {
  const pages = pagesOf(form);
  const questions = pages[page] ?? [];
  const title = pages.length > 1 ? `${form.label ?? 'Заявка'} (${page + 1}/${pages.length})` : (form.label ?? 'Заявка');
  const modal = new ModalBuilder().setCustomId(`t:form:${form.id}:${page}`).setTitle(title.slice(0, 45));

  for (const q of questions) {
    const input = new TextInputBuilder()
      .setCustomId(q.id)
      .setLabel((q.label ?? q.id).slice(0, 45))
      .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(q.required !== false);
    if (q.placeholder) input.setPlaceholder(q.placeholder.slice(0, 100));
    if (q.maxLength) input.setMaxLength(Math.min(q.maxLength, 1024));
    if (q.minLength) input.setMinLength(q.minLength);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  return modal;
}

export function nextStepButton(formId, page, total) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`t:next:${formId}:${page}`)
        .setLabel(`Продовжити — крок ${page + 1} з ${total}`)
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

export function applicationEmbed({ form, answers, user, number, status = 'open', claimedBy = null }) {
  const embed = new EmbedBuilder()
    .setColor(
      status === 'accepted' ? config.colors.success : status === 'denied' ? config.colors.danger : config.colors.primary,
    )
    .setAuthor({ name: `${user.tag} — ${form.label ?? form.id}`, iconURL: user.displayAvatarURL() })
    .setTitle(`${form.emoji || '📩'} Заявка #${String(number).padStart(4, '0')}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: fill('{clan} • замовлення') })
    .setTimestamp();

  for (const q of form.questions) {
    const value = answers[q.id]?.trim();
    if (!value) continue;
    const long = q.style === 'paragraph' || value.length > 60;
    embed.addFields({
      name: `${long ? '📝' : '▸'} ${q.label ?? q.id}`,
      value: long ? `>>> ${value.slice(0, 1000)}` : `\`\`\`${value.slice(0, 200)}\`\`\``,
      inline: !long,
    });
  }

  embed.addFields({
    name: '👤 Замовник',
    value: `<@${user.id}> • \`${user.id}\`\nАкаунт створено: <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
  });

  const label =
    status === 'accepted'
      ? '🟢 Прийнято в роботу'
      : status === 'denied'
        ? '🔴 Відмова'
        : claimedBy
          ? `🟡 В роботі у <@${claimedBy}>`
          : '⚪ Очікує розгляду';
  embed.addFields({ name: 'Статус', value: label });

  return embed;
}

export function ticketControls({ status = 'open', claimed = false } = {}) {
  const done = status !== 'open';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('t:claim')
      .setLabel(claimed ? 'Взято' : 'Взяти в роботу')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(done || claimed),
    new ButtonBuilder().setCustomId('t:accept').setLabel('Прийняти').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(done),
    new ButtonBuilder().setCustomId('t:deny').setLabel('Відмовити').setEmoji('⛔').setStyle(ButtonStyle.Danger).setDisabled(done),
    new ButtonBuilder().setCustomId('t:close').setLabel('Закрити').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
  );
  return [row];
}

export function welcomeEmbed({ form, user }) {
  return new EmbedBuilder()
    .setColor(config.colors.neutral)
    .setDescription(
      [
        `Привіт, <@${user.id}>! Заявку **${form.label ?? form.id}** прийнято — менеджер відповість найближчим часом.`,
        '',
        'Поки чекаєш — додай усе, що допоможе зрозуміти задачу: скріншоти сервера, приклади стилю, посилання на референси.',
        'Канал бачиш лише ти та менеджер. Закрити можна кнопкою **🔒 Закрити**.',
      ].join('\n'),
    );
}

export function resultEmbed({ accepted, reason, byId }) {
  const embed = new EmbedBuilder()
    .setColor(accepted ? config.colors.success : config.colors.danger)
    .setTitle(accepted ? '✅ Замовлення прийнято в роботу' : '⛔ Заявку відхилено')
    .setTimestamp();
  const lines = [`Рішення прийняв: <@${byId}>`];
  if (reason) lines.push(`Причина: ${reason}`);
  if (accepted) lines.push('', fill('Домовились. Наступний крок — передоплата, далі беремось до роботи.'));
  embed.setDescription(lines.join('\n'));
  return embed;
}

export function dmEmbed({ accepted, reason, guildName }) {
  return new EmbedBuilder()
    .setColor(accepted ? config.colors.success : config.colors.danger)
    .setTitle(accepted ? fill('✅ Замовлення прийнято — {clan}') : fill('⛔ Відмова по заявці — {clan}'))
    .setDescription(
      accepted
        ? `Твоє замовлення на сервері **${guildName}** прийнято в роботу. Деталі — у каналі заявки.`
        : `Заявку на сервері **${guildName}** відхилено.${reason ? `\n\n**Причина:** ${reason}` : ''}\n\nМожна звернутися ще раз пізніше.`,
    )
    .setTimestamp();
}
