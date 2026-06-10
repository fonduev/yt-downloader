import os
import sys
import shutil
import tempfile
import time
import threading
import zipfile
import unicodedata
import urllib.parse
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import yt_dlp

app = Flask(__name__, static_folder='static')
CORS(app)

DOWNLOAD_FOLDER = os.path.join(os.path.expanduser("~"), "Downloads", "YT-Downloader")
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

# ── Auto-detect ffmpeg ───────────────────────────────────────────
def _find_ffmpeg():
    import shutil
    # 1. System ffmpeg (Docker / Linux servers with apt-installed ffmpeg)
    sys_ff = shutil.which('ffmpeg')
    if sys_ff:
        folder = os.path.dirname(sys_ff)
        print(f"  [ffmpeg] Sistema: {folder}")
        return folder
    # 2. Bundled imageio-ffmpeg (Windows local development)
    try:
        import imageio_ffmpeg
        exe    = imageio_ffmpeg.get_ffmpeg_exe()
        folder = os.path.dirname(exe)
        print(f"  [ffmpeg] Bundle: {folder}")
        return folder
    except Exception as e:
        print(f"  [ffmpeg] No disponible: {e}")
    return None

FFMPEG_LOCATION = _find_ffmpeg()

# Inject into PATH so yt-dlp finds ffmpeg even with ytsearch1: URLs
if FFMPEG_LOCATION and FFMPEG_LOCATION not in os.environ.get('PATH', ''):
    os.environ['PATH'] = FFMPEG_LOCATION + os.pathsep + os.environ.get('PATH', '')



# ── YouTube cookies (bypass PO Token block on cloud IPs) ─────────
# Set YOUTUBE_COOKIES env var in Railway with the base64-encoded cookies.txt
YOUTUBE_COOKIE_FILE = None
_raw_cookies = os.environ.get('YOUTUBE_COOKIES', '').strip()
if _raw_cookies:
    import tempfile as _tf, base64 as _b64
    # Support both base64-encoded and plain text
    try:
        _decoded = _b64.b64decode(_raw_cookies).decode('utf-8')\
            if not _raw_cookies.startswith('#') else _raw_cookies
    except Exception:
        _decoded = _raw_cookies
    _cf = _tf.NamedTemporaryFile(mode='w', suffix='.txt',
                                  prefix='yt_cookies_', delete=False)
    _cf.write(_decoded)
    _cf.flush()
    _cf.close()
    YOUTUBE_COOKIE_FILE = _cf.name
    print(f"  [cookies] YouTube cookies cargadas ({len(_decoded)} bytes)")
else:
    print("  [cookies] Sin cookies — usando Invidious proxy")


# ── Invidious video resolver (avoids YouTube bot detection on cloud IPs) ──
# Invidious is an open-source YouTube proxy — its servers fetch from YouTube
# so Railway never directly contacts YouTube
_INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.privacydev.net',
    'https://invidious.nerdvpn.de',
    'https://iv.datura.network',
    'https://invidious.fdn.fr',
]

def _resolve_via_invidious(query: str) -> str:
    """Search Invidious in PARALLEL across all instances → return first working URL."""
    import urllib.request as _ureq2, json as _json2
    from concurrent.futures import ThreadPoolExecutor, as_completed

    encoded = urllib.parse.quote(query)

    def _try(instance):
        try:
            api = f"{instance}/api/v1/search?q={encoded}&type=video&page=1"
            req = _ureq2.Request(api, headers={'User-Agent': 'Mozilla/5.0'})
            with _ureq2.urlopen(req, timeout=5) as r:
                results = _json2.loads(r.read().decode('utf-8'))
            if isinstance(results, list) and results:
                vid = results[0].get('videoId', '')
                if vid:
                    return f"{instance}/watch?v={vid}"
        except Exception:
            pass
        return None

    # Query all instances at once — return first success
    with ThreadPoolExecutor(max_workers=len(_INVIDIOUS_INSTANCES)) as ex:
        futures = {ex.submit(_try, inst): inst for inst in _INVIDIOUS_INSTANCES}
        for fut in as_completed(futures, timeout=10):
            result = fut.result()
            if result:
                print(f"  [invidious] ✓ {result[:60]}")
                return result

    print(f"  [invidious] Todos fallaron → ytsearch fallback")
    return f'ytsearch1:{query}'


