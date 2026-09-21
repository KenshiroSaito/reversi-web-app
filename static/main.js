const WINNER_DRAW = 0;
const WINNER_DARK = 1;
const WINNER_LIGHT = 2;

const gamesTableBodyElement = document.getElementById("games-table-body");

async function showGames() {
  const response = await fetch("/api/games");
  const responseBody = await response.json();
  const games = responseBody.games;

  while (gamesTableBodyElement.firstChild) {
    gamesTableBodyElement.removeChild(gamesTableBodyElement.firstChild);
  }
  games.forEach((game) => {
    const trElement = document.createElement("tr");

    const appendTdElement = (innerText) => {
      const tdElement = document.createElement("td");
      tdElement.innerText = innerText;
      trElement.appendChild(tdElement);
    };

    appendTdElement(formatDate(game.startedAt));
    appendTdElement(formatDuration(game.startedAt, game.endAt));
    appendTdElement(winnerDiscToString(game.winnerDisc));


    gamesTableBodyElement.appendChild(trElement);
  });
}

function formatDate(dateString) {
  if (!dateString) {
    return "";
  }

  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDuration(startedAtString, endAtString) {
  if (!startedAtString || !endAtString) {
    return "";
  }

  const startedAt = new Date(startedAtString);
  const endAt = new Date(endAtString);
  const totalSeconds = Math.floor((endAt.getTime() - startedAt.getTime()) / 1000);

  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${hours}-${minutes}-${seconds}`;
}

function winnerDiscToString(winnerDisc) {
  if (winnerDisc === WINNER_DARK) {
    return "Black";
  } else if (winnerDisc === WINNER_LIGHT) {
    return "White";
  } else if (winnerDisc === WINNER_DRAW) {
    return "Draw";
  } else {
    return "";
  }
}

showGames();
