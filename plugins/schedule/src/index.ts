import { definePlugin } from '@pku-harness/sdk';

import { CourseForm } from './ui/course-form';
import { ReminderForm } from './ui/reminder-form';
import { ScheduleTab } from './ui/schedule-tab';
import { SemesterForm } from './ui/semester-form';
import { TodoForm } from './ui/todo-form';

/**
 * The Schedule tab: classes, to-dos and reminders in one place, plus their forms. A UI plugin
 * over the timetable / todo / scheduler services; the agent uses those plugins' tools directly.
 */
export const schedulePlugin = definePlugin({
  id: 'schedule',
  name: '日程',
  description: '日程页：今天的课、待办、提醒，以及课表周视图和相关表单。',
  version: '0.1.0',
  icon: 'schedule',
  core: true,
  scopes: [],
  tools: {},
  contributes: {
    screens: {
      home: { title: '日程', component: ScheduleTab },
      todo: { title: '待办', component: TodoForm, presentation: 'modal' },
      reminder: { title: '提醒', component: ReminderForm, presentation: 'modal' },
      course: { title: '课程', component: CourseForm, presentation: 'modal' },
      semester: { title: '学期', component: SemesterForm, presentation: 'modal' },
    },
    tabs: [{ slot: 'schedule', screen: 'home' }],
  },
});
