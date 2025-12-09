import { Markup } from 'telegraf';

export const mainMenuKeyboard = () =>
  Markup.keyboard([
    ['🎅 Створити кімнату'],
    ['🎁 Приєднатися до кімнати'],
    ['🏠 Моя кімната'],
  ])
    .resize()
    .persistent();

export const adminMenuKeyboard = () =>
  Markup.keyboard([
    ['👥 Перегляд учасників'],
    ['🚫 Керувати ігнор-листами'],
    ['🔗 Посилання на кімнату'],
    ['🎲 Запустити розподіл'],
    ['🗑️ Видалити кімнату'],
    ['⬅️ Головне меню'],
  ])
    .resize()
    .persistent();

export const userMenuKeyboard = () =>
  Markup.keyboard([
    ['👥 Список учасників'],
    ['🎁 Редагувати опис подарунку'],
    ['👤 Змінити ім\'я'],
    ['🚪 Покинути кімнату'],
    ['⬅️ Головне меню'],
  ])
    .resize()
    .persistent();
