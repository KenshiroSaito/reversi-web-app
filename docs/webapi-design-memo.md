# API Design Notes

## Start a game

Register a "Match"

POST/api/games

## View the board

Retreve "turns" for the specified number of turns

GET /api/games/latest/turns/{turnCount}

Response body

```json
{
  "turnCount": 1.
  "board": [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 2, 0, 0, 0],
    [0, 0, 0, 2, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  "nextDisc": 1,
  "winnerDisc": 1
}
```

## Place a stone

Register a "Turn"

POST /api/games/latest/turns

Request body

```json
{
  "turnCount": 1.
  "move": {
    "disc": 1,
    "x": 0,
    "y": 0,
  }
}
```

## Display my game results

Get a list of "matches"

GET /api/games

Response body

```json
{
  "games": 1, 
  {
    "id": 1,
    "winnerDisc": 1, 
    "startedAt": "YYYY-MM-DD hh:mm:ss"
  }
  {
    "id": 2,
    "winnerDisc": 1, 
    "startedAt": "YYYY-MM-DD hh:mm:ss"
  }
}
```


