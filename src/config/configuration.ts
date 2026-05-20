export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  telegram: {
    apiKey: process.env.API_KEY,
  },
  googleSheets: {
    apiKey: process.env.GOOGLE_SHEETS_API_KEY,
  },
  admin: {
    // Comma-separated list of Telegram IDs that get admin features
    // (feedback inbox, list view, etc.)
    telegramIds: (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
});
