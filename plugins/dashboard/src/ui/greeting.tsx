import { classesOn, classStatus, weekOf, type HostServices, type HostUI } from '@pku-harness/sdk';
import { View } from 'react-native';

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** Time-of-day greeting (Beijing student hours: late nights are common). */
export function greetingFor(hour: number) {
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/** The dashboard's opening line: who you are, what day it is, what's next. */
export function Greeting({ host, services }: { host: HostUI; services: HostServices }) {
  const { Text, FadeIn } = host.components;
  const t = host.useTheme();
  host.useStoreVersion();
  const now = host.useNow(60_000);
  const campus = services.campus.status();
  const { courses, semester } = services.timetable.get();
  const week = weekOf(semester, now);
  const today = classesOn(courses, now, semester).map((c) => ({ c, s: classStatus(c, now) }));
  const current = today.find((x) => x.s.state === 'ongoing');
  const next = today.find((x) => x.s.state === 'before');
  const left = today.filter((x) => x.s.state !== 'after').length;

  const who = campus.name ?? (campus.signedIn ? '同学' : '');
  const day = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY[now.getDay()]}${week ? ` · 第 ${week} 周` : ''}`;
  const line = current
    ? `正在上「${current.c.name}」${current.c.location ? ` · ${current.c.location}` : ''}`
    : next
      ? `下一节「${next.c.name}」${next.s.minutesToStart <= 90 ? ` · ${next.s.minutesToStart} 分钟后` : ` · ${next.c.start}`}${next.c.location ? ` · ${next.c.location}` : ''}`
      : today.length
        ? '今天的课都上完了'
        : courses.length
          ? '今天没有课'
          : campus.signedIn
            ? '你可以在对话里让我同步课表、看余额、设提醒'
            : '登录校园账号后，这里会显示你的一天';

  return (
    <FadeIn>
      <View style={{ gap: t.spacing.xs, paddingBottom: t.spacing.xs }}>
        <Text variant="micro" tone="faint">
          {day}
        </Text>
        <Text variant="title" numberOfLines={1}>
          {greetingFor(now.getHours())}
          {who ? `，${who}` : ''}
        </Text>
        <Text variant="callout" tone={current ? 'accent' : 'muted'} numberOfLines={2}>
          {line}
          {left > 1 && !current ? ` · 今天还有 ${left} 节` : ''}
        </Text>
      </View>
    </FadeIn>
  );
}
