import { Markup } from 'telegraf';

export const mainMenuKeyboard = (isAdmin = false) => {
  const rows: string[][] = [
    ['📚 Навчання', '🔁 Повторення'],
    ['🔄 Синхронізувати', '🔗 Моя таблиця'],
    ['ℹ️ Допомога', '📝 Оновлення'],
    ['📬 Зворотний зв\'язок'],
  ];
  if (isAdmin) rows.push(['📥 Повідомлення', '📢 Анонсувати']);
  return Markup.keyboard(rows).resize().persistent();
};

export const learningMenuKeyboard = () =>
  Markup.keyboard([
    ['🇺🇸 Англійське', '🇺🇦 Український'],
    ['📚 Вивчені', '🔄 Синхронізувати'],
    ['⬅️ Назад'],
  ])
    .resize()
    .persistent();

export const reviewMenuKeyboard = () =>
  Markup.keyboard([
    ['🔁🇺🇸 Англійське', '🔁🇺🇦 Український'],
    ['⬅️ Назад'],
  ])
    .resize()
    .persistent();

export const learnedWordsKeyboard = () =>
  Markup.keyboard([
    ['📋 Усі вивчені', '🗑️ Видалити'],
    ['⬅️ До навчання'],
  ])
    .resize()
    .persistent();
