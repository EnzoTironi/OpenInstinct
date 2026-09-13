FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir uv==0.12.13
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY app.py serve.py ./
ENV PYTHONUNBUFFERED=1 MEM0_TELEMETRY=false ZOEN_MEMORY_DATA=/data
EXPOSE 8000
CMD [".venv/bin/python", "serve.py"]
