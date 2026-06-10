import os

# Read PORT from environment (Railway sets this automatically)
bind = f"0.0.0.0:{os.environ.get('PORT', 8080)}"
workers = 1
timeout = 300
loglevel = "info"
