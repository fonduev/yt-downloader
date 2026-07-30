# 🎵 YT Downloader Pro

> Descarga videos y música de YouTube en MP4 o MP3 con la calidad que elijas.

![Python](https://img.shields.io/badge/Python-3.9+-blue?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-Web_App-green?logo=flask)
![yt--dlp](https://img.shields.io/badge/yt--dlp-Powered-red?logo=youtube)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## ✨ Características

- 🎶 **Descarga MP3** — Convierte cualquier video de YouTube a audio MP3 con la calidad que quieras (128k, 192k, 320k)
- 🎬 **Descarga MP4** — Videos en la resolución que elijas (360p, 720p, 1080p, 4K)
- 💿 **Álbumes completos** — Busca álbumes de artistas y descarga todas las canciones de una vez
- 🔍 **Búsqueda integrada** — Busca música y videos directamente sin salir de la app
- 📱 **Diseño responsivo** — Funciona perfecto en PC, tablet y celular
- ⚡ **Rápido** — Descarga optimizada con múltiples fuentes

---

## 🚀 Usar Online (Gratis)

👉 **[Abrir YT Downloader Pro](https://yt-downloader-latest.onrender.com)** 

> **Nota:** La primera visita puede tardar ~30 segundos si el servidor está dormido (hosting gratuito).

### Despliega tu propia copia (gratis)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/fonduev/yt-downloader)

---

## 💻 Instalar en tu PC (Windows)

Si prefieres correrlo localmente en tu computadora:

### Requisitos
- [Python 3.9+](https://www.python.org/downloads/) (marca "Add to PATH" al instalar)
- [FFmpeg](https://ffmpeg.org/download.html) (o instala con `winget install Gyan.FFmpeg`)

### Pasos

```bash
# 1. Clona el repositorio
git clone https://github.com/diegoojedachacin-a11y/yt-downloader.git

# 2. Entra a la carpeta
cd yt-downloader

# 3. Doble clic en Iniciar.bat ¡y listo!
```

O manualmente:
```bash
pip install -r requirements.txt
python app.py
# Abre http://localhost:10000 en tu navegador
```

---

## 🐳 Docker

```bash
docker build -t yt-downloader .
docker run -p 10000:10000 yt-downloader
# Abre http://localhost:10000
```

---

## 📦 Tecnologías

| Tecnología | Uso |
|---|---|
| **Python / Flask** | Backend y API |
| **yt-dlp** | Motor de descarga |
| **FFmpeg** | Conversión de audio/video |
| **HTML/CSS/JS** | Frontend moderno |
| **iTunes API** | Búsqueda de álbumes |
| **Invidious** | Proxy de búsqueda (anti-bloqueo) |

---

## ⚙️ Variables de Entorno (Opcionales)

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (default: 10000) |
| `YOUTUBE_COOKIES` | Cookies de YouTube en base64 para mejorar velocidad |

---

## 📄 Licencia

MIT — Úsalo como quieras 🎉

---

Hecho con ❤️ por **Diego Renee Ojeda Chacin**
