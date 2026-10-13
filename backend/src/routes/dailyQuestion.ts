import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { answerDailyQuestion, getDailyQuestionState, startDailyQuestion } from "../services/dailyQuestion/service.js";

// Daily Question (2026-10-13) — see services/dailyQuestion/service.ts.
export const dailyQuestionRouter = Router();

dailyQuestionRouter.get("/", requireAuth, async (req, res) => {
  try {
    res.json(await getDailyQuestionState(req.userId!));
  } catch (err) {
    console.error("GET /api/daily-question failed:", err);
    res.status(500).json({ error: "Failed to load the daily question" });
  }
});

dailyQuestionRouter.post("/start", requireAuth, async (req, res) => {
  try {
    res.json(await startDailyQuestion(req.userId!));
  } catch (err) {
    console.error("POST /api/daily-question/start failed:", err);
    res.status(500).json({ error: "Failed to start the daily question" });
  }
});

dailyQuestionRouter.post("/answer", requireAuth, async (req, res) => {
  const choice = req.body?.choice;
  if (choice !== "a" && choice !== "b") {
    res.status(400).json({ error: "choice must be 'a' or 'b'" });
    return;
  }
  try {
    const result = await answerDailyQuestion(req.userId!, choice);
    if ("error" in result) {
      res.status(409).json({ error: "No question started today" });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error("POST /api/daily-question/answer failed:", err);
    res.status(500).json({ error: "Failed to answer the daily question" });
  }
});
