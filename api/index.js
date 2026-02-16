require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
let userStates = {}; 

// --- 1. CORS КОНФИГУРАЦИЯ ---
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

const { BOT_TOKEN, CHAT_ID, MONGO_URI, ADMIN_QUERY_KEY } = process.env;

// --- 2. ПОДКЛЮЧЕНИЕ К MongoDB ---
if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
      .then(() => console.log('✅ Connected to MongoDB'))
      .catch(err => console.error('❌ DB Error:', err));
}

// --- 3. МОДЕЛИ ДАННЫХ ---
const User = mongoose.model('User', new mongoose.Schema({
  login: String, 
  password: { type: String },
  name: String, 
  className: String, 
  role: { type: String, default: "teacher" }
}), 'users');

const Absent = mongoose.model('Absent', new mongoose.Schema({
  teacher: String, 
  className: String, 
  date: String,
  count: String, 
  studentName: String, 
  reason: String, 
  allstudents: String
}), 'absents_itma');

const News = mongoose.model('News', new mongoose.Schema({
  text: String,
  createdAt: { type: Date, default: Date.now },
  expireAt: { type: Date }
}).index({ expireAt: 1 }, { expireAfterSeconds: 0 }), 'news_itma');

// --- 4. ПОМОЩНИК ОТПРАВКИ TG ---
const sendTG = async (chatId, text, inlineKeyboard = null) => {
  try {
    const replyMenu = {
      keyboard: [[{ text: "👨‍🏫 Учителя" }], [{ text: "📢 Создать новость" }, { text: "📝 Список новостей" }]],
      resize_keyboard: true
    };
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId, text, parse_mode: "Markdown",
      reply_markup: inlineKeyboard ? { inline_keyboard: inlineKeyboard } : replyMenu
    }, { headers: { 'Content-Type': 'application/json' } });
  } catch (e) { console.error("TG Send Error"); }
};

// --- 5. ОБРАБОТЧИК ТЕЛЕГРАМ БОТА ---
app.post('/api/bot', async (req, res) => {
  try {
    const { message, callback_query } = req.body;
    const fromId = message?.from?.id || callback_query?.from?.id;
    const chatId = message?.chat?.id || callback_query?.message?.chat?.id;
    if (!fromId) return res.sendStatus(200);

    const allowed = CHAT_ID?.split(',') || [];
    if (!allowed.includes(fromId.toString())) return res.sendStatus(200);

    if (callback_query) {
      const [action, targetId] = callback_query.data.split(':');
      
      if (action === 'back_to_list' || action === 'list_teachers') {
        const teachers = await User.find();
        const kb = teachers.map(t => ([{ text: `👤 ${t.name}`, callback_data: `manage:${t._id}` }]));
        kb.push([{ text: "➕ Добавить учителя", callback_data: "start_add" }]);
        return await sendTG(chatId, "👨‍🏫 **Выберите учителя:**", kb);
      }

      if (action === 'manage') {
        const user = await User.findById(targetId);
        await sendTG(chatId, `👤 **${user.name}**\n📍 Класс: ${user.className}\n🔑 Логин: \`${user.login}\`\n🔐 Пароль: \`${user.password}\``, [
          [{ text: "✏️ Имя", callback_data: `edit_name:${targetId}` }, { text: "🏫 Класс", callback_data: `edit_class:${targetId}` }],
          [{ text: "🔑 Логин", callback_data: `edit_login:${targetId}` }, { text: "🔐 Пароль", callback_data: `edit_pass:${targetId}` }],
          [{ text: "🗑 Удалить", callback_data: `confirm_del:${targetId}` }],
          [{ text: "⬅️ Назад", callback_data: "back_to_list" }]
        ]);
      }

      if (['edit_name', 'edit_class', 'edit_login', 'edit_pass'].includes(action)) {
        userStates[chatId] = { action, userId: targetId };
        await sendTG(chatId, `⌨️ Введите новое значение:`);
      }

      if (action === 'confirm_del') { await User.findByIdAndDelete(targetId); await sendTG(chatId, "✅ Удалено!"); }
      if (action === 'start_add') { userStates[chatId] = { action: 'adding_user' }; await sendTG(chatId, "📝 Введите через пробел: `логин пароль имя класс` "); }
      if (action === 'news_step1') { userStates[chatId] = { action: 'news_text' }; await sendTG(chatId, "✍️ Введите текст новости:"); }
      
      if (action === 'news_list') {
        const allNews = await News.find();
        const kb = allNews.map(n => ([{ text: `🗑 ${n.text.substring(0,20)}...`, callback_data: `del_news:${n._id}` }]));
        await sendTG(chatId, "📝 Список новостей (нажми для удаления):", kb);
      }
      if (action === 'del_news') { await News.findByIdAndDelete(targetId); await sendTG(chatId, "✅ Удалена!"); }
      
      return res.sendStatus(200);
    }

    const text = message?.text;
    if (text === "/start") return await sendTG(chatId, "🚀 Панель управления ITMA готова.");

    if (text === "👨‍🏫 Учителя") {
      const teachers = await User.find();
      const kb = teachers.map(t => ([{ text: `👤 ${t.name}`, callback_data: `manage:${t._id}` }]));
      kb.push([{ text: "➕ Добавить учителя", callback_data: "start_add" }]);
      return await sendTG(chatId, "👨‍🏫 **Управление:**", kb);
    }
    
    if (text === "📢 Создать новость") { userStates[chatId] = { action: 'news_text' }; return await sendTG(chatId, "✍️ Введите текст:"); }
    if (text === "📝 Список новостей") {
        const allNews = await News.find();
        const kb = allNews.map(n => ([{ text: `🗑 ${n.text.substring(0,20)}...`, callback_data: `del_news:${n._id}` }]));
        return await sendTG(chatId, "📝 **Активные новости:**", kb);
    }

    if (userStates[chatId]) {
      const state = userStates[chatId];
      if (state.action === 'edit_name') await User.findByIdAndUpdate(state.userId, { name: text });
      else if (state.action === 'edit_class') await User.findByIdAndUpdate(state.userId, { className: text });
      else if (state.action === 'edit_login') await User.findByIdAndUpdate(state.userId, { login: text });
      else if (state.action === 'edit_pass') await User.findByIdAndUpdate(state.userId, { password: text });
      else if (state.action === 'adding_user') {
        const [l, p, n, c] = text.split(' ');
        if (c) await new User({ login: l, password: p, name: n, className: c }).save();
      } else if (state.action === 'news_text') {
        userStates[chatId] = { action: 'news_days', text: text };
        return await sendTG(chatId, "⏳ Срок (в днях):");
      } else if (state.action === 'news_days') {
        const expire = new Date(); expire.setDate(expire.getDate() + (parseInt(text) || 1));
        await new News({ text: state.text, expireAt: expire }).save();
      }
      delete userStates[chatId];
      return await sendTG(chatId, "✅ Готово!");
    }
    res.sendStatus(200);
  } catch (err) { res.sendStatus(200); }
});

