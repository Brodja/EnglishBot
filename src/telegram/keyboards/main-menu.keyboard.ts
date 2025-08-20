import { Markup } from 'telegraf';

export const mainMenuKeyboard = () =>
  Markup.keyboard([
    ['📚 Перейти до навчання'],
    ['🔗 Додати посилання'],
  ])
    .resize()
    .persistent();

export const learningMenuKeyboard = () =>
  Markup.keyboard([
    ['🇺🇸 Отримати англійське слово'],
    ['🇺🇦 Отримати переклад'],
    ['⬅️ Назад'],
  ])
    .resize()
    .persistent();
