import { Injectable, Logger } from '@nestjs/common';
import { UserService } from '../../user/user.service';
import { GoogleSheetsService, WordPair } from '../../google-sheets/google-sheets.service';

@Injectable()
export class WordsService {
  private readonly logger = new Logger(WordsService.name);

  constructor(
    private readonly userService: UserService,
    private readonly googleSheetsService: GoogleSheetsService,
  ) {}

  /**
   * Отримує слова для користувача з кешу або з Google Sheets
   */
  async getWordsForUser(telegramId: number): Promise<WordPair[]> {
    const user = await this.userService.findByTelegramId(telegramId);
    
    if (!user) {
      throw new Error('Користувач не знайдений');
    }

    if (!user.googleSheetsUrl) {
      throw new Error('Посилання на Google Sheets не встановлено');
    }

    // Перевіряємо чи є кешовані дані і чи не застарілі вони (1 година)
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    if (
      user.cachedWords &&
      user.cachedWords.lastUpdated &&
      user.cachedWords.lastUpdated > oneHourAgo
    ) {
      this.logger.log(`Використовуємо кешовані дані для користувача ${telegramId}`);
      return user.cachedWords.words;
    }

    // Завантажуємо свіжі дані з Google Sheets
    this.logger.log(`Завантажуємо свіжі дані для користувача ${telegramId}`);
    const words = await this.googleSheetsService.extractWordsFromSheet(user.googleSheetsUrl);
    
    // Зберігаємо в кеш
    await this.userService.updateCachedWords(telegramId, words);
    
    return words;
  }

  /**
   * Отримує випадкове англійське слово для користувача
   */
  async getRandomEnglishWord(telegramId: number): Promise<{ word: string; translation: string }> {
    const words = await this.getWordsForUser(telegramId);
    const user = await this.userService.findByTelegramId(telegramId);
    
    if (words.length === 0) {
      throw new Error('Немає слів для навчання');
    }

    const englishShown = user?.progress?.englishShown || [];
    
    // Якщо показали всі слова, скидаємо прогрес
    if (englishShown.length >= words.length) {
      await this.userService.resetProgress(telegramId);
      return this.getRandomEnglishWord(telegramId);
    }

    // Знаходимо індекси слів, які ще не показували
    const availableIndices = words
      .map((_, index) => index)
      .filter(index => !englishShown.includes(index));

    // Вибираємо випадковий індекс
    const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
    const selectedWord = words[randomIndex];

    // Оновлюємо прогрес
    await this.userService.updateProgress(telegramId, 'english', [...englishShown, randomIndex]);

    return {
      word: selectedWord.english,
      translation: selectedWord.translation,
    };
  }

  /**
   * Отримує випадковий переклад для користувача
   */
  async getRandomTranslation(telegramId: number): Promise<{ word: string; translation: string }> {
    const words = await this.getWordsForUser(telegramId);
    const user = await this.userService.findByTelegramId(telegramId);
    
    if (words.length === 0) {
      throw new Error('Немає слів для навчання');
    }

    const translationShown = user?.progress?.translationShown || [];
    
    // Якщо показали всі переклади, скидаємо прогрес
    if (translationShown.length >= words.length) {
      await this.userService.resetProgress(telegramId);
      return this.getRandomTranslation(telegramId);
    }

    // Знаходимо індекси перекладів, які ще не показували
    const availableIndices = words
      .map((_, index) => index)
      .filter(index => !translationShown.includes(index));

    // Вибираємо випадковий індекс
    const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
    const selectedWord = words[randomIndex];

    // Оновлюємо прогрес
    await this.userService.updateProgress(telegramId, 'translation', [...translationShown, randomIndex]);

    return {
      word: selectedWord.english,
      translation: selectedWord.translation,
    };
  }
}
