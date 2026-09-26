const EMPTY = 0;
const DARK = 1;
const LIGHT = 2;

const WINNER_DRAW = 0;
const WINNER_DARK = 1;
const WINNER_LIGHT = 2;

// Sent on every POST: the server rejects state-changing requests without it (CSRF).
const POST_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "reversi",
};

const boardElement = document.getElementById("board");
const nextDiscMessageElement = document.getElementById("next-disc-message");
const warningMessageElement = document.getElementById("warning-message");

let gameId;
let currentState;

async function main() {
  const idParam = new URLSearchParams(location.search).get("id");
  if (idParam === null) {
    const response = await fetch("/api/games", { method: "POST", headers: POST_HEADERS });
    if (!response.ok) {
      showErrorForStatus(response.status);
      return;
    }
    gameId = (await response.json()).id;
    // Keep the game in the URL so a reload resumes it instead of starting a new one.
    history.replaceState(null, "", `/game/?id=${gameId}`);
  } else {
    gameId = idParam;
  }

  await refreshState();
}

async function refreshState() {
  const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`);
  if (!response.ok) {
    showErrorForStatus(response.status);
    return;
  }
  render(await response.json(), undefined);
}

function render(state, previousDisc) {
  currentState = state;

  showWarningMessage(previousDisc, state.nextDisc, state.winnerDisc);
  showNextDiscMessage(state.nextDisc);

  while (boardElement.firstChild) {
    boardElement.removeChild(boardElement.firstChild);
  }

  state.board.forEach((line, y) => {
    line.forEach((square, x) => {
      const squareElement = document.createElement("div");
      squareElement.className = "square";

      if (square !== EMPTY) {
        const stoneElement = document.createElement("div");
        const color = square === DARK ? "dark" : "light";
        stoneElement.className = `stone ${color}`;

        squareElement.appendChild(stoneElement);
      } else if (state.nextDisc !== null) {
        squareElement.addEventListener("click", () => registerMove(x, y));
      }

      boardElement.appendChild(squareElement);
    });
  });
}

async function registerMove(x, y) {
  const previousDisc = currentState.nextDisc;
  const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/turns`, {
    method: "POST",
    headers: POST_HEADERS,
    body: JSON.stringify({ turnCount: currentState.turnCount + 1, move: { x, y } }),
  });

  if (response.status === 201) {
    render(await response.json(), previousDisc);
  } else if (response.status === 400) {
    showCannotPlaceMessage();
  } else if (response.status === 409) {
    // The board is out of date (another tab moved, or the game ended): reload it.
    await refreshState();
  } else {
    showErrorForStatus(response.status);
  }
}

function discToString(disc) {
  return disc === DARK ? "Black" : "White";
}

function showWarningMessage(previousDisc, nextDisc, winnerDisc) {
  const message = warningMessage(previousDisc, nextDisc, winnerDisc);

  warningMessageElement.innerText = message;

  if (message === null) {
    warningMessageElement.style.display = "none";
  } else {
    warningMessageElement.style.display = "block";
  }

  warningMessageElement.style.background = warningMessageColor(
    previousDisc,
    nextDisc,
    winnerDisc,
  );
}

function warningMessageColor(previousDisc, nextDisc, winnerDisc) {
  if (nextDisc !== null) {
    if (previousDisc === nextDisc) {
      return "#c94542";
    } else {
      return "";
    }
  } else {
    if (winnerDisc === WINNER_DRAW) {
      return "";
    } else {
      return "#469c3d";
    }
  }
}

function warningMessage(previousDisc, nextDisc, winnerDisc) {
  if (nextDisc !== null) {
    if (previousDisc === nextDisc) {
      const skipped = nextDisc === DARK ? LIGHT : DARK;
      return `Skip ${discToString(skipped)} turn`;
    } else {
      return null;
    }
  } else {
    if (winnerDisc === WINNER_DRAW) {
      return "Draw";
    } else {
      return `Congratulations: ${discToString(winnerDisc)} won!!!`;
    }
  }
}

function showNextDiscMessage(nextDisc) {
  if (nextDisc) {
    nextDiscMessageElement.innerText = `Next: ${discToString(nextDisc)} turn`;
  } else {
    nextDiscMessageElement.innerText = "";
  }
  nextDiscMessageElement.style.background = "";
}

function showCannotPlaceMessage() {
  nextDiscMessageElement.innerText = "You can't place a stone there";
  nextDiscMessageElement.style.background = "#fffc63";
}

function showErrorForStatus(status) {
  const messages = {
    404: "Game not found",
    429: "Too many new games — try again later",
    503: "The server is temporarily unavailable",
  };

  while (boardElement.firstChild) {
    boardElement.removeChild(boardElement.firstChild);
  }
  warningMessageElement.style.display = "none";
  nextDiscMessageElement.innerText = messages[status] ?? "Something went wrong";
  nextDiscMessageElement.style.background = "#fffc63";
}

main();
