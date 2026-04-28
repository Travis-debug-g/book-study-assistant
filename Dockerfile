FROM node:18-slim AS frontend-build

WORKDIR /frontend

ENV NODE_OPTIONS=--max_old_space_size=4096
ENV CI=false

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./
COPY --from=frontend-build /frontend/build ./frontend/build

EXPOSE 10000

CMD ["python", "main.py"]
