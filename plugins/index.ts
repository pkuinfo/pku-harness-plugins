import type { PluginDef } from '@pku-harness/sdk';

import { aliyunBailianPlugin } from './aliyun-bailian/src';
import { authenticatorPlugin } from './authenticator/src';
import { copilotPlugin } from './copilot/src';
import { calendarPlugin } from './calendar/src';
import { cardSharePlugin } from './card-share/src';
import { dashboardPlugin } from './dashboard/src';
import { deepseekPlugin } from './deepseek/src';
import { filesPlugin } from './files/src';
import { ledgerPlugin } from './ledger/src';
import { memoryPlugin } from './memory/src';
import { openAICompatiblePlugin } from './openai-compatible/src';
import { pluginsPlugin } from './plugins/src';
import { schedulePlugin } from './schedule/src';
import { schedulerPlugin } from './scheduler/src';
import { siliconflowPlugin } from './siliconflow/src';
import { timetablePlugin } from './timetable/src';
import { todoPlugin } from './todo/src';
import { uiPlugin } from './ui/src';

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
  copilotPlugin,
  uiPlugin,
  dashboardPlugin,
  schedulerPlugin,
  todoPlugin,
  schedulePlugin,
  timetablePlugin,
  authenticatorPlugin,
  calendarPlugin,
  cardSharePlugin,
  ledgerPlugin,
  memoryPlugin,
  filesPlugin,
  pluginsPlugin,
  deepseekPlugin,
  openAICompatiblePlugin,
  siliconflowPlugin,
  aliyunBailianPlugin,
];
export { bundledDocuments } from './documents.generated';
