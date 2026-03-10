import zope.interface
import gevent
import eel
import gevent.monkey
gevent.monkey.patch_all()

import ollama
import json
import os
import threading
import queue
import sounddevice as sd
import sys
import webbrowser
from datetime import datetime
from config import SYSTEM_PROMPT
from vosk import Model, KaldiRecognizer

# --- КОНФИГУРАЦИЯ ---
BRAIN_MODEL = "llama3"
VISION_MODEL = "llava"
HISTORY_DIR = "history"
VOSK_MODEL_PATH = "model_vosk"

# Флаг для безопасного завершения процессов
should_stop = False

if not os.path.exists(HISTORY_DIR):
    os.makedirs(HISTORY_DIR)

eel.init('web')

# --- НАСТРОЙКА ОФФЛАЙН-ГОЛОСА (VOSK) ---
audio_q = queue.Queue()

def audio_callback(indata, frames, time, status):
    """Захват аудиопотока в очередь"""
    if not should_stop:
        audio_q.put(bytes(indata))

try:
    if os.path.exists(VOSK_MODEL_PATH):
        vosk_model = Model(VOSK_MODEL_PATH)
        print("✅ Модель Vosk загружена.")
    else:
        print("⚠️ Модель Vosk не найдена.")
        vosk_model = None
except Exception as e:
    print(f"❌ Ошибка загрузки Vosk: {e}")
    vosk_model = None

@eel.expose
def start_stt():
    """Запуск процесса оффлайн-распознавания речи"""
    global should_stop
    print(">>> Python: Начал слушать голос...") # Добавь это для теста!
    if not vosk_model:
        return "Ошибка: Модель не загружена"
    
    samplerate = 16000
    try:
        with sd.RawInputStream(samplerate=samplerate, blocksize=8000, 
                               dtype='int16', channels=1, callback=audio_callback):
            rec = KaldiRecognizer(vosk_model, samplerate)
            # Цикл работает, пока открыто окно
            while not should_stop:
                data = audio_q.get()
                if rec.AcceptWaveform(data):
                    res = json.loads(rec.Result())
                    text = res.get("text", "")
                    if text: return text
                
                # Короткая пауза для предотвращения 100% загрузки CPU
                eel.sleep(0.01) 
    except Exception as e:
        return f"Ошибка: {str(e)}"
    return ""

# --- ЛОГИКА УПРАВЛЕНИЯ ЧАТАМИ ---

@eel.expose
def get_chats():
    files = [f for f in os.listdir(HISTORY_DIR) if f.endswith(".json")]
    files.sort(key=lambda x: os.path.getmtime(os.path.join(HISTORY_DIR, x)), reverse=True)
    return files

@eel.expose
def create_chat(user_name):
    clean_name = "".join([c for c in user_name if c.isalnum() or c in " _-"]).strip()
    if not clean_name: clean_name = "Новый чат"
    timestamp = datetime.now().strftime("%Y-%m-%d %H-%M")
    filename = f"{clean_name} ({timestamp}).json"
    path = os.path.join(HISTORY_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump([], f)
    return filename

@eel.expose
def delete_chat(filename):
    path = os.path.join(HISTORY_DIR, filename)
    if os.path.exists(path):
        os.remove(path)
        return True
    return False

@eel.expose
def rename_chat(old_filename, new_name):
    old_path = os.path.join(HISTORY_DIR, old_filename)
    clean_name = "".join([c for c in new_name if c.isalnum() or c in " _-"]).strip()
    if not clean_name: return False
    new_filename = f"{clean_name}.json"
    new_path = os.path.join(HISTORY_DIR, new_filename)
    if os.path.exists(old_path):
        os.rename(old_path, new_path)
        return new_filename
    return False

@eel.expose
def load_history(filename):
    path = os.path.join(HISTORY_DIR, filename)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

# --- ГЛАВНАЯ ЛОГИКА ОТВЕТА ---

@eel.expose
def get_ai_response(text, chat_file, image_base64=None):
    path = os.path.join(HISTORY_DIR, chat_file)
    with open(path, "r", encoding="utf-8") as f:
        history = json.load(f)
    
    vision_context = ""

    if image_base64:
        try:
            img_data = image_base64.split(",")[-1] if "," in image_base64 else image_base64
            vision_res = ollama.chat(model=VISION_MODEL, messages=[{
                'role': 'user',
                'content': 'Детально проанализируй этот скриншот.',
                'images': [img_data]
            }])
            vision_context = f"\n[Контекст изображения: {vision_res['message']['content']}]"
        except Exception as e:
            vision_context = f"\n[Ошибка зрения: {str(e)}]"

    full_prompt = f"{text} {vision_context}".strip()
    history.append({"role": "user", "content": full_prompt})
    
    try:
        res = ollama.chat(model=BRAIN_MODEL, messages=[SYSTEM_PROMPT] + history)
        ans = res['message']['content']
        history.append({"role": "assistant", "content": ans})
        with open(path, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=4)
        return ans
    except Exception as e:
        return f"Ошибка Llama3: {str(e)}"

# --- МОНИТОРИНГ ---

def check_models():
    while not should_stop:
        try:
            models_info = ollama.list()
            installed = [m.model for m in models_info.models]
            eel.updateStatus(BRAIN_MODEL, any(BRAIN_MODEL in m for m in installed))()
            eel.updateStatus(VISION_MODEL, any(VISION_MODEL in m for m in installed))()
        except:
            pass
        eel.sleep(5)

# --- ЗАВЕРШЕНИЕ РАБОТЫ ---

def on_close(page, sockets):
    """Вызывается при закрытии окна браузера"""
    global should_stop
    should_stop = True
    print("🛑 Завершение работы Miranov AI...")
    sys.exit()

# Фоновые задачи
eel.spawn(check_models)

@eel.expose
def open_browser(url):
    """Открывает ссылку в стандартном браузере пользователя"""
    print(f"🔗 Открываю внешнюю ссылку: {url}")
    webbrowser.open(url)

if __name__ == "__main__":
    try:
        # Запуск с обработчиком закрытия
        eel.start('index.html', size=(1350, 950), close_callback=on_close)
    except (SystemExit, MemoryError, KeyboardInterrupt):
        pass
