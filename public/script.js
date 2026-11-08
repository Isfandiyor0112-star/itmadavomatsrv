const translations = {
  ru: {
    login_title: "Вход",
    login_label: "Логин",
    password_label: "Пароль",
    login_btn: "Войти",
    login_error: "Неверный логин или пароль",
    help_text: "Забыли пароль или нужна помощь?"
  },
  uz: {
    login_title: "Kirish",
    login_label: "Login",
    password_label: "Parol",
    login_btn: "Kirish",
    login_error: "Login yoki parol noto'g'ri",
    help_text: "Parolni unutdingizmi yoki yordam kerakmi?"
  }
};

// Функция смены языка
window.changeLang = function(lang) {
  const group = document.getElementById('langGroup');
  if (group) group.setAttribute('data-active', lang);

  document.querySelectorAll('.btn-lang').forEach(btn => {
    btn.classList.remove('active');
    if (btn.id === `lang-${lang}`) btn.classList.add('active');
  });

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang][key]) el.textContent = translations[lang][key];
  });

  localStorage.setItem('lang', lang);
};

document.addEventListener('DOMContentLoaded', function() {
  // Установка языка при загрузке
  const currentLang = localStorage.getItem('lang') || 'ru';
  changeLang(currentLang);

  // --- УМНОЕ СКРЫТИЕ ИНТРО ---
  const intro = document.getElementById('videoIntro');
  const container = document.getElementById('loginContainer');
  
  if (intro) {
    // Ждем, пока видео реально начнет играть
    intro.addEventListener('playing', () => {
      setTimeout(() => {
        intro.style.opacity = '0';
        setTimeout(() => {
          intro.style.display = 'none';
          if (container) container.style.display = 'block';
        }, 500);
      }, 4000); // 4 секунды отсчитываются только после старта видео
    }, { once: true });
  } else {
    // Предохранитель: если видео нет, сразу показываем логин
    if (container) container.style.display = 'block';
  }
  // ---------------------------

  // Логика входа
  const form = document.getElementById('loginForm');
  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const login = document.getElementById('login').value;
      const password = document.getElementById('password').value;

      try {
        const res = await fetch('https://itmadavomat.vercel.app/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login, password })
        });
        const data = await res.json();

        if (data.status === "ok") {
          localStorage.setItem('teacher', JSON.stringify(data.user));
          const adminLogins = ["bunyod" , "admin"];
          window.location.href = adminLogins.includes(data.user.login) ? "admin.html" : "teacher.html";
        } else {
          document.getElementById('loginError').style.display = 'block';
        }
      } catch (err) {
        console.error("Ошибка сети");
      }
    });
  }
});
