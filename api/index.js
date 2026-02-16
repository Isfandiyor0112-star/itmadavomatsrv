
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
let userStates = {}; 

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

const { BOT_TOKEN, CHAT_ID, MONGO_URI } = process.env;

// --- БД ---
if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
      .then(() => console.log('✅ Connected to MongoDB'))
      .catch(err => console.error('❌ DB Error:', err));
}

// --- МОДЕЛИ ---
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

const NewsSchema = new mongoose.Schema({
  text: String,
  createdAt: { type: Date, default: Date.now },
  expireAt: { type: Date }
});
NewsSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
const News = mongoose.model('News', NewsSchema, 'news_itma');

// --- ПОМОЩНИК TG ---
const sendTG = async (chatId, text, keyboard = null) => {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown",
      reply_markup: keyboard ? { inline_keyboard: keyboard } : { remove_keyboard: true }
    }, {
      headers: { 'Content-Type': 'application/json' } // Тот самый Content-Type
    });
  } catch (e) { console.error("TG Send Error"); }
};

const MAIN_MENU = [
  [{ text: "👨‍🏫 Учителя", callback_data: "list_teachers" }],
  [{ text: "📢 Создать новость", callback_data: "news_step1" }],
  [{ text: "📝 Список объявлений", callback_data: "news_list" }]
];

// --- BOT ENDPOINT ---
app.post('/api/bot', async (req, res) => {
  try {
    const { message, callback_query } = req.body;
    const fromId = message ? message.from.id : callback_query.from.id;
    const chatId = message ? message.chat.id : callback_query.message.chat.id;

    const allowedUsers = CHAT_ID ? CHAT_ID.split(',') : [];
    if (!allowedUsers.includes(fromId.toString())) return res.sendStatus(200);

    if (callback_query) {
      const [action, targetId] = callback_query.data.split(':');

      if (action === 'main_menu') await sendTG(chatId, "🎮 Меню:", MAIN_MENU);

      if (action === 'list_teachers' || action === 'back_to_list') {
        const teachers = await User.find();
        const kb = teachers.map(t => ([{ text: `${t.name} (${t.className})`, callback_data: `manage:${t._id}` }]));
        kb.push([{ text: "➕ Добавить", callback_data: "start_add" }], [{ text: "⬅️ Меню", callback_data: "main_menu" }]);
        await sendTG(chatId, "👨‍🏫 Список:", kb);
      }

      if (action === 'manage') {
        const user = await User.findById(targetId);
        await sendTG(chatId, `👤 **${user.name}**\nКласс: ${user.className}`, [
          [{ text: "✏️ Имя", callback_data: `edit_name:${targetId}` }, { text: "🏫 Класс", callback_data: `edit_class:${targetId}` }],
          [{ text: "🗑 Удалить", callback_data: `confirm_del:${targetId}` }],
          [{ text: "⬅️ Назад", callback_data: "back_to_list" }]
        ]);
      }

      if (action === 'news_step1') {
        userStates[chatId] = { action: 'news_text' };
        await sendTG(chatId, "✍️ Введите текст новости:");
      }

      if (action === 'news_list') {
        const allNews = await News.find();
        const kb = allNews.map(n => ([{ text: `🗑 ${n.text.substring(0,20)}...`, callback_data: `del_news:${n._id}` }]));
        kb.push([{ text: "⬅️ Меню", callback_data: "main_menu" }]);
        await sendTG(chatId, "📝 Активные новости:", kb);
      }

      if (action === 'del_news') {
        await News.findByIdAndDelete(targetId);
        await sendTG(chatId, "✅ Удалено!", [[{text: "⬅️", callback_data: "news_list"}]]);
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

    const text = message?.text;
    if (text === "/start") return await sendTG(chatId, "🎮 Управление:", MAIN_MENU);

    if (userStates[chatId]) {
      const state = userStates[chatId];
      if (state.action === 'news_text') {
        userStates[chatId] = { action: 'news_days', text: text };
        await sendTG(chatId, "⏳ На сколько дней?");
      } 
      else if (state.action === 'news_days') {
        const days = parseInt(text) || 1;
        const expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + days);
        await new News({ text: state.text, expireAt: expireDate }).save();
        delete userStates[chatId];
        await sendTG(chatId, "🚀 Опубликовано!", MAIN_MENU);
      }
      else if (state.action === 'adding_user') {
        const [l, p, n, c] = text.split(' ');
        if (c) await new User({ login: l, password: p, name: n, className: c }).save();
        delete userStates[chatId];
        await sendTG(chatId, "✅ Готово!", MAIN_MENU);
      }
      return res.sendStatus(200);
    }
    res.sendStatus(200);
  } catch (err) { res.sendStatus(200); }
});

// --- API ---
app.get('/api/latest-news', async (req, res) => {
  const news = await News.find().sort({ createdAt: -1 });
  res.json({ text: news.length > 0 ? news[0].text : "Новостей пока нет" });
});

app.post('/api/login', async (req, res) => {
  const { login, password } = req.body;
  const user = await User.findOne({ login, password });
  res.json(user ? { status: "ok", user } : { status: "error" });
});

app.post('/api/absent', async (req, res) => {
  try {
    const record = new Absent(req.body);
    await record.save();
    const msg = `📊 **Hisobot**: ${req.body.teacher}\n❌ Yo'q: ${req.body.count}\n📝 ${req.body.studentName}\n💬 Sabab: ${req.body.reason}`;
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: CHAT_ID, text: msg }, { headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    res.json({ status: "ok" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/absents', async (req, res) => {
  const data = await Absent.find().sort({ date: -1 });
  res.json(data);
});

app.put('/api/absent/:id', async (req, res) => {
  const updated = await Absent.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
  res.json({ status: "ok", data: updated });
});

app.delete('/api/absent/:id', async (req, res) => {
  await Absent.findByIdAndDelete(req.params.id);
  res.json({ status: "ok" });
});

module.exports = app;
