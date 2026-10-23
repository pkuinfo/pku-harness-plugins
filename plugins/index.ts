import type { PluginDef } from '@pku-harness/sdk';

import { authenticatorPlugin } from './authenticator/src';
import { calendarPlugin } from './calendar/src';
import { campusEventsPlugin } from './campus-events/src';
import { canteenPlugin } from './canteen/src';
import { classroomsPlugin } from './classrooms/src';
import { courseCatalogPlugin } from './course-catalog/src';
import { courseSyncPlugin } from './course-sync/src';
import { coursesPlugin } from './courses/src';
import { dashboardPlugin } from './dashboard/src';
import { deepseekPlugin } from './deepseek/src';
import { electivePlugin } from './elective/src';
import { financePlugin } from './finance/src';
import { gradesPlugin } from './grades/src';
import { libraryPlugin } from './library/src';
import { memoryPlugin } from './memory/src';
import { noticesPlugin } from './notices/src';
import { openAICompatiblePlugin } from './openai-compatible/src';
import { pluginsPlugin } from './plugins/src';
import { roomBookingPlugin } from './room-booking/src';
import { schedulePlugin } from './schedule/src';
import { schedulerPlugin } from './scheduler/src';
import { shuttlePlugin } from './shuttle/src';
import { timetablePlugin } from './timetable/src';
import { todoPlugin } from './todo/src';
import { treeholePlugin } from './treehole/src';
import { uiPlugin } from './ui/src';
import { walletPlugin } from './wallet/src';

/**
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
  coursesPlugin,
  courseCatalogPlugin,
  gradesPlugin,
  treeholePlugin,
  campusEventsPlugin,
  electivePlugin,
  financePlugin,
  libraryPlugin,
  roomBookingPlugin,
  classroomsPlugin,
  canteenPlugin,
  shuttlePlugin,
  noticesPlugin,
  memoryPlugin,
  pluginsPlugin,
  deepseekPlugin,
  openAICompatiblePlugin,
];
