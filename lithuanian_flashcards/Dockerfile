FROM python:3.12-slim

WORKDIR /app

COPY . /app/lithuanian_flashcards

ENV HOST=0.0.0.0
ENV PORT=10000
ENV LITHUANIAN_FLASHCARDS_DATA_DIR=/data

EXPOSE 10000

CMD ["python", "/app/lithuanian_flashcards/server.py"]
