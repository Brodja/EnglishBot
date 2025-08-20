# 🔑 Швидке отримання Google Sheets API Key

## ⚠️ ВАЖЛИВО: API Key обов'язковий!

Бот не може працювати без Google Sheets API Key. Ось швидкий спосіб його отримати:

## 🚀 Швидкі кроки (5 хвилин):

### 1. Перейдіть на Google Cloud Console
👉 [console.cloud.google.com](https://console.cloud.google.com/)

### 2. Створіть проект
- Натисніть **"Select a project"** → **"New Project"**
- Назва: `English Bot`
- Натисніть **"Create"**

### 3. Увімкніть Google Sheets API
- Зліва: **"APIs & Services"** → **"Library"**
- Шукайте: `Google Sheets API`
- Натисніть **"ENABLE"**

### 4. Створіть API Key
- Зліва: **"APIs & Services"** → **"Credentials"**
- **"+ CREATE CREDENTIALS"** → **"API key"**
- **Скопіюйте ключ!** (виглядає як `AIzaSyC...`)

### 5. Обмежте ключ (безпека)
- Натисніть **"RESTRICT KEY"**
- **"API restrictions"** → **"Restrict key"**
- Виберіть **"Google Sheets API"**
- **"SAVE"**

### 6. Додайте в .env
```env
GOOGLE_SHEETS_API_KEY=AIzaSyC-ваш_ключ_тут
```

## ✅ Готово!

Перезапустіть бота і спробуйте знову. Тепер він зможе читати ваші Google Sheets!

---

**💡 Підказка:** Весь процес займає 5 хвилин. Google дає 100 запитів на хвилину безкоштовно - цього більш ніж достатньо для особистого використання.
