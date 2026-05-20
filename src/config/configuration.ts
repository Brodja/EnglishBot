export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  telegram: {
    apiKey: process.env.API_KEY,
  },
  googleSheets: {
    apiKey: process.env.GOOGLE_SHEETS_API_KEY,
  },
});