# ── Shared helpers ───────────────────────────────────────────────
def get_id():
    import uuid
    return str(uuid.uuid4())[:10]


def _normalize(s):
    """Lowercase + remove diacritics for relevance matching."""
    return ''.join(
        c for c in unicodedata.normalize('NFD', s.lower())
        if unicodedata.category(c) != 'Mn'
    )


def relevance_score(title, channel, query_tokens):
    """Score how many query tokens appear in title+channel."""
    text = _normalize(title + ' ' + channel)
    return sum(1 for t in query_tokens if t in text)


def build_ydl_opts(fmt, quality, audio_quality, out_dir, progress_hook=None, embed_art=True):
    """Return yt-dlp options dict."""
    hooks = [progress_hook] if progress_hook else []

    # ── Anti-bot + reliability settings for cloud servers ────────
    # Try multiple clients; yt-dlp picks the first that works
    common = {
        'outtmpl':          os.path.join(out_dir, '%(title)s.%(ext)s'),
        'progress_hooks':   hooks,
        'quiet':            False,
        'no_warnings':      False,
        'retries':          10,
        'fragment_retries': 10,
        'extractor_args': {
            'youtube': {
                'player_client': ['mweb', 'tv_embedded', 'android_vr'],
            }
        },
    }
    # Use cookies if available (best option — bypasses all restrictions)
    if YOUTUBE_COOKIE_FILE:
        common['cookiefile'] = YOUTUBE_COOKIE_FILE
        common['extractor_args'] = {
            'youtube': {'player_client': ['web', 'android']}
        }


    if fmt == 'mp3':
        opts = {
            **common,
            'format': 'bestaudio/best',
            'postprocessors': [
                {'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3',
                 'preferredquality': str(audio_quality)},
                {'key': 'FFmpegMetadata', 'add_metadata': True},
            ],
        }
    else:
        if quality == 'best' or not quality:
            fmt_spec = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best'
        else:
            fmt_spec = (
                f'bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]'
                f'/bestvideo[height<={quality}]+bestaudio/best[height<={quality}]'
            )
        opts = {
            **common,
            'format':              fmt_spec,
            'merge_output_format': 'mp4',
            'postprocessors':      [{'key': 'FFmpegMetadata', 'add_metadata': True}],
        }
    if FFMPEG_LOCATION:
        opts['ffmpeg_location'] = FFMPEG_LOCATION
    return opts


# ════════════════════════════════════════════════════════════════
#  BROWSER DOWNLOAD  (prepare → serve to browser)
# ════════════════════════════════════════════════════════════════



prepare_jobs = {}
prepare_lock = threading.Lock()


def _cleanup_daemon():
    while True:
        time.sleep(300)
        cutoff = time.time() - 900
        with prepare_lock:
            stale = [t for t, j in prepare_jobs.items() if j.get('created_at', 0) < cutoff]
        for t in stale:
            with prepare_lock:
                job = prepare_jobs.pop(t, None)
            if job:
                shutil.rmtree(job.get('tmp_dir', ''), ignore_errors=True)

threading.Thread(target=_cleanup_daemon, daemon=True).start()


