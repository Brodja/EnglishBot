import { Markup } from 'telegraf';

export const mainMenuKeyboard = () =>
  Markup.keyboard([
    ['📚 Перейти до навчання'],
    ['🔄 Синхронізувати', '🔗 Додати посилання'],
    ['ℹ️ Допомога', '📝 Оновлення'],
  ])
    .resize()
    .persistent();

export const learningMenuKeyboard = () =>
  Markup.keyboard([
    ['🇺🇸 Отримати англійське слово', '🇺🇦 Отримати переклад'],
    ['📚 Керувати вивченими словами', '🔄 Синхронізувати'],
    ['⬅️ Назад'],
  ])
    .resize()
    .persistent();

export const learnedWordsKeyboard = () =>
  Markup.keyboard([
    ['📋 Показати вивчені слова', '🗑️ Видалити вивчені слова'],
    ['⬅️ Назад до навчання'],
  ])
    .resize()
    .persistent();
