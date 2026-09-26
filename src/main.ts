import express from "express";
import morgan from "morgan";
import "express-async-errors";
import cookieParser from "cookie-parser";
import { gameRouter } from "./presentation/gameRouter";
import { turnRouter } from "./presentation/turnRouter";
import { meRouter } from "./presentation/meRouter";
import { attachPlayer } from "./presentation/middleware/identity";
import { errorHandler } from "./presentation/errorHandler";

const PORT = 3000;

export const app = express();

app.use(morgan("dev"));
app.use(express.static("static", { extensions: ["html"] }));
app.use(express.json());
app.use(cookieParser());
app.use("/api", attachPlayer);

app.use(gameRouter);
app.use(turnRouter);
app.use(meRouter);

app.use(errorHandler);

// Vercel imports the app instead of running this file, so only open a port
// when started directly (npm start).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Reversi application : http://localhost:${PORT}`);
  });
}
