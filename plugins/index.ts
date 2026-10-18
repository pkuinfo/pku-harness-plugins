import type { PluginDef } from '@pku-harness/sdk';

import { calendarPlugin } from './calendar/src';
import { campusCardPlugin } from './campus-card/src';
import { dashboardPlugin } from './dashboard/src';
import { deepseekPlugin } from './deepseek/src';
import { memoryPlugin } from './memory/src';
import { netfeePlugin } from './netfee/src';
import { openAICompatiblePlugin } from './openai-compatible/src';
import { pluginsPlugin } from './plugins/src';
import { schedulePlugin } from './schedule/src';
import { schedulerPlugin } from './scheduler/src';
import { timetablePlugin } from './timetable/src';
import { todoPlugin } from './todo/src';
import { uiPlugin } from './ui/src';

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
  calendarPlugin,
  campusCardPlugin,
  netfeePlugin,
  memoryPlugin,
  pluginsPlugin,
  deepseekPlugin,
  openAICompatiblePlugin,
];
