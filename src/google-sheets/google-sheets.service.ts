import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';

export interface WordPair {
  english: string;
  translation: string;
}

@Injectable()
export class GoogleSheetsService {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private sheets: sheets_v4.Sheets;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('googleSheets.apiKey');
    
    if (!apiKey) {
      this.logger.error('Google Sheets API Key не знайдено! Додайте GOOGLE_SHEETS_API_KEY в .env файл');
      throw new Error('Google Sheets API Key is required');
    }
    
    // Ініціалізуємо з API Key
    this.sheets = google.sheets({ version: 'v4', auth: apiKey });
    this.logger.log('Google Sheets API ініціалізований з API Key');
  }

  /**
   * Витягує дані з Google Sheets за URL
   * @param sheetUrl - URL Google Sheets таблиці
   * @returns Масив пар слів (англійське слово + переклад)
   */
  async extractWordsFromSheet(sheetUrl: string): Promise<WordPair[]> {
    try {
      const sheetId = this.extractSheetId(sheetUrl);
      if (!sheetId) {
        throw new Error('Невірний URL Google Sheets');
      }

      this.logger.log(`Витягуємо дані з таблиці: ${sheetId}`);

      // Отримуємо дані з колонок B до F (англійські слова, транскрипція, переклади, приклади, маркер вивчених)
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'B:F', // Беремо колонки B, C, D, E, F
      });

      const rows = response.data.values || [];
      const wordPairs: WordPair[] = [];

      // Пропускаємо перший рядок (заголовки) і обробляємо дані
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row && row.length >= 1) {
          const english = row[0]?.trim(); // Колонка B (індекс 0)
          const transcription = row[1]?.trim(); // Колонка C (індекс 1) - транскрипція
          const translation = row[2]?.trim() || '[переклад відсутній]'; // Колонка D (індекс 2)
          const example = row[3]?.trim(); // Колонка E (індекс 3) - приклади
          const learned = row[4]?.trim(); // Колонка F (індекс 4) - маркер вивчених слів

          // Якщо в колонці F є будь-який текст - слово вивчене, ігноруємо його
          if (english && !learned) {
            wordPairs.push({ english, translation });
          } else if (english && learned) {
            this.logger.log(`Пропускаємо вивчене слово: ${english} (маркер: "${learned}")`);
          }
        }
      }

      this.logger.log(`Витягнуто ${wordPairs.length} пар слів`);
      return wordPairs;
    } catch (error) {
      this.logger.error('Помилка при витягуванні даних з Google Sheets:', error);
      throw new Error(`Не вдалося отримати дані з таблиці: ${error.message}`);
    }
  }

  /**
   * Витягує ID таблиці з URL
   * @param url - URL Google Sheets
   * @returns ID таблиці або null
   */
  private extractSheetId(url: string): string | null {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  /**
   * Перевіряє чи URL є валідним Google Sheets посиланням
   * @param url - URL для перевірки
   * @returns true якщо URL валідний
   */
  isValidGoogleSheetsUrl(url: string): boolean {
    // Більш гнучкий паттерн, що підтримує різні формати Google Sheets URL
    const pattern = /https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+/;
    return pattern.test(url);
  }
}
