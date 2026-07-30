FROM python:3.11-slim

# Install system ffmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir --upgrade yt-dlp

COPY . .

# Create temp downloads directory
RUN mkdir -p /tmp/ytdl_downloads

EXPOSE ${PORT:-10000}

CMD ["gunicorn", "app:app", "-c", "gunicorn.conf.py"]
