export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  telegram: {
    apiKey: process.env.API_KEY,
  },
  database: {
    mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/englishbot',
  },
  googleSheets: {
    apiKey: process.env.GOOGLE_SHEETS_API_KEY,
  },
});
