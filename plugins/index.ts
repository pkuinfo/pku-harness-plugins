import type { PluginDef } from '@pku-harness/sdk';

import { authenticatorPlugin } from './authenticator/src';
import { calendarPlugin } from './calendar/src';
import { cardSharePlugin } from './card-share/src';
import { courseCatalogPlugin } from './course-catalog/src';
import { courseSyncPlugin } from './course-sync/src';
import { coursesPlugin } from './courses/src';
import { dashboardPlugin } from './dashboard/src';
import { deepseekPlugin } from './deepseek/src';
import { electivePlugin } from './elective/src';
import { financePlugin } from './finance/src';
import { libraryPlugin } from './library/src';
import { memoryPlugin } from './memory/src';
import { noticesPlugin } from './notices/src';
import { openAICompatiblePlugin } from './openai-compatible/src';
import { pluginsPlugin } from './plugins/src';
import { roomBookingPlugin } from './room-booking/src';
import { schedulePlugin } from './schedule/src';
import { schedulerPlugin } from './scheduler/src';
import { timetablePlugin } from './timetable/src';
import { todoPlugin } from './todo/src';
import { treeholePlugin } from './treehole/src';
import { uiPlugin } from './ui/src';
import { walletPlugin } from './wallet/src';

/**
 * TypeScript plugins bundled with the app (the harness's own features and integrations not yet
 * ported). Integrations written as plugin documents (plugins/<id>/PLUGIN.md) ship as
 * `bundledDocuments` instead.
 *
 * Plugins bundled with the app. They are ordinary plugins — same SDK, same permissions as
 * community ones; "built-in" only means they ship inside the app binary (store rules forbid
 * downloading code). Order = order in Settings and the system prompt.
 */
export const builtinPlugins: PluginDef[] = [
  uiPlugin,
  dashboardPlugin,
  schedulerPlugin,
  todoPlugin,
  schedulePlugin,
  timetablePlugin,
  courseSyncPlugin,
  authenticatorPlugin,
  calendarPlugin,
  walletPlugin,
  cardSharePlugin,
  coursesPlugin,
  courseCatalogPlugin,
  treeholePlugin,
  electivePlugin,
  financePlugin,
  libraryPlugin,
  roomBookingPlugin,
  noticesPlugin,
  memoryPlugin,
  pluginsPlugin,
  deepseekPlugin,
  openAICompatiblePlugin,
];
export { bundledDocuments } from './documents.generated';
