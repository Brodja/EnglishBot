# Local PostgreSQL для dev

## Запустити

```bash
docker compose -f docker/docker-compose.yml up -d
```

## Зупинити

```bash
docker compose -f docker/docker-compose.yml down
```

## Підключитися через psql

```bash
docker exec -it englishbot_postgres psql -U englishbot -d englishbot
```

## Скинути дані (видаляє volume)

```bash
docker compose -f docker/docker-compose.yml down -v
```

## DATABASE_URL для .env

```
DATABASE_URL=postgresql://englishbot:englishbot_pass@localhost:5432/englishbot
```
