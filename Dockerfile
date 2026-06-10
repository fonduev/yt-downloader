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

EXPOSE 8080

# gunicorn.conf.py reads PORT from environment using Python — no shell expansion issues
CMD ["gunicorn", "app:app", "-c", "gunicorn.conf.py"]

