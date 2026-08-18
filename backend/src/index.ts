import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { teamsRouter } from "./routes/teams.js";
import { standingsRouter } from "./routes/standings.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { playersRouter } from "./routes/players.js";
import { newsRouter } from "./routes/news.js";
import { gamesRouter } from "./routes/games.js";
import { predictionsRouter } from "./routes/predictions.js";
import { collectiblesRouter } from "./routes/collectibles.js";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "euroleague-app-backend" });
});

app.use("/api/teams", teamsRouter);
app.use("/api/standings", standingsRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/players", playersRouter);
app.use("/api/news", newsRouter);
app.use("/api/games", gamesRouter);
app.use("/api/predictions", predictionsRouter);
app.use("/api/collectibles", collectiblesRouter);

// Route modules get mounted here as they're built:
// app.use("/api/notifications", notificationsRouter);

app.listen(port, () => {
  console.log(`euroleague-app-backend listening on http://localhost:${port}`);
});