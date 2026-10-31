FROM python:3.12-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY server.py /app/server.py
COPY static /app/static

RUN addgroup -S -g 10001 admin \
 && adduser -S -D -H -u 10001 -G admin admin \
 && mkdir -p /data \
 && chown -R admin:admin /app /data

USER admin

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python3 -c "import socket; s=socket.create_connection(('127.0.0.1',8080),2); s.close()"

CMD ["python3", "-u", "/app/server.py"]
