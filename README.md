# Reversi Web App

A browser-based Reversi (Othello) game. Built with TypeScript and Express, it persists board state and match history to MySQL. The codebase follows a layered architecture based on Domain-Driven Design (DDD).

## Features

- Play Reversi on an 8×8 board
- Persist moves, board state, and game results to MySQL
- Browse recent game history
- Clean separation into domain / application / infrastructure / presentation layers

## Tech Stack

- **Language**: TypeScript
- **Server**: Node.js 16.17.1 / Express
- **Database**: MySQL 8.0
- **Frontend**: Plain HTML / CSS / JavaScript (under `static/`)
- **Runtime**: Docker Compose (for MySQL)

## Prerequisites

- [Node.js](https://nodejs.org/) 16.17.1 (declared in `.tool-versions`; works out of the box if you use a version manager such as [asdf](https://asdf-vm.com/))
- [Docker](https://www.docker.com/) / Docker Compose

## Setup

### 1. Clone the repo and install dependencies

```bash
git clone <this-repository-url>
cd reversi-web-app
npm install
```

### 2. Start the MySQL container

```bash
docker-compose up -d
```

This starts a MySQL 8.0 container on `localhost:3306` (see `docker-compose.yaml` for details).

### 3. Initialize the database (create tables)

Once the container is up, load the DDL to create the tables:

```bash
./bin/load_ddl.sh
```

> This script pipes the contents of `mysql/init.sql` into the MySQL container.

### 4. Start the application

```bash
npm start
```

The server starts with `nodemon` + `ts-node` (it auto-restarts when you change files under `src/`).

On success, you'll see the following in the console:

```
Reversi application : http://localhost:3000
```

### 5. Open in your browser

Go to [http://localhost:3000](http://localhost:3000) to view the game.

## Handy Commands

### Connect to MySQL

```bash
./bin/connect_mysql.sh
```

Opens a MySQL client connected to the `reversi` database.

### Stop the containers

```bash
docker-compose down
```

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET`  | `/api/games` | Get the list of recent games |
| `POST` | `/api/games` | Start a new game |
| `GET`  | `/api/games/latest/turns/:turnCount` | Get the board for a given turn of the latest game |
| `POST` | `/api/games/latest/turns` | Register a move and the next turn in the latest game |

See [docs/openapi.yaml](docs/openapi.yaml) for the full API specification.

## Project Structure

```
src/
├── main.ts                # Entry point (Express startup & routing)
├── domain/                # Domain layer (game, turn, board, and other models)
├── application/           # Application layer (use cases & query services)
├── infrastructure/        # Infrastructure layer (MySQL connection & repository implementations)
└── presentation/          # Presentation layer (routers)

static/                    # Frontend (HTML / CSS / JS)
mysql/init.sql             # Table definitions (DDL)
bin/                       # Helper scripts
docs/                      # Design docs (ER diagram, domain model, OpenAPI, etc.)
```

## Configuration

The MySQL connection settings are as follows (`docker-compose.yaml` / `src/infrastructure/connection.ts`):

| Item | Value |
| --- | --- |
| Host | `localhost` |
| Port | `3306` |
| Database | `reversi` |
| User | `reversi` |
| Password | `password` |

The application runs on port `3000` (`src/main.ts`).
