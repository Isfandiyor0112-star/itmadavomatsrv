require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
let userStates = {}; 

// 1. Настройка CORS
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

const { BOT_TOKEN, CHAT_ID, MONGO_URI, ADMIN_QUERY_KEY } = process.env;

// 2. Подключение к БД
if (MONGO_URI) {
    mongoose.connect(MONGO_URI).then(() => console.log('✅ Connected to MongoDB'));
}

// --- МОДЕЛИ ---
const User = mongoose.model('User', new mongoose.Schema({
  login: String, password: { type: String }, name: String, className: String, role: { type: String, default: "teacher" }
}), 'users');

const Absent = mongoose.model('Absent', new mongoose.Schema({
  teacher: String, className: String, date: String, count: String, studentName: String, reason: String, allstudents: String
}), 'absents_itma');

const News = mongoose.model('News', new mongoose.Schema({
  text: String, createdAt: { type: Date, default: Date.now }, expireAt: { type: Date }
}).index({ expireAt: 1 }, { expireAfterSeconds: 0 }), 'news_itma');

// --- ПОМОЩНИК ОТПРАВКИ (С ХЕДЕРАМИ И МЕНЮ) ---
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
  } catch (e) { console.error("🔴 TG Error"); }
};

// --- ТЕЛЕГРАМ БОТ ---
app.post('/api/bot', async (req, res) => {
  try {
    const { message, callback_query } = req.body;
    
    // Безопасное получение ID
    const fromId = message?.from?.id || callback_query?.from?.id;
    const chatId = message?.chat?.id || callback_query?.message?.chat?.id;

    if (!fromId) return res.sendStatus(200);

    // Проверка доступа
    const allowedUsers = CHAT_ID ? CHAT_ID.split(',') : [];
    if (!allowedUsers.includes(fromId.toString())) return res.sendStatus(200);

    // --- ОБРАБОТКА КНОПОК (CALLBACK) ---
    if (callback_query) {
      const [action, targetId] = callback_query.data.split(':');

      if (action === 'manage' || action === 'back_to_list') {
        if (action === 'back_to_list') {
            const teachers = await User.find();
            const kb = teachers.map(t => ([{ text: `👤 ${t.name}`, callback_data: `manage:${t._id}` }]));
            kb.push([{ text: "➕ Добавить учителя", callback_data: "start_add" }]);
            return await sendTG(chatId, "👨‍🏫 **Выберите учителя:**", kb);
        }
        const user = await User.findById(targetId);
        if (!user) return res.sendStatus(200);
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

      if (action === 'confirm_del') {
        await User.findByIdAndDelete(targetId);
        await sendTG(chatId, "✅ Удалено.");
      }

      if (action === 'start_add') {
        userStates[chatId] = { action: 'adding_user' };
        await sendTG(chatId, "📝 Введите: `логин пароль имя класс` (через пробел)");
      }
      
      return res.sendStatus(200);
    }

    // --- ОБРАБОТКА ТЕКСТА ---
    const text = message?.text;
    if (!text) return res.sendStatus(200);

    // 1. Состояния ввода
    if (userStates[chatId]) {
      const state = userStates[chatId];
      if (state.action === 'edit_name') await User.findByIdAndUpdate(state.userId, { name: text });
      if (state.action === 'edit_class') await User.findByIdAndUpdate(state.userId, { className: text });
      if (state.action === 'edit_login') await User.findByIdAndUpdate(state.userId, { login: text });
      if (state.action === 'edit_pass') await User.findByIdAndUpdate(state.userId, { password: text });
      if (state.action === 'adding_user') {
        const [l, p, n, c] = text.split(' ');
        if (c) await new User({ login: l, password: p, name: n, className: c }).save();
      }
      delete userStates[chatId];
      return await sendTG(chatId, "✅ Данные обновлены!");
    }

    // 2. Кнопки меню
    if (text === "👨‍🏫 Учителя" || text === "/start") {
      const teachers = await User.find();
      const kb = teachers.map(t => ([{ text: `👤 ${t.name} (${t.className})`, callback_data: `manage:${t._id}` }]));
      kb.push([{ text: "➕ Добавить учителя", callback_data: "start_add" }]);
      return await sendTG(chatId, text === "/start" ? "🚀 Панель ITMA готова" : "👨‍🏫 Управление базой:", kb);
    }

    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(200);
  }
});

// --- API ЭНДПОИНТЫ ---
app.post('/api/login', async (req, res) => {
  const { login, password } = req.body;
  const user = await User.findOne({ login, password });
  res.json(user ? { status: "ok", user } : { status: "error" });
});

app.post('/api/absent', async (req, res) => {
  try {
    await new Absent(req.body).save();
    const msg = `📊 **Hisobot**: ${req.body.teacher}\n❌ Yo'q: ${req.body.count}\n📝 ${req.body.studentName}`;
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: CHAT_ID, text: msg }, { headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    res.json({ status: "ok" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/absent/:id', async (req, res) => {
  await Absent.findByIdAndUpdate(req.params.id, { $set: req.body });
  res.json({ status: "ok" });
});

app.delete('/api/absent/:id', async (req, res) => {
  await Absent.findByIdAndDelete(req.params.id);
  res.json({ status: "ok" });
});

app.get('/api/users', async (req, res) => {
  if (!req.query.key || req.query.key !== ADMIN_QUERY_KEY) return res.status(403).json({ error: "Denied" });
  res.json(await User.find());
});

module.exports = app;