// --- 6. API ЭНДПОИНТЫ ДЛЯ САЙТА ---

app.get('/', (req, res) => res.send('ITMA Server is Running ✅'));

app.post('/api/login', async (req, res) => {
  const { login, password } = req.body;
  const user = await User.findOne({ login, password });
  res.json(user ? { status: "ok", user } : { status: "error" });
});

app.post('/api/absent', async (req, res) => {
  try {
    await new Absent(req.body).save();
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, 
      { chat_id: CHAT_ID, text: `📊 Hisobot: ${req.body.teacher}` }, 
      { headers: { 'Content-Type': 'application/json' } }
    ).catch(() => {});
    res.json({ status: "ok" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/absents', async (req, res) => {
  res.json(await Absent.find().sort({ date: -1 }));
});

app.put('/api/absent/:id', async (req, res) => {
  try {
    await Absent.findByIdAndUpdate(req.params.id, { $set: req.body });
    res.json({ status: "ok" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/absent/:id', async (req, res) => {
  try {
    await Absent.findByIdAndDelete(req.params.id);
    res.json({ status: "ok" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ЗАЩИЩЕННЫЙ СПИСОК ЮЗЕРОВ (с твоим секретным ключом)
app.get('/api/users', async (req, res) => {
  const { key } = req.query;
  if (!key || key !== ADMIN_QUERY_KEY) {
    return res.status(403).json({ error: "Access Denied" });
  }
  const users = await User.find();
  res.json(users);
});

app.get('/api/latest-news', async (req, res) => {
  const news = await News.find().sort({ createdAt: -1 });
  res.json({ text: news.length > 0 ? news[0].text : "Новостей пока нет" });
});

// Запуск для локальной разработки
if (process.env.NODE_ENV !== 'production') {
  const PORT = 3000;
  app.listen(PORT, () => console.log(`🚀 Local: http://localhost:${PORT}`));
}

module.exports = app;
