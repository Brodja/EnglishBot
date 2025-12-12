import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, session } from 'telegraf';
import { BotContext } from './interfaces/bot-context.interface';
import { UserService } from '../user/user.service';
import { RoomService } from '../room/room.service';
import { AssignmentService } from './services/assignment.service';
import { RoomStatus } from '../room/schemas/room.schema';
import { mainMenuKeyboard, adminMenuKeyboard, userMenuKeyboard } from './keyboards/main-menu.keyboard';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf<BotContext>;

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly roomService: RoomService,
    private readonly assignmentService: AssignmentService,
  ) {
    const token = this.configService.get<string>('telegram.apiKey');
    if (!token) {
      throw new Error('Telegram API key is not provided');
    }
    this.bot = new Telegraf<BotContext>(token);
    
    // Додаємо middleware для сесій
    this.bot.use(session());
    
    this.setupBotHandlers();
  }

  async onModuleInit() {
    try {
      await this.bot.launch();
      this.logger.log('🎅 Secret Santa bot started successfully');
    } catch (error) {
      this.logger.error('Failed to start Secret Santa bot:', error);
    }
  }

  private setupBotHandlers() {
    // Команда /start
    this.bot.start(async (ctx) => {
      const user = ctx.from;
      if (!user) return;

      // Перевіряємо чи це приєднання до кімнати
      const startPayload = ctx.startPayload;
      if (startPayload) {
        await this.handleJoinRoom(ctx, startPayload);
        return;
      }

      // Створюємо або знаходимо користувача
      let dbUser = await this.userService.findByTelegramId(user.id);
      if (!dbUser) {
        dbUser = await this.userService.createUser({
          telegramId: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          username: user.username,
        });
      }

      await ctx.reply(
        `Хоу-хоу-хоу! 🎅\n\n` +
        `Привіт, ${user.first_name}! Я бот для гри "Таємний Санта".\n\n` +
        `🎁 Створи кімнату та запроси друзів\n` +
        `🎲 Я зроблю випадковий розподіл\n` +
        `🤫 Кожен дізнається кому дарувати`,
        mainMenuKeyboard()
      );
    });

    // Створення кімнати
    this.bot.hears('🎅 Створити кімнату', async (ctx) => {
      // Перевіряємо чи користувач вже в кімнаті
      const existingRoom = await this.roomService.findUserRoom(ctx.from.id);
      if (existingRoom) {
        await ctx.reply(
          `❌ Ви вже знаходитесь в кімнаті "${existingRoom.name}" (#${existingRoom.roomId})\n\n` +
          `Спочатку покиньте поточну кімнату або перейдіть до управління нею.`,
          mainMenuKeyboard()
        );
        return;
      }

      await ctx.reply(
        '🎅 Як тебе представити в кімнаті?\n\n' +
        'Напиши своє ім\'я або псевдонім, щоб учасники знали, хто ти:'
      );
      
      ctx.session = { awaitingDisplayName: true };
    });

    // Приєднання до кімнати
    this.bot.hears('🎁 Приєднатися до кімнати', async (ctx) => {
      await ctx.reply(
        '🎁 Щоб приєднатися до кімнати, перейдіть за посиланням від адміністратора.\n\n' +
        'Посилання має вигляд: t.me/botname?start=123456'
      );
    });

    // Моя кімната
    this.bot.hears('🏠 Моя кімната', async (ctx) => {
      const room = await this.roomService.findUserRoom(ctx.from.id);
      
      if (!room) {
        await ctx.reply(
          '❌ Ви не знаходитесь в жодній кімнаті.\n\n' +
          'Створіть нову кімнату або приєднайтеся до існуючої.',
          mainMenuKeyboard()
        );
        return;
      }

      const isAdmin = room.adminId === ctx.from.id;
      const statusText = room.status === RoomStatus.WAITING ? '⏳ Очікування' : 
                        room.status === RoomStatus.ACTIVE ? '🎮 Активна' : '✅ Завершена';

      await ctx.reply(
        `🏠 Кімната: ${room.name}\n` +
        `🆔 ID: #${room.roomId}\n` +
        `📊 Статус: ${statusText}\n` +
        `👥 Учасників: ${room.participants.length}\n` +
        `👑 Адмін: ${isAdmin ? 'Ви' : 'Інший користувач'}`,
        isAdmin ? adminMenuKeyboard() : userMenuKeyboard()
      );
    });

    // === АДМІН МЕНЮ ===

    // Перегляд учасників
    this.bot.hears('👥 Перегляд учасників', async (ctx) => {
      const room = await this.roomService.findUserRoom(ctx.from.id);
      if (!room || room.adminId !== ctx.from.id) {
        await ctx.reply('❌ Ви не є адміністратором кімнати.', mainMenuKeyboard());
        return;
      }

      const users = await this.userService.findMultipleByTelegramIds(room.participants);
      
      // Створюємо мапу користувачів для швидкого пошуку
      const userMap = new Map(users.map(user => [user.telegramId, user]));
      
      const userList = users.map((user, index) => {
        const name = user.displayName || user.firstName || 'Без імені';
        const username = user.username ? `@${user.username}` : '';
        const isAdmin = user.telegramId === room.adminId ? '👑' : '';
        
        // Формуємо список ігнорованих користувачів
        let ignoreInfo = '';
        if (user.ignoreList && user.ignoreList.length > 0) {
          const ignoredNames = user.ignoreList
            .map(ignoredId => {
              const ignoredUser = userMap.get(ignoredId);
              return ignoredUser?.displayName || ignoredUser?.firstName || `ID:${ignoredId}`;
            })
            .join(', ');
          ignoreInfo = ` (ігнорує: ${ignoredNames})`;
        }
        
        return `${index + 1}. ${name} ${username} ${isAdmin}${ignoreInfo}`;
      }).join('\n');

      await ctx.reply(
        `👥 Учасники кімнати "${room.name}":\n\n${userList}`,
        adminMenuKeyboard()
      );
    });

    // Посилання на кімнату
    this.bot.hears('🔗 Посилання на кімнату', async (ctx) => {
      const room = await this.roomService.findUserRoom(ctx.from.id);
      if (!room || room.adminId !== ctx.from.id) {
        await ctx.reply('❌ Ви не є адміністратором кімнати.', mainMenuKeyboard());
        return;
      }

      const botUsername = this.bot.botInfo?.username || 'bot';
      const inviteLink = `t.me/${botUsername}?start=${room.roomId}`;

      await ctx.reply(
        `🔗 Посилання для запрошення:\n\n` +
        `${inviteLink}\n\n` +
        `Надішліть це посилання друзям, щоб вони могли приєднатися до кімнати.`,
        adminMenuKeyboard()
      );
    });

    // Керування ігнор-листами
    this.bot.hears('🚫 Керувати ігнор-листами', async (ctx) => {
      const room = await this.roomService.findUserRoom(ctx.from.id);
      if (!room || room.adminId !== ctx.from.id) {
        await ctx.reply('❌ Ви не є адміністратором кімнати.', mainMenuKeyboard());
        return;
      }

      const users = await this.userService.findMultipleByTelegramIds(room.participants);
      
      if (users.length < 2) {
        await ctx.reply('❌ Потрібно мінімум 2 учасники для налаштування ігнор-листів.', adminMenuKeyboard());
        return;
      }

      // Створюємо inline клавіатуру з учасниками
      const keyboard = [];
      for (let i = 0; i < users.length; i += 2) {
        const row = [];
        const user1 = users[i];
        const name1 = user1.displayName || user1.firstName || 'Без імені';
        row.push({ text: `👤 ${name1}`, callback_data: `manage_ignore_${user1.telegramId}` });
        
        if (users[i + 1]) {
          const user2 = users[i + 1];
          const name2 = user2.displayName || user2.firstName || 'Без імені';
          row.push({ text: `👤 ${name2}`, callback_data: `manage_ignore_${user2.telegramId}` });
        }
        keyboard.push(row);
      }
      keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_to_admin_menu' }]);

      await ctx.reply(
        '🚫 Керування ігнор-листами\n\n' +
        'Виберіть учасника, для якого хочете налаштувати ігнор-лист:',
        { reply_markup: { inline_keyboard: keyboard } }
      );
    });

    // Запуск розподілу
    this.bot.hears('🎲 Запустити розподіл', async (ctx) => {
      const room = await this.roomService.findUserRoom(ctx.from.id);
      if (!room || room.adminId !== ctx.from.id) {
        await ctx.reply('❌ Ви не є адміністратором кімнати.', mainMenuKeyboard());
        return;
      }

      if (room.status !== RoomStatus.WAITING) {
        await ctx.reply('❌ Розподіл вже було зроблено.', adminMenuKeyboard());
        return;
      }

      if (room.participants.length < 3) {
        await ctx.reply('❌ Для гри потрібно мінімум 3 учасники.', adminMenuKeyboard());
        return;
      }

      try {
        // Повідомляємо про початок розподілу
        const statusMessage = await ctx.reply(
          '🎲 Створюю розподіл...\n\n' +
          '⏳ Аналізую ігнор-листи та шукаю оптимальний варіант...'
        );

        const result = await this.assignmentService.createAssignments(room.participants);
        
        if (!result.success) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMessage.message_id,
            undefined,
            `❌ Розподіл неможливий!\n\n` +
            `${result.error}\n\n` +
            `Спроб зроблено: ${result.attempts || 0}`
          );
          
          // Через 3 секунди пропонуємо спробувати ще раз
          setTimeout(async () => {
            await ctx.reply(
              '🔄 Хочете спробувати ще раз?\n\n' +
              'Можливо варто:\n' +
              '• Змінити ігнор-листи\n' +
              '• Додати більше учасників\n' +
              '• Або просто спробувати ще раз',
              adminMenuKeyboard()
            );
          }, 3000);
          return;
        }

        // Успішний розподіл
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          undefined,
          `✅ Розподіл знайдено!\n\n` +
          `🎯 Спроб потрібно було: ${result.attempts}\n` +
          `⏳ Зберігаю результати та надсилаю повідомлення...`
        );

        // Зберігаємо розподіл
        await this.roomService.startGame(room.roomId, result.assignment!);

        // Зберігаємо призначення для кожного користувача
        for (const [giverId, receiverId] of Object.entries(result.assignment!)) {
          await this.userService.setAssignment(parseInt(giverId), receiverId);
        }

        // Надсилаємо повідомлення всім учасникам
        await this.notifyParticipants(room.participants, result.assignment!);

        // Оновлюємо статус повідомлення
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          undefined,
          `🎉 Розподіл завершено!\n\n` +
          `✅ Всі ${room.participants.length} учасників отримали повідомлення\n` +
          `🎯 Спроб потрібно було: ${result.attempts}\n\n` +
          `🤫 Гра почалася! Тримайте призначення в секреті!`
        );

      } catch (error) {
        this.logger.error('Error creating assignments:', error);
        await ctx.reply(
          '❌ Технічна помилка при створенні розподілу.\n\n' +
          'Спробуйте ще раз через кілька секунд.',
          adminMenuKeyboard()
        );
      }
    });

    // === USER МЕНЮ ===

    // Список учасників (для звичайних користувачів)
    this.bot.hears('👥 Список учасників', async (ctx) => {
      const room = await this.roomService.findUserRoom(ctx.from.id);
      if (!room) {
        await ctx.reply('❌ Ви не знаходитесь в кімнаті.', mainMenuKeyboard());
        return;
      }

      const users = await this.userService.findMultipleByTelegramIds(room.participants);
      
      // Створюємо мапу користувачів для швидкого пошуку
      const userMap = new Map(users.map(user => [user.telegramId, user]));
      
      const userList = users.map((user, index) => {
        const name = user.displayName || user.firstName || 'Без імені';
        const username = user.username ? `@${user.username}` : '';
        const isAdmin = user.telegramId === room.adminId ? '👑' : '';
        const isMe = user.telegramId === ctx.from.id ? '(ви)' : '';
        
        // Формуємо список ігнорованих користувачів
        let ignoreInfo = '';
        if (user.ignoreList && user.ignoreList.length > 0) {
          const ignoredNames = user.ignoreList
            .map(ignoredId => {
              const ignoredUser = userMap.get(ignoredId);
              return ignoredUser?.displayName || ignoredUser?.firstName || `ID:${ignoredId}`;
            })
            .join(', ');
          ignoreInfo = ` (ігнорує: ${ignoredNames})`;
        }
        
        return `${index + 1}. ${name} ${username} ${isAdmin} ${isMe}${ignoreInfo}`.trim();
      }).join('\n');

      const statusText = room.status === RoomStatus.WAITING ? '⏳ Очікування' : 
                        room.status === RoomStatus.ACTIVE ? '🎮 Активна' : '✅ Завершена';

      await ctx.reply(
        `👥 Учасники кімнати "${room.name}":\n` +
        `📊 Статус: ${statusText}\n\n` +
        `${userList}`,
        userMenuKeyboard()
      );
    });

    // Редагування опису подарунку
    this.bot.hears('🎁 Редагувати опис подарунку', async (ctx) => {
      const room = await this.roomService.findUserRoom(ctx.from.id);
      if (!room) {
        await ctx.reply('❌ Ви не знаходитесь в кімнаті.', mainMenuKeyboard());
        return;
      }

      const user = await this.userService.findByTelegramId(ctx.from.id);
      const currentDescription = user?.giftDescription || 'Не вказано';

      await ctx.reply(
        `🎁 Поточний опис подарунку:\n${currentDescription}\n\n` +
        'Напишіть новий опис того, що ви хочете отримати:'
      );

      ctx.session = { awaitingGiftDescription: true };
    });

    // Змінити ім'я
    this.bot.hears('👤 Змінити ім\'я', async (ctx) => {
      const room = await this.roomService.findUserRoom(ctx.from.id);
      if (!room) {
        await ctx.reply('❌ Ви не знаходитесь в кімнаті.', mainMenuKeyboard());
        return;
      }

      const user = await this.userService.findByTelegramId(ctx.from.id);
      const currentName = user?.displayName || user?.firstName || 'Не вказано';

      await ctx.reply(
        `👤 Поточне ім'я: ${currentName}\n\n` +
        'Напишіть нове ім\'я:'
      );

      ctx.session = { awaitingDisplayName: true, isNameChange: true };
    });

    // Покинути кімнату
    this.bot.hears('🚪 Покинути кімнату', async (ctx) => {
      const room = await this.roomService.findUserRoom(ctx.from.id);
      if (!room) {
        await ctx.reply('❌ Ви не знаходитесь в кімнаті.', mainMenuKeyboard());
        return;
      }

      if (room.adminId === ctx.from.id) {
        await ctx.reply(
          '❌ Адміністратор не може покинути кімнату.\n\n' +
          'Видаліть кімнату або передайте права адміністратора іншому учаснику.',
          adminMenuKeyboard()
        );
        return;
      }

      await this.roomService.removeParticipant(room.roomId, ctx.from.id);
      await this.userService.clearCurrentRoom(ctx.from.id);

      await ctx.reply(
        `✅ Ви покинули кімнату "${room.name}".`,
        mainMenuKeyboard()
      );
    });

    // Видалення кімнати (тільки для адміна)
    this.bot.hears('🗑️ Видалити кімнату', async (ctx) => {
      const room = await this.roomService.findUserRoom(ctx.from.id);
      if (!room || room.adminId !== ctx.from.id) {
        await ctx.reply('❌ Ви не є адміністратором кімнати.', mainMenuKeyboard());
        return;
      }

      // Підтвердження видалення
      await ctx.reply(
        `⚠️ Ви впевнені, що хочете видалити кімнату "${room.name}"?\n\n` +
        `👥 Учасників: ${room.participants.length}\n` +
        `📊 Статус: ${room.status === RoomStatus.WAITING ? 'Очікування' : 
                     room.status === RoomStatus.ACTIVE ? 'Активна' : 'Завершена'}\n\n` +
        `⚠️ Всі учасники отримають повідомлення про видалення кімнати.\n` +
        `Цю дію неможливо скасувати!`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Так, видалити', callback_data: `delete_room_${room.roomId}` },
                { text: '❌ Скасувати', callback_data: 'cancel_delete_room' }
              ]
            ]
          }
        }
      );
    });

    // Назад до головного меню
    this.bot.hears('⬅️ Головне меню', async (ctx) => {
      await ctx.reply('🎅 Головне меню:', mainMenuKeyboard());
    });

    // Обробка текстових повідомлень
    this.bot.on('text', async (ctx) => {
      const session = ctx.session || {};

      if (session.awaitingDisplayName) {
        await this.handleDisplayNameInput(ctx, ctx.message.text.trim());
      } else if (session.awaitingRoomName) {
        await this.handleRoomNameInput(ctx, ctx.message.text.trim());
      } else if (session.awaitingGiftDescription) {
        await this.handleGiftDescriptionInput(ctx, ctx.message.text.trim());
      } else {
        await ctx.reply(
          'Використовуйте кнопки меню для навігації 👇',
          mainMenuKeyboard()
        );
      }
    });

    // Обробка inline кнопок
    this.bot.on('callback_query', async (ctx) => {
      if (!('data' in ctx.callbackQuery)) return;
      const data = ctx.callbackQuery.data;
      
      if (data.startsWith('manage_ignore_')) {
        await this.handleManageIgnoreList(ctx, data.replace('manage_ignore_', ''));
      } else if (data.startsWith('add_ignore_')) {
        await this.handleAddToIgnoreList(ctx, data.replace('add_ignore_', ''));
      } else if (data.startsWith('remove_ignore_')) {
        await this.handleRemoveFromIgnoreList(ctx, data.replace('remove_ignore_', ''));
      } else if (data.startsWith('delete_room_')) {
        await this.handleDeleteRoom(ctx, data.replace('delete_room_', ''));
      } else if (data === 'cancel_delete_room') {
        await ctx.deleteMessage();
        await ctx.reply('❌ Видалення кімнати скасовано.', adminMenuKeyboard());
      } else if (data === 'back_to_admin_menu') {
        await ctx.deleteMessage();
        await ctx.reply('👑 Панель адміністратора:', adminMenuKeyboard());
      } else if (data === 'back_to_ignore_management') {
        // Повертаємося до вибору учасника
        const room = await this.roomService.findUserRoom(ctx.from.id);
        if (room) {
          const users = await this.userService.findMultipleByTelegramIds(room.participants);
          const keyboard = [];
          for (let i = 0; i < users.length; i += 2) {
            const row = [];
            const user1 = users[i];
            const name1 = user1.displayName || user1.firstName || 'Без імені';
            row.push({ text: `👤 ${name1}`, callback_data: `manage_ignore_${user1.telegramId}` });
            
            if (users[i + 1]) {
              const user2 = users[i + 1];
              const name2 = user2.displayName || user2.firstName || 'Без імені';
              row.push({ text: `👤 ${name2}`, callback_data: `manage_ignore_${user2.telegramId}` });
            }
            keyboard.push(row);
          }
          keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_to_admin_menu' }]);

          await ctx.editMessageText(
            '🚫 Керування ігнор-листами\n\n' +
            'Виберіть учасника, для якого хочете налаштувати ігнор-лист:',
            { reply_markup: { inline_keyboard: keyboard } }
          );
        }
      }
    });

    // Обробка помилок
    this.bot.catch((err, ctx) => {
      this.logger.error(`Bot error for ${ctx.updateType}:`, err);
      ctx.reply('Виникла помилка. Спробуйте ще раз.');
    });
  }

  // === ДОПОМІЖНІ МЕТОДИ ===

  private async handleJoinRoom(ctx: any, roomId: string) {
    const user = ctx.from;
    if (!user) return;

    // Створюємо користувача якщо не існує
    let dbUser = await this.userService.findByTelegramId(user.id);
    if (!dbUser) {
      dbUser = await this.userService.createUser({
        telegramId: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
      });
    }

    // Перевіряємо чи існує кімната
    const room = await this.roomService.findByRoomId(roomId);
    if (!room) {
      await ctx.reply('❌ Кімната не знайдена або більше не існує.', mainMenuKeyboard());
      return;
    }

    if (room.status !== RoomStatus.WAITING) {
      await ctx.reply('❌ Неможливо приєднатися. Гра вже почалася.', mainMenuKeyboard());
      return;
    }

    // Перевіряємо чи користувач вже в кімнаті
    if (room.participants.includes(user.id)) {
      await ctx.reply(
        `❌ Ви вже знаходитесь в кімнаті "${room.name}".`,
        mainMenuKeyboard()
      );
      return;
    }

    // Перевіряємо чи користувач в іншій кімнаті
    const existingRoom = await this.roomService.findUserRoom(user.id);
    if (existingRoom) {
      await ctx.reply(
        `❌ Ви вже знаходитесь в іншій кімнаті "${existingRoom.name}".\n\n` +
        'Спочатку покиньте поточну кімнату.',
        mainMenuKeyboard()
      );
      return;
    }

    await ctx.reply(
      `🎅 Приєднання до кімнати "${room.name}"\n\n` +
      `👤 Крок 1/2: Як тебе представити в кімнаті?\n` +
      'Напиши своє ім\'я або псевдонім:'
    );

    ctx.session = { awaitingDisplayName: true, currentRoomId: roomId, isJoiningRoom: true };
  }

  private async handleDisplayNameInput(ctx: any, displayName: string) {
    const session = ctx.session || {};
    
    if (session.isNameChange) {
      // Зміна імені в існуючій кімнаті
      await this.userService.updateDisplayName(ctx.from.id, displayName);
      
      await ctx.reply(
        `✅ Ім'я змінено на: ${displayName}`,
        userMenuKeyboard()
      );
      ctx.session = {};
    } else if (session.isJoiningRoom && session.currentRoomId) {
      // Приєднання до існуючої кімнати - зберігаємо ім'я і просимо опис подарунку
      await this.userService.updateDisplayName(ctx.from.id, displayName);
      
      const room = await this.roomService.findByRoomId(session.currentRoomId);
      
      await ctx.reply(
        `✅ Ваше ім'я: ${displayName}\n\n` +
        `🎁 Тепер опишіть що ви хочете отримати в подарунок від свого Таємного Санти:\n\n` +
        `💡 Наприклад: "Книга про програмування", "Кава та солодощі", "Сертифікат в кінотеатр"`
      );
      
      ctx.session = { 
        awaitingGiftDescription: true, 
        currentRoomId: session.currentRoomId,
        isJoiningRoom: true,
        tempDisplayName: displayName
      };
    } else if (session.currentRoomId && !session.isJoiningRoom) {
      // Старий процес приєднання (для сумісності)
      await this.userService.updateDisplayName(ctx.from.id, displayName);
      await this.roomService.addParticipant(session.currentRoomId, ctx.from.id);
      await this.userService.setCurrentRoom(ctx.from.id, session.currentRoomId);

      const room = await this.roomService.findByRoomId(session.currentRoomId);
      
      await ctx.reply(
        `✅ Ви приєдналися до кімнати "${room?.name}"!\n\n` +
        `Ваше ім'я: ${displayName}`,
        userMenuKeyboard()
      );
      ctx.session = {};
    } else {
      // Створення нової кімнати
      await this.userService.updateDisplayName(ctx.from.id, displayName);
      
      await ctx.reply(
        `✅ Ваше ім'я: ${displayName}\n\n` +
        'Тепер придумайте назву для кімнати:'
      );
      
      ctx.session = { awaitingRoomName: true };
    }
  }

  private async handleRoomNameInput(ctx: any, roomName: string) {
    try {
      const room = await this.roomService.createRoom(roomName, ctx.from.id);
      await this.userService.setCurrentRoom(ctx.from.id, room.roomId);

      const botUsername = this.bot.botInfo?.username || 'bot';
      const inviteLink = `t.me/${botUsername}?start=${room.roomId}`;

      await ctx.reply(
        `🎉 Кімната "${roomName}" створена!\n\n` +
        `🆔 ID кімнати: #${room.roomId}\n\n` +
        `🔗 Посилання для запрошення:\n${inviteLink}\n\n` +
        `Надішліть це посилання друзям, щоб вони могли приєднатися.`,
        adminMenuKeyboard()
      );
    } catch (error) {
      this.logger.error('Error creating room:', error);
      await ctx.reply('❌ Помилка при створенні кімнати.', mainMenuKeyboard());
    }

    ctx.session = {};
  }

  private async handleGiftDescriptionInput(ctx: any, description: string) {
    const session = ctx.session || {};
    
    await this.userService.updateGiftDescription(ctx.from.id, description);
    
    if (session.isJoiningRoom && session.currentRoomId) {
      // Завершуємо процес приєднання до кімнати
      await this.roomService.addParticipant(session.currentRoomId, ctx.from.id);
      await this.userService.setCurrentRoom(ctx.from.id, session.currentRoomId);

      const room = await this.roomService.findByRoomId(session.currentRoomId);
      
      await ctx.reply(
        `🎉 Ви успішно приєдналися до кімнати "${room?.name}"!\n\n` +
        `👤 Ваше ім'я: ${session.tempDisplayName}\n` +
        `🎁 Ваш бажаний подарунок:\n${description}\n\n` +
        `Тепер чекайте поки адміністратор запустить розподіл!`,
        userMenuKeyboard()
      );
    } else {
      // Звичайне редагування опису подарунку
      await ctx.reply(
        `✅ Опис подарунку оновлено:\n\n${description}`,
        userMenuKeyboard()
      );
    }

    ctx.session = {};
  }

  private async notifyParticipants(participantIds: number[], assignments: { [telegramId: string]: number }) {
    const users = await this.userService.findMultipleByTelegramIds(participantIds);
    const userMap = new Map(users.map(user => [user.telegramId, user]));

    for (const [giverId, receiverId] of Object.entries(assignments)) {
      const giver = userMap.get(parseInt(giverId));
      const receiver = userMap.get(receiverId);

      if (giver && receiver) {
        const receiverName = receiver.displayName || receiver.firstName || 'Учасник';
        const giftDescription = receiver.giftDescription || 'Не вказано';

        try {
          await this.bot.telegram.sendMessage(
            parseInt(giverId),
            `🎅 Розподіл готовий!\n\n` +
            `🎁 Ви дарувальник для: ${receiverName}\n\n` +
            `💝 Що хоче отримати:\n${giftDescription}\n\n` +
            `🤫 Тримайте це в секреті!`
          );
        } catch (error) {
          this.logger.error(`Failed to notify user ${giverId}:`, error);
        }
      }
    }
  }

  private async handleManageIgnoreList(ctx: any, targetUserId: string) {
    const room = await this.roomService.findUserRoom(ctx.from.id);
    if (!room || room.adminId !== ctx.from.id) {
      await ctx.answerCbQuery('❌ Ви не є адміністратором кімнати.');
      return;
    }

    const targetId = parseInt(targetUserId);
    const targetUser = await this.userService.findByTelegramId(targetId);
    const allUsers = await this.userService.findMultipleByTelegramIds(room.participants);
    
    if (!targetUser) {
      await ctx.answerCbQuery('❌ Користувач не знайдений.');
      return;
    }

    const targetName = targetUser.displayName || targetUser.firstName || 'Без імені';
    const ignoreList = targetUser.ignoreList || [];
    
    // Створюємо клавіатуру з іншими учасниками
    const keyboard = [];
    
    // Розділяємо на тих, хто в ігнор-листі і тих, хто не в ньому
    const otherUsers = allUsers.filter(user => user.telegramId !== targetId);
    
    if (otherUsers.length === 0) {
      await ctx.editMessageText(
        `🚫 Ігнор-лист для ${targetName}\n\n` +
        'Немає інших учасників для налаштування.',
        { reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'back_to_ignore_management' }]] } }
      );
      return;
    }

    // Спочатку показуємо тих, хто НЕ в ігнор-листі (можна додати)
    const notIgnored = otherUsers.filter(user => !ignoreList.includes(user.telegramId));
    if (notIgnored.length > 0) {
      keyboard.push([{ text: '➕ Додати до ігнор-листу:', callback_data: 'header_add' }]);
      for (let i = 0; i < notIgnored.length; i += 2) {
        const row = [];
        const user1 = notIgnored[i];
        const name1 = user1.displayName || user1.firstName || 'Без імені';
        row.push({ text: `➕ ${name1}`, callback_data: `add_ignore_${targetId}_${user1.telegramId}` });
        
        if (notIgnored[i + 1]) {
          const user2 = notIgnored[i + 1];
          const name2 = user2.displayName || user2.firstName || 'Без імені';
          row.push({ text: `➕ ${name2}`, callback_data: `add_ignore_${targetId}_${user2.telegramId}` });
        }
        keyboard.push(row);
      }
    }

    // Потім показуємо тих, хто В ігнор-листі (можна видалити)
    const ignored = otherUsers.filter(user => ignoreList.includes(user.telegramId));
    if (ignored.length > 0) {
      if (keyboard.length > 0) keyboard.push([{ text: ' ', callback_data: 'spacer' }]);
      keyboard.push([{ text: '➖ Видалити з ігнор-листу:', callback_data: 'header_remove' }]);
      for (let i = 0; i < ignored.length; i += 2) {
        const row = [];
        const user1 = ignored[i];
        const name1 = user1.displayName || user1.firstName || 'Без імені';
        row.push({ text: `➖ ${name1}`, callback_data: `remove_ignore_${targetId}_${user1.telegramId}` });
        
        if (ignored[i + 1]) {
          const user2 = ignored[i + 1];
          const name2 = user2.displayName || user2.firstName || 'Без імені';
          row.push({ text: `➖ ${name2}`, callback_data: `remove_ignore_${targetId}_${user2.telegramId}` });
        }
        keyboard.push(row);
      }
    }

    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_to_ignore_management' }]);

    const ignoreListText = ignored.length > 0 
      ? ignored.map(u => u.displayName || u.firstName || 'Без імені').join(', ')
      : 'Порожній';

    await ctx.editMessageText(
      `🚫 Ігнор-лист для ${targetName}\n\n` +
      `Поточний ігнор-лист: ${ignoreListText}\n\n` +
      'Виберіть дію:',
      { reply_markup: { inline_keyboard: keyboard } }
    );
  }

  private async handleAddToIgnoreList(ctx: any, data: string) {
    const [targetUserId, ignoreUserId] = data.split('_').map(id => parseInt(id));
    
    await this.userService.addToIgnoreList(targetUserId, ignoreUserId);
    
    const targetUser = await this.userService.findByTelegramId(targetUserId);
    const ignoreUser = await this.userService.findByTelegramId(ignoreUserId);
    
    const targetName = targetUser?.displayName || targetUser?.firstName || 'Користувач';
    const ignoreName = ignoreUser?.displayName || ignoreUser?.firstName || 'Користувач';
    
    await ctx.answerCbQuery(`✅ ${ignoreName} додано до ігнор-листу ${targetName}`);
    
    // Оновлюємо інтерфейс
    await this.handleManageIgnoreList(ctx, targetUserId.toString());
  }

  private async handleRemoveFromIgnoreList(ctx: any, data: string) {
    const [targetUserId, ignoreUserId] = data.split('_').map(id => parseInt(id));
    
    await this.userService.removeFromIgnoreList(targetUserId, ignoreUserId);
    
    const targetUser = await this.userService.findByTelegramId(targetUserId);
    const ignoreUser = await this.userService.findByTelegramId(ignoreUserId);
    
    const targetName = targetUser?.displayName || targetUser?.firstName || 'Користувач';
    const ignoreName = ignoreUser?.displayName || ignoreUser?.firstName || 'Користувач';
    
    await ctx.answerCbQuery(`✅ ${ignoreName} видалено з ігнор-листу ${targetName}`);
    
    // Оновлюємо інтерфейс
    await this.handleManageIgnoreList(ctx, targetUserId.toString());
  }

  private async handleDeleteRoom(ctx: any, roomId: string) {
    const room = await this.roomService.findByRoomId(roomId);
    if (!room || room.adminId !== ctx.from.id) {
      await ctx.answerCbQuery('❌ Ви не є адміністратором цієї кімнати.');
      return;
    }

    try {
      // Отримуємо список всіх учасників для повідомлення
      const users = await this.userService.findMultipleByTelegramIds(room.participants);
      const adminUser = users.find(u => u.telegramId === room.adminId);
      const adminName = adminUser?.displayName || adminUser?.firstName || 'Адміністратор';

      // Видаляємо повідомлення з підтвердженням
      await ctx.deleteMessage();

      // Повідомляємо про початок видалення
      const statusMessage = await ctx.reply(
        `🗑️ Видаляю кімнату "${room.name}"...\n\n` +
        `📤 Надсилаю повідомлення ${room.participants.length} учасникам...`
      );

      // Надсилаємо повідомлення всім учасникам (крім адміна)
      const notificationPromises = room.participants
        .filter(participantId => participantId !== room.adminId)
        .map(async (participantId) => {
          try {
            await this.bot.telegram.sendMessage(
              participantId,
              `🗑️ Кімнату "${room.name}" було видалено\n\n` +
              `👑 Адміністратор: ${adminName}\n` +
              `📅 Дата видалення: ${new Date().toLocaleString('uk-UA')}\n\n` +
              `Ви можете створити нову кімнату або приєднатися до іншої.`,
              mainMenuKeyboard()
            );
          } catch (error) {
            this.logger.error(`Failed to notify user ${participantId} about room deletion:`, error);
          }
        });

      // Чекаємо поки всі повідомлення надішлються
      await Promise.allSettled(notificationPromises);

      // Очищаємо прив'язку до кімнати у всіх учасників
      const clearUserPromises = room.participants.map(participantId => 
        this.userService.clearCurrentRoom(participantId)
      );
      await Promise.allSettled(clearUserPromises);

      // Видаляємо кімнату з бази даних
      await this.roomService.deleteRoom(roomId);

      // Оновлюємо статус повідомлення
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        undefined,
        `✅ Кімнату "${room.name}" успішно видалено!\n\n` +
        `📤 Повідомлення надіслано всім учасникам\n` +
        `🗑️ Дані очищено з бази даних`
      );

      // Через 3 секунди показуємо головне меню
      setTimeout(async () => {
        await ctx.reply(
          '🎅 Ви повернулися до головного меню.\n\n' +
          'Можете створити нову кімнату або приєднатися до існуючої.',
          mainMenuKeyboard()
        );
      }, 3000);

    } catch (error) {
      this.logger.error('Error deleting room:', error);
      await ctx.reply(
        '❌ Помилка при видаленні кімнати.\n\n' +
        'Спробуйте ще раз або зверніться до підтримки.',
        adminMenuKeyboard()
      );
    }
  }

  async onApplicationShutdown() {
    await this.bot.stop();
    this.logger.log('Secret Santa bot stopped');
  }
}
