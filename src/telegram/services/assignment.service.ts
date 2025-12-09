import { Injectable, Logger } from '@nestjs/common';
import { UserService } from '../../user/user.service';

@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(private readonly userService: UserService) {}

  /**
   * Створює розподіл учасників з урахуванням ігнор-листів
   */
  async createAssignments(participantIds: number[]): Promise<{ 
    success: boolean; 
    assignment?: { [telegramId: string]: number }; 
    attempts?: number;
    error?: string;
  }> {
    if (participantIds.length < 3) {
      return { success: false, error: 'Для гри потрібно мінімум 3 учасники' };
    }

    // Отримуємо дані користувачів з їх ігнор-листами
    const users = await this.userService.findMultipleByTelegramIds(participantIds);
    const userMap = new Map(users.map(user => [user.telegramId, user]));

    // Створюємо граф можливих призначень з двостороннім ігноруванням
    const possibleAssignments = new Map<number, number[]>();
    
    for (const giverId of participantIds) {
      const giver = userMap.get(giverId);
      const giverIgnoreList = giver?.ignoreList || [];
      
      // Можливі отримувачі = всі учасники - сам дарувальник - двосторонній ігнор
      const possibleReceivers = participantIds.filter(receiverId => {
        if (receiverId === giverId) return false; // Не може дарувати сам собі
        
        const receiver = userMap.get(receiverId);
        const receiverIgnoreList = receiver?.ignoreList || [];
        
        // Двосторонній ігнор: якщо A ігнорує B або B ігнорує A
        const isIgnored = giverIgnoreList.includes(receiverId) || receiverIgnoreList.includes(giverId);
        
        return !isIgnored;
      });
      
      possibleAssignments.set(giverId, possibleReceivers);
      
      this.logger.log(`Користувач ${giverId} може дарувати: ${possibleReceivers.join(', ')}`);
    }

    // Перевіряємо чи можливий розподіл взагалі
    for (const [giverId, receivers] of possibleAssignments) {
      if (receivers.length === 0) {
        const giver = userMap.get(giverId);
        const giverName = giver?.displayName || giver?.firstName || `ID:${giverId}`;
        this.logger.error(`Користувач ${giverName} не може нікому дарувати через ігнор-листи`);
        return { 
          success: false, 
          error: `Користувач ${giverName} не може нікому дарувати через ігнор-листи. Змініть налаштування ігнор-листів.` 
        };
      }
    }

    // Пробуємо знайти валідний розподіл (максимум 100 спроб)
    for (let attempt = 0; attempt < 100; attempt++) {
      const assignment = this.tryCreateAssignment(participantIds, possibleAssignments);
      if (assignment) {
        this.logger.log(`Розподіл створено за ${attempt + 1} спроб`);
        return { success: true, assignment, attempts: attempt + 1 };
      }
    }

    this.logger.error('Не вдалося створити валідний розподіл за 100 спроб');
    return { 
      success: false, 
      error: 'Не вдалося створити валідний розподіл. Спробуйте змінити ігнор-листи або додати більше учасників.',
      attempts: 100
    };
  }

  /**
   * Одна спроба створення розподілу
   * Починаємо з учасників з найменшою кількістю можливих отримувачів
   */
  private tryCreateAssignment(
    participantIds: number[],
    possibleAssignments: Map<number, number[]>
  ): { [telegramId: string]: number } | null {
    const assignment: { [telegramId: string]: number } = {};
    const usedReceivers = new Set<number>();
    
    // Сортуємо дарувальників за кількістю можливих отримувачів (від найменшого до найбільшого)
    // Потім перемішуємо тих, хто має однакову кількість можливостей
    const giversByDifficulty = [...participantIds].sort((a, b) => {
      const aOptions = possibleAssignments.get(a)?.length || 0;
      const bOptions = possibleAssignments.get(b)?.length || 0;
      
      if (aOptions === bOptions) {
        return Math.random() - 0.5; // Випадковий порядок для однакових
      }
      return aOptions - bOptions; // Спочатку найскладніші
    });

    this.logger.log(`Порядок призначення: ${giversByDifficulty.map(id => {
      const options = possibleAssignments.get(id)?.length || 0;
      return `${id}(${options})`;
    }).join(', ')}`);

    for (const giverId of giversByDifficulty) {
      const possibleReceivers = possibleAssignments.get(giverId) || [];
      const availableReceivers = possibleReceivers.filter(id => !usedReceivers.has(id));

      if (availableReceivers.length === 0) {
        this.logger.log(`Не вдалося знайти отримувача для ${giverId}. Доступні: ${Array.from(usedReceivers).join(', ')}`);
        return null; // Не вдалося знайти отримувача
      }

      // Вибираємо випадкового отримувача з доступних
      const receiverId = availableReceivers[Math.floor(Math.random() * availableReceivers.length)];
      assignment[giverId.toString()] = receiverId;
      usedReceivers.add(receiverId);
      
      this.logger.log(`${giverId} → ${receiverId} (залишилось варіантів: ${availableReceivers.length - 1})`);
    }

    // Перевіряємо чи всі отримали подарунки
    if (usedReceivers.size === participantIds.length) {
      return assignment;
    }

    return null;
  }

  /**
   * Перевіряє чи валідний розподіл
   */
  validateAssignment(assignment: { [telegramId: string]: number }, participantIds: number[]): boolean {
    const givers = Object.keys(assignment).map(id => parseInt(id));
    const receivers = Object.values(assignment);

    // Перевіряємо чи всі учасники є дарувальниками
    if (givers.length !== participantIds.length) return false;

    // Перевіряємо чи всі учасники отримують подарунки
    const receiverSet = new Set(receivers);
    if (receiverSet.size !== participantIds.length) return false;

    // Перевіряємо чи ніхто не дарує сам собі
    for (const [giverId, receiverId] of Object.entries(assignment)) {
      if (parseInt(giverId) === receiverId) return false;
    }

    return true;
  }
}
