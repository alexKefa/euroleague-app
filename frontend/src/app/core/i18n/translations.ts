import { Lang } from "./lang";
import { chromeTranslations } from "./chrome";
import { authTranslations } from "./auth";
import { dashboardTranslations } from "./dashboard";
import { newsTranslations } from "./news";
import { scheduleTranslations } from "./schedule";
import { predictionsTranslations } from "./predictions";
import { playerTranslations } from "./player";
import { gameTranslations } from "./game";
import { storeTranslations } from "./store";
import { tradesTranslations } from "./trades";
import { inventoryTranslations } from "./inventory";
import { rosterTranslations } from "./roster";
import { tourTranslations } from "./tour";
import { albumTranslations } from "./album";
import { statsTranslations } from "./stats";
import { teamsTranslations } from "./teams";
import { standingsTranslations } from "./standings";
import { analyticsBuilderTranslations } from "./analytics-builder";
import { leaguesTranslations } from "./leagues";

export type { Lang };

// Keys are dot-namespaced by feature (nav.*, profile.*, dashboard.*, ...) so
// unrelated features can't collide. Each feature's dictionary lives in its
// own file and gets merged in here — keeps concurrent edits to different
// features from touching the same file.
export const translations: Record<string, Record<Lang, string>> = {
  ...chromeTranslations,
  ...authTranslations,
  ...dashboardTranslations,
  ...newsTranslations,
  ...scheduleTranslations,
  ...predictionsTranslations,
  ...playerTranslations,
  ...gameTranslations,
  ...storeTranslations,
  ...tradesTranslations,
  ...inventoryTranslations,
  ...rosterTranslations,
  ...tourTranslations,
  ...albumTranslations,
  ...statsTranslations,
  ...teamsTranslations,
  ...standingsTranslations,
  ...analyticsBuilderTranslations,
  ...leaguesTranslations,
};
