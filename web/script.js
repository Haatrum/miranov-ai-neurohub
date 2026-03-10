let currentChatFile = null;
let attachedImageBase64 = null;// Сюда будет попадать фото и из Ctrl+V, и из файла
let lastAttachedImage = null; // Для картинок из скрепки
let attachedFileContent = "";

// --- 1. НАСТРОЙКА MARKDOWN ---
if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
}

function parseMarkdown(text) {
    return typeof marked !== 'undefined' ? marked.parse(text) : text;
}

// Функция блокировки/разблокировки ввода
function toggleInputState(isEnabled) {
    const input = document.getElementById('user-input');
    const btn = document.getElementById('send-button');
    const mic = document.getElementById('mic-btn');
    const clip = document.querySelector('.icon-btn[title="Прикрепить файл"]');

    if (isEnabled) {
        input.disabled = false;
        input.placeholder = "Введите сообщение...";
        btn.disabled = false;
        // Возвращаем прозрачность и кликабельность
        document.querySelector('.input-row').style.opacity = "1";
        document.querySelector('.input-row').style.pointerEvents = "auto";
    } else {
        input.disabled = true;
        input.placeholder = "Выберите или создайте чат слева 👈";
        btn.disabled = true;
        // Делаем зону ввода "тусклой" и некликабельной
        document.querySelector('.input-row').style.opacity = "0.3";
        document.querySelector('.input-row').style.pointerEvents = "none";
    }
}

// --- 2. КНОПКИ КОПИРОВАНИЯ (С проверкой на дубликаты) ---
function addCopyButtons(container) {
    const codeBlocks = container.querySelectorAll('pre');
    codeBlocks.forEach((pre) => {
        if (pre.querySelector('.copy-btn')) return; // Если кнопка есть — пропускаем
        const button = document.createElement('button');
        button.className = 'copy-btn';
        button.innerText = 'КОПИРОВАТЬ';
        button.onclick = () => {
            const code = pre.querySelector('code').innerText;
            navigator.clipboard.writeText(code).then(() => {
                button.innerText = '✅ ГОТОВО';
                button.classList.add('copied');
                setTimeout(() => {
                    button.innerText = 'КОПИРОВАТЬ';
                    button.classList.remove('copied');
                }, 2000);
            });
        };
        pre.appendChild(button);
    });
}

// --- 3. ГЛАВНЫЙ ЭФФЕКТ ПЕЧАТИ (ФИНАЛИЗИРОВАННЫЙ) ---
async function typeWriter(text, element) {
    const words = text.split(' ');
    let currentText = '';
    const win = document.getElementById('chat-window');

    for (let i = 0; i < words.length; i++) {
        currentText += words[i] + ' ';
        element.innerHTML = parseMarkdown(currentText);
        
        // Быстрая подсветка в процессе (опционально)
        if (typeof hljs !== 'undefined') {
            element.querySelectorAll('pre code').forEach((b) => hljs.highlightElement(b));
        }
        
        win.scrollTop = win.scrollHeight;
        await new Promise(r => setTimeout(r, 25));
    }

    // --- ФИНАЛЬНЫЙ ПАСС (Здесь фиксируем результат) ---
    element.innerHTML = parseMarkdown(text); // Рендерим чистый финал
    if (typeof hljs !== 'undefined') {
        element.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block); // Намертво красим
        });
    }
    addCopyButtons(element); // Намертво прибиваем кнопки
    win.scrollTop = win.scrollHeight;
}

// --- 4. ОТПРАВКА И ПОЛУЧЕНИЕ ---
async function send() {
    const input = document.getElementById('user-input');
    const btn = document.getElementById('send-button');
    const text = input.value.trim();
    
    if ((!text && !attachedImageBase64 && !attachedFileContent) || !currentChatFile || btn.disabled) return;

    const fullContent = text + attachedFileContent;
    addMessage(text || "Анализ изображения...", 'user', attachedImageBase64);
    
    input.value = '';
    attachedFileContent = "";
    
    btn.disabled = true;
    btn.innerText = "Печатает ИИ";
    btn.style.fontSize = "11px";

    document.getElementById('status-llama').classList.add('thinking');
    if (attachedImageBase64) document.getElementById('status-llava').classList.add('thinking');

    try {
        const response = await eel.get_ai_response(fullContent, currentChatFile, attachedImageBase64)();
        document.getElementById('status-llama').classList.remove('thinking');
        document.getElementById('status-llava').classList.remove('thinking');
        clearImage();
        await addMessage(response, 'assistant');
    } catch (e) {
        document.getElementById('status-llama').classList.remove('thinking');
        document.getElementById('status-llava').classList.remove('thinking');
        addMessage("⚠️ Ошибка связи.", 'assistant');
    }
    
    btn.disabled = false;
    btn.innerText = ">>";
    btn.style.fontSize = "13px";
}

// --- 5. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
async function addMessage(text, role, imgSrc = null) {
    const win = document.getElementById('chat-window');
    const isAi = (role === 'ai' || role === 'assistant');
    const div = document.createElement('div');
    div.className = `message ${isAi ? 'ai' : 'user'}`;
    
    // Если есть картинка (от пользователя), добавляем её первой
    if (imgSrc) {
        const img = document.createElement('img');
        img.src = imgSrc;
        div.appendChild(img);
    }

    // Добавляем текст
    const textNode = document.createElement('div');
    div.appendChild(textNode);
    win.appendChild(div);

    if (isAi) {
        await typeWriter(text, textNode);
    } else {
        textNode.innerText = text;
        win.scrollTop = win.scrollHeight;
    }
}