@app.route('/api/prepare-download', methods=['POST'])
def prepare_download():
    data    = request.json
    urls    = data.get('urls', [])
    fmt     = data.get('format', 'mp3')
    quality = data.get('quality', 'best')
    aq      = data.get('audio_quality', '192')

    if not urls:
        return jsonify({'error': 'URLs requeridas'}), 400

    token   = get_id()
    tmp_dir = tempfile.mkdtemp(prefix='ytdl_')

    with prepare_lock:
        prepare_jobs[token] = {
            'status': 'processing', 'progress': 0,
            'current_title': '', 'speed': '', 'eta': '',
            'total': len(urls), 'completed': 0, 'failed': 0,
            'filepath': None, 'filename': '', 'error': None,
            'tmp_dir': tmp_dir, 'created_at': time.time(),
        }

    def worker():
        def hook(d):
            with prepare_lock:
                if token not in prepare_jobs:
                    return
                job = prepare_jobs[token]
                if d['status'] == 'downloading':
                    raw = d.get('filename', '') or ''
                    job['current_title'] = os.path.basename(raw)
                    total_b = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                    dl_b    = d.get('downloaded_bytes', 0)
                    if total_b > 0:
                        job['progress'] = (job['completed'] / job['total']) * 100 + (dl_b / total_b) * 100 / job['total']
                    spd = d.get('speed', 0)
                    if spd:
                        job['speed'] = f"{spd/(1024*1024):.1f} MB/s" if spd > 1024*1024 else f"{spd/1024:.0f} KB/s"
                    eta = d.get('eta', 0)
                    if eta:
                        job['eta'] = f"{eta}s"

        opts = build_ydl_opts(fmt, quality, aq, tmp_dir, hook)

        for url in urls:
            try:
                # Resolve ytsearch: URLs via Invidious to bypass YouTube bot block
                if url.startswith('ytsearch'):
                    query = url.split(':', 1)[1]
                    url = _resolve_via_invidious(query)
                with yt_dlp.YoutubeDL(opts) as ydl:
                    ydl.download([url])
                with prepare_lock:
                    if token in prepare_jobs:
                        prepare_jobs[token]['completed'] += 1
                        c = prepare_jobs[token]['completed']
                        prepare_jobs[token]['progress'] = (c / len(urls)) * 100
            except Exception as e:
                with prepare_lock:
                    if token in prepare_jobs:
                        prepare_jobs[token]['failed'] += 1
                        prepare_jobs[token]['error'] = str(e)

        # Only count real media files — ignore leftover .jpg/.webp thumbnails
        MEDIA_EXTS = {'.mp3', '.mp4', '.m4a', '.webm', '.wav', '.ogg', '.opus', '.flac'}
        files = [f for f in os.listdir(tmp_dir)
                 if not f.startswith('.') and not f.endswith('.part')
                 and os.path.splitext(f)[1].lower() in MEDIA_EXTS]

        if not files:
            with prepare_lock:
                if token in prepare_jobs:
                    prepare_jobs[token]['status'] = 'error'
                    last_err = prepare_jobs[token].get('error') or 'No se encontraron archivos'
                    prepare_jobs[token]['error'] = f'Error al descargar: {last_err}'
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return

        if len(files) == 1:
            filepath = os.path.join(tmp_dir, files[0])
            filename = files[0]
        else:
            zip_path = os.path.join(tmp_dir, 'canciones.zip')
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for f in files:
                    zf.write(os.path.join(tmp_dir, f), f)
            filepath = zip_path
            filename = 'canciones.zip'

        with prepare_lock:
            if token in prepare_jobs:
                prepare_jobs[token].update({
                    'status': 'ready', 'progress': 100,
                    'filepath': filepath, 'filename': filename,
                    'speed': '', 'eta': '',
                })

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({'token': token})


@app.route('/api/prepare-status/<token>')
def prepare_status(token):
    with prepare_lock:
        job = prepare_jobs.get(token)
    if not job:
        return jsonify({'error': 'Token inválido'}), 404
    return jsonify({
        'status': job['status'], 'progress': round(job.get('progress', 0), 1),
        'current_title': job.get('current_title', ''), 'speed': job.get('speed', ''),
        'eta': job.get('eta', ''), 'total': job.get('total', 1),
        'completed': job.get('completed', 0), 'filename': job.get('filename', ''),
        'error': job.get('error'),
    })


@app.route('/api/get-file/<token>')
def get_file(token):
    with prepare_lock:
        job = prepare_jobs.get(token)
    if not job or job['status'] != 'ready':
        return jsonify({'error': 'Archivo no disponible'}), 404

    filepath = job['filepath']
    filename = job['filename']
    tmp_dir  = job['tmp_dir']

    if not os.path.exists(filepath):
        return jsonify({'error': 'Archivo no encontrado'}), 404

    def cleanup():
        time.sleep(60)
        with prepare_lock:
            prepare_jobs.pop(token, None)
        shutil.rmtree(tmp_dir, ignore_errors=True)

    threading.Thread(target=cleanup, daemon=True).start()

    ext = os.path.splitext(filename)[1].lower()
    mime_map = {'.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
                '.m4a': 'audio/mp4', '.zip': 'application/zip', '.webm': 'audio/webm'}
    return send_file(filepath, mimetype=mime_map.get(ext, 'application/octet-stream'),
                     as_attachment=True, download_name=filename, conditional=False)


# ════════════════════════════════════════════════════════════════
#  STATIC & INFO
# ════════════════════════════════════════════════════════════════

downloads     = {}
download_lock = threading.Lock()


@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/api/info', methods=['POST'])
def get_info():
    data = request.json
    url  = data.get('url', '').strip()
    if not url:
        return jsonify({'error': 'URL requerida'}), 400
    try:
        with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True,
                                'extract_flat': True, 'skip_download': True}) as ydl:
            info = ydl.extract_info(url, download=False)
        if info is None:
            return jsonify({'error': 'No se pudo obtener información'}), 400
        if info.get('_type') == 'playlist' or 'entries' in info:
            entries = info.get('entries', [])
            videos = []
            for e in entries:
                if e:
                    vid_id = e.get('id', '')
                    videos.append({
                        'id': vid_id, 'title': e.get('title', 'Sin título'),
                        'duration': e.get('duration'), 'thumbnail': e.get('thumbnail', ''),
                        'url': e.get('url') or f"https://www.youtube.com/watch?v={vid_id}",
                        'uploader': e.get('uploader', ''),
                    })
            return jsonify({'type': 'playlist', 'title': info.get('title', 'Playlist'),
                            'uploader': info.get('uploader', ''), 'thumbnail': info.get('thumbnail', ''),
                            'count': len(videos), 'videos': videos})
        else:
            with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True, 'skip_download': True}) as ydl:
                full_info = ydl.extract_info(url, download=False)
            return jsonify({'type': 'video', 'id': info.get('id', ''),
                            'title': info.get('title', 'Sin título'), 'duration': info.get('duration'),
                            'thumbnail': info.get('thumbnail', ''), 'uploader': info.get('uploader', ''),
                            'view_count': info.get('view_count', 0), 'url': url,
                            'qualities': _get_qualities(full_info)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _get_qualities(info):
    qualities = set()
    for fmt in info.get('formats', []):
        h = fmt.get('height')
        if h and fmt.get('vcodec') != 'none':
            qualities.add(h)
    labels = []
    for q in sorted(qualities, reverse=True):
        tag = ('4K' if q >= 2160 else '2K' if q >= 1440 else
               'Full HD' if q >= 1080 else 'HD' if q >= 720 else 'SD' if q >= 480 else '')
        labels.append({'value': str(q), 'label': f'{tag} ({q}p)' if tag else f'{q}p'})
    return labels


@app.route('/api/download', methods=['POST'])
def start_download():
    data         = request.json
    urls         = data.get('urls', [])
    format_type  = data.get('format', 'mp4')
    quality      = data.get('quality', 'best')
    audio_quality= data.get('audio_quality', '192')
    if not urls:
        return jsonify({'error': 'URLs requeridas'}), 400
    dl_id = get_id()
    with download_lock:
        downloads[dl_id] = {'id': dl_id, 'status': 'pending', 'progress': 0,
                            'total': len(urls), 'completed': 0, 'failed': 0,
                            'current_title': '', 'errors': [], 'speed': '', 'eta': ''}

    def do_download():
        def hook(d):
            with download_lock:
                if dl_id not in downloads:
                    return
                dl = downloads[dl_id]
                if d['status'] == 'downloading':
                    dl['status'] = 'downloading'
                    dl['current_title'] = os.path.basename(d.get('filename', '') or '')
                    total_b = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                    dl_b    = d.get('downloaded_bytes', 0)
                    if total_b > 0:
                        dl['progress'] = (dl['completed'] / dl['total']) * 100 + (dl_b / total_b) * 100 / dl['total']
                    spd = d.get('speed', 0)
                    if spd:
                        dl['speed'] = f"{spd/(1024*1024):.1f} MB/s" if spd > 1024*1024 else f"{spd/1024:.0f} KB/s"
                    eta = d.get('eta', 0)
                    if eta:
                        dl['eta'] = f"{eta}s"
        opts = build_ydl_opts(format_type, quality, audio_quality, DOWNLOAD_FOLDER, hook)
        with download_lock:
            downloads[dl_id]['status'] = 'downloading'
        for url in urls:
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    ydl.download([url])
                with download_lock:
                    if dl_id in downloads:
                        downloads[dl_id]['completed'] += 1
                        downloads[dl_id]['progress'] = (downloads[dl_id]['completed'] / downloads[dl_id]['total']) * 100
            except Exception as e:
                with download_lock:
                    if dl_id in downloads:
                        downloads[dl_id]['failed'] += 1
                        downloads[dl_id]['errors'].append(str(e))
        with download_lock:
            if dl_id in downloads:
                downloads[dl_id].update({'status': 'completed', 'progress': 100, 'speed': '', 'eta': ''})

    threading.Thread(target=do_download, daemon=True).start()
    return jsonify({'download_id': dl_id, 'folder': DOWNLOAD_FOLDER})


@app.route('/api/progress/<dl_id>')
def get_progress(dl_id):
    with download_lock:
        dl = downloads.get(dl_id)
    if dl is None:
        return jsonify({'error': 'Download no encontrado'}), 404
    return jsonify(dict(dl))


# ════════════════════════════════════════════════════════════════
#  SEARCH  (with relevance filtering)
# ════════════════════════════════════════════════════════════════

# Terms that indicate non-album content
EXCLUDE_TERMS = {
    'mix', 'megamix', 'medley', 'mashup', 'karaoke', 'tribute',
    'cover version', 'parody', 'parodia', 'instrumental', 'remix',
    'reaccion', 'reacción', 'reaction', 'compilation', 'compilacion',
}


@app.route('/api/search', methods=['POST'])
def search():
    data   = request.json
    query  = data.get('query', '').strip()
    stype  = data.get('type', 'music')
    limit  = int(data.get('limit', 24))

    if not query:
        return jsonify({'error': 'Consulta requerida'}), 400

    # Build effective search query
    if stype == 'artist':
        search_q = f'ytsearch{limit}:{query}'
    elif stype == 'playlist':
        search_q = f'ytsearch{limit}:{query} playlist'
    else:
        search_q = f'ytsearch{limit}:{query}'

    try:
        with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True,
                                'extract_flat': True, 'skip_download': True}) as ydl:
            info = ydl.extract_info(search_q, download=False)

        query_tokens = _normalize(query).split()

        results = []
        for e in (info.get('entries') or []):
            if not e:
                continue
            vid_id  = e.get('id', '')
            title   = e.get('title', '')
            channel = e.get('uploader') or e.get('channel', '')
            score   = relevance_score(title, channel, query_tokens)

            # Must have at least 1 matching token; skip totally off-topic results
            if score == 0:
                continue

            results.append({
                'id': vid_id,
                'title': title,
                'uploader': channel,
                'duration': e.get('duration'),
                'thumbnail': e.get('thumbnail') or f'https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg',
                'url': e.get('url') or f'https://www.youtube.com/watch?v={vid_id}',
                'view_count': e.get('view_count', 0),
                '_score': score,
            })

        # Sort by relevance descending, then remove internal field
        results.sort(key=lambda x: x['_score'], reverse=True)
        for r in results:
            r.pop('_score', None)

        return jsonify({'results': results[:limit], 'query': query})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ════════════════════════════════════════════════════════════════
#  ALBUM SEARCH  (iTunes Search API — free, no auth required)
# ════════════════════════════════════════════════════════════════

import urllib.request as _ureq
import json as _json


@app.route('/api/search-albums', methods=['POST'])
def search_albums():
    data  = request.json
    query = data.get('query', '').strip()
    if not query:
        return jsonify({'error': 'Consulta requerida'}), 400

    query_norm   = _normalize(query)
    query_tokens = query_norm.split()
    encoded_q    = urllib.parse.quote(query)
    results      = []

    # ════════════════════════════════════════════════════════
    #  STEP 1: Find the artist's iTunes ID
    # ════════════════════════════════════════════════════════
    artist_id   = None
    artist_name = query  # fallback display name

    try:
        artist_url = (
            f'https://itunes.apple.com/search'
            f'?term={encoded_q}&entity=musicArtist&limit=10&country=US'
        )
        req = _ureq.Request(artist_url, headers={'User-Agent': 'Mozilla/5.0'})
        with _ureq.urlopen(req, timeout=10) as resp:
            ar = _json.loads(resp.read().decode('utf-8'))

        # Pick the artist whose name best matches the query
        best_score = 0
        for item in ar.get('results', []):
            if item.get('wrapperType') != 'artist':
                continue
            name  = item.get('artistName', '')
            score = sum(1 for t in query_tokens if t in _normalize(name))
            if score > best_score:
                best_score  = score
                artist_id   = item.get('artistId')
                artist_name = name

    except Exception as ex:
        print(f'[search-albums] artist lookup error: {ex}')

    # ════════════════════════════════════════════════════════
    #  STEP 2a: If we have an artist ID → fetch ALL their albums
    # ════════════════════════════════════════════════════════
    if artist_id:
        try:
            lookup_url = (
                f'https://itunes.apple.com/lookup'
                f'?id={artist_id}&entity=album&limit=200&country=US'
            )
            req = _ureq.Request(lookup_url, headers={'User-Agent': 'Mozilla/5.0'})
            with _ureq.urlopen(req, timeout=12) as resp:
                raw = _json.loads(resp.read().decode('utf-8'))

            seen_keys = set()
            for item in raw.get('results', []):
                if item.get('wrapperType') != 'collection':
                    continue

                title       = (item.get('collectionName')
                               or item.get('collectionCensoredName', ''))
                artist      = item.get('artistName', artist_name)
                track_count = item.get('trackCount', 0) or 0

                if not title or track_count < 4:   # skip singles/EPs
                    continue

                key = _normalize(title)
                if key in seen_keys:
                    continue
                seen_keys.add(key)

                thumb = (item.get('artworkUrl100') or '').replace(
                    '100x100bb', '600x600bb')

                results.append({
                    'itunes_id':   item.get('collectionId'),
                    'id':          str(item.get('collectionId', '')),
                    'title':       title,
                    'artist':      artist,
                    'year':        (item.get('releaseDate') or '')[:4],
                    'thumbnail':   thumb,
                    'track_count': track_count,
                    'genre':       item.get('primaryGenreName', ''),
                    '_release':    item.get('releaseDate', '') or '',
                })

        except Exception as ex:
            print(f'[search-albums] album lookup error: {ex}')

    # ════════════════════════════════════════════════════════
    #  STEP 2b: Fallback — keyword album search (if no artist found)
    # ════════════════════════════════════════════════════════
    if not results:
        try:
            fb_url = (
                f'https://itunes.apple.com/search'
                f'?term={encoded_q}&entity=album&attribute=artistTerm'
                f'&limit=50&country=US'
            )
            req = _ureq.Request(fb_url, headers={'User-Agent': 'Mozilla/5.0'})
            with _ureq.urlopen(req, timeout=12) as resp:
                raw = _json.loads(resp.read().decode('utf-8'))

            seen_keys = set()
            for item in raw.get('results', []):
                artist = item.get('artistName', '')
                title  = (item.get('collectionName')
                          or item.get('collectionCensoredName', ''))
                if not title:
                    continue

                # At least one token must match the artist name
                if not any(t in _normalize(artist) for t in query_tokens):
                    continue

                track_count = item.get('trackCount', 0) or 0
                if track_count < 4:
                    continue

                key = _normalize(artist + title)
                if key in seen_keys:
                    continue
                seen_keys.add(key)

                thumb = (item.get('artworkUrl100') or '').replace(
                    '100x100bb', '600x600bb')

                results.append({
                    'itunes_id':   item.get('collectionId'),
                    'id':          str(item.get('collectionId', '')),
                    'title':       title,
                    'artist':      artist,
                    'year':        (item.get('releaseDate') or '')[:4],
                    'thumbnail':   thumb,
                    'track_count': track_count,
                    'genre':       item.get('primaryGenreName', ''),
                    '_release':    item.get('releaseDate', '') or '',
                })

        except Exception as ex:
            print(f'[search-albums] fallback error: {ex}')
            if not results:
                return jsonify({'error': str(ex)}), 500

    # Sort newest → oldest
    results.sort(key=lambda x: x.pop('_release', '') or '', reverse=True)
    return jsonify({'results': results[:40]})


# ════════════════════════════════════════════════════════════════
#  ALBUM TRACKS  (iTunes lookup → ytsearch per track)
# ════════════════════════════════════════════════════════════════



@app.route('/api/album-tracks', methods=['POST'])
def get_album_tracks():
    data       = request.json
    itunes_id  = data.get('itunes_id')
    title      = data.get('title', '').strip()
    artist     = data.get('artist', '').strip()
    thumbnail  = data.get('thumbnail', '')
    year       = data.get('year', '')

    if not itunes_id:
        return jsonify({'error': 'ID de álbum de iTunes requerido'}), 400

    try:
        # Get full tracklist from iTunes lookup API
        lookup_url = (f'https://itunes.apple.com/lookup'
                      f'?id={itunes_id}&entity=song&country=MX')
        req = _ureq.Request(lookup_url, headers={'User-Agent': 'Mozilla/5.0'})
        with _ureq.urlopen(req, timeout=12) as resp:
            raw = _json.loads(resp.read().decode('utf-8'))

        tracks = []
        for item in raw.get('results', []):
            if item.get('wrapperType') != 'track':
                continue

            track_name  = item.get('trackName', '')
            track_num   = item.get('trackNumber', len(tracks) + 1)
            duration_ms = item.get('trackTimeMillis', 0) or 0

            # Store search query — resolution via Invidious happens at download time
            yt_url = f'ytsearch1:{artist} {track_name}'

            tracks.append({
                'number':      track_num,
                'title':       track_name,
                'duration':    int(duration_ms / 1000) if duration_ms else None,
                'thumbnail':   thumbnail,   # High-res album cover for every track
                'url':         yt_url,
                'artist':      artist,
                'preview_url': item.get('previewUrl', ''),  # 30-sec iTunes preview MP3
            })

        tracks.sort(key=lambda x: x['number'])

        return jsonify({
            'type':        'album',
            'title':       title,
            'artist':      artist,
            'thumbnail':   thumbnail,
            'year':        year,
            'track_count': len(tracks),
            'tracks':      tracks,
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ════════════════════════════════════════════════════════════════
#  MISC
# ════════════════════════════════════════════════════════════════

@app.route('/api/open-folder', methods=['POST'])
def open_folder():
    try:
        os.startfile(DOWNLOAD_FOLDER)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/downloads-path')
def get_downloads_path():
    return jsonify({'path': DOWNLOAD_FOLDER})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print("=" * 60)
    print("  [YT-Downloader] Iniciando servidor...")
    print(f"  [ffmpeg] {'OK - ' + FFMPEG_LOCATION if FFMPEG_LOCATION else 'No encontrado'}")
    print(f"  [Carpeta] {DOWNLOAD_FOLDER}")
    print(f"  [Servidor] http://localhost:{port}")
    print("=" * 60)
    app.run(debug=False, host='0.0.0.0', port=port)

