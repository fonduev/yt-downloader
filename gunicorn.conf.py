import os

# Read PORT from environment (Render / Railway / HF Spaces set this automatically)
bind = f"0.0.0.0:{os.environ.get('PORT', 10000)}"
workers = 1
timeout = 300
loglevel = "info"