async function handleFileSelect(input) {
    const file = input.files[0]; // Берем первый файл
    if (!file) return;

    // 1. Если это ИЗОБРАЖЕНИЕ (jpg, png, webp)
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            attachedImageBase64 = e.target.result; // Записываем в ту же переменную, что и Ctrl+V
            addMessage(`[Изображение прикреплено: ${file.name}]`, 'user');
            console.log("📸 Картинка из файла готова для Llava");
        };
        reader.readAsDataURL(file);
    } 
    // 2. Если это ТЕКСТ (код, логи и т.д.)
    else {
        addMessage(`[Файл прикреплен: ${file.name}]`, 'user');
        attachedFileContent = await eel.upload_file(file.name)(); // Твоя логика для Llama
    }
    input.value = ''; // Сброс инпута
}


async function toggleMic() {
    const btn = document.getElementById('mic-btn');
    const input = document.getElementById('user-input');
    btn.classList.add('mic-active');
    try {
        const recognizedText = await eel.start_stt()();
        if (recognizedText && !recognizedText.startsWith("Ошибка:")) {
            input.value = recognizedText;
        }
    } catch (e) {console.error("Ошибка при вызове Python STT:", e);
        btn.classList.remove('mic-active');}
    btn.classList.remove('mic-active');
}

// --- 6. РАБОТА С ИСТОРИЕЙ ---
async function loadChatList() {
    const chats = await eel.get_chats()();
    const listDiv = document.getElementById('chat-list');
    listDiv.innerHTML = '';
    chats.forEach(file => {
        const item = document.createElement('div');
        item.className = 'chat-item' + (file === currentChatFile ? ' active' : '');
        item.onclick = () => selectChat(file);
        item.innerHTML = `<span class="chat-name-text">💬 ${file.replace('.json', '')}</span>
                          <div class="chat-controls">
                              <button class="control-btn" onclick="event.stopPropagation(); renameChat('${file}')">✏️</button>
                              <button class="control-btn" onclick="event.stopPropagation(); deleteChat('${file}')">🗑️</button>
                          </div>`;
        listDiv.appendChild(item);
    });
}

async function selectChat(file) {
    currentChatFile = file;
	toggleInputState(true);// РАЗБЛОКИРОВАТЬ
    document.getElementById('chat-window').innerHTML = '';
    const history = await eel.load_history(file)();
    history.forEach(m => {
        const win = document.getElementById('chat-window');
        const div = document.createElement('div');
        const isAi = (m.role === 'ai' || m.role === 'assistant');
        div.className = `message ${isAi ? 'ai' : 'user'}`;
        div.innerHTML = isAi ? parseMarkdown(m.content) : m.content;
        if (isAi && typeof hljs !== 'undefined') {
            div.querySelectorAll('pre code').forEach((b) => hljs.highlightElement(b));
            addCopyButtons(div);
        }
        win.appendChild(div);
    });
    document.getElementById('chat-window').scrollTop = document.getElementById('chat-window').scrollHeight;
    loadChatList();
}

// Очистка скриншота
window.addEventListener('paste', (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            const blob = items[i].getAsFile();
            const reader = new FileReader();
            reader.onload = (event) => {
                attachedImageBase64 = event.target.result;
                document.getElementById('img-preview-box').style.display = 'flex';
                document.getElementById('prev-img').src = attachedImageBase64;
            };
            reader.readAsDataURL(blob);
        }
    }
});

function clearImage() {
    attachedImageBase64 = null;
    document.getElementById('img-preview-box').style.display = 'none';
}

async function deleteChat(f) {
    if (confirm(`Удалить чат?`)) {
        await eel.delete_chat(f)();
        if (currentChatFile === f) currentChatFile = null;
        loadChatList();
    }
}

async function renameChat(f) {
    const n = prompt("Новое имя:", f.replace('.json', ''));
    if (n) { await eel.rename_chat(f, n)(); loadChatList(); }
}

async function newChat() {
    let n = prompt("Название чата:", "Новый проект");
    if (n) {
        currentChatFile = await eel.create_chat(n.trim())();
		toggleInputState(true); // РАЗБЛОКИРОВАТЬ
        document.getElementById('chat-window').innerHTML = '';
        loadChatList();
    }
}

eel.expose(updateStatus);
function updateStatus(m, s) {
    const id = m.toLowerCase().includes('llava') ? 'status-llava' : 'status-llama';
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', s);
}

document.getElementById('user-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') send(); });
loadChatList();

// Функция для перехвата ссылок и открытия их в системном браузере
document.addEventListener('click', function(e) {
    const target = e.target.closest('a');
    if (target && target.href && target.href.startsWith('http')) {
        e.preventDefault(); // Запрещаем открывать внутри программы
        eel.open_browser(target.href); // Отправляем ссылку в Python
    }
});

// Перехват кликов по ссылкам, чтобы окно чата не закрывалось
document.addEventListener('click', function(e) {
    // Ищем, был ли клик по ссылке (тег <a>)
    const target = e.target.closest('a');
    
    if (target && target.href && target.href.startsWith('http')) {
        e.preventDefault(); // Останавливаем переход внутри Eel
        console.log("🔗 Перенаправляю ссылку в системный браузер:", target.href);
        eel.open_browser(target.href); // Вызываем твою функцию в Python
    }
});

toggleInputState(false); // Изначально ВСЁ ЗАБЛОКИРОВАНО