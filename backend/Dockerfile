FROM python:3.11-slim

WORKDIR /app

# Install system dependencies.  yt-dlp itself is installed via pip so the
# runtime picks up optional extras like curl-cffi for impersonation support.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl nodejs ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir -U --pre "yt-dlp[default]"

# Copy backend source
COPY . ./backend

# Set the Python path so absolute imports resolving to `backend.x` work seamlessly
ENV PYTHONPATH=/app
EXPOSE 8000

# The startup command is dynamically overridden by docker-compose.yml, but we provide a safe fallback
CMD ["python", "main.py"]
