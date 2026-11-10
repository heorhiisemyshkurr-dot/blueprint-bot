/**
 * Черновики многошаговых форм: ответы первых страниц держим в памяти,
 * пока кандидат не дойдёт до последнего шага.
 */
const TTL_MS = 15 * 60 * 1000;
const drafts = new Map();

const key = (userId, formId) => `${userId}:${formId}`;

function sweep() {
  const now = Date.now();
  for (const [k, v] of drafts) if (v.expires < now) drafts.delete(k);
}

export function getDraft(userId, formId) {
  sweep();
  return drafts.get(key(userId, formId))?.answers ?? {};
}

export function mergeDraft(userId, formId, answers) {
  sweep();
  const merged = { ...getDraft(userId, formId), ...answers };
  drafts.set(key(userId, formId), { answers: merged, expires: Date.now() + TTL_MS });
  return merged;
}

export function clearDraft(userId, formId) {
  drafts.delete(key(userId, formId));
}
