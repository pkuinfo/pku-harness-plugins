import type { PluginScreenProps } from '@pku-harness/sdk';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { playbackUrl, videos } from './api';
import type { CourseInfo } from './parse';

type Video = Awaited<ReturnType<typeof videos>>[number];

/**
 * 课程回放: pick a course, tap a recording, and the system browser plays its HLS stream. The
 * signed playlist URL is resolved here on the device (api.ts playbackUrl) and never goes through
 * a tool result, so it never reaches the model.
 */
export function VideosScreen({ host, services }: PluginScreenProps) {
  const { Screen, ListGroup, ListRow, Skeleton, Text, EmptyState, Button } = host.components;
  const t = host.useTheme();
  const courses = host.useToolData<CourseInfo[]>('courses.list', {}, { ttlMinutes: 24 * 60 });
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [list, setList] = useState<Video[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(
    async (c: CourseInfo) => {
      setList(null);
      setError(null);
      try {
        setList(await videos(services, c));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [services],
  );

  useEffect(() => {
    if (course) void load(course);
  }, [course, load]);

  const play = async (v: Video) => {
    setOpening(v.url);
    setError(null);
    try {
      await services.browser.open(await playbackUrl(services, v.url));
    } catch (e) {
      host.haptics.warning();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  };

  if (!course)
    return (
      <Screen title="课程回放" back>
        <View style={{ gap: t.spacing.lg }}>
          {courses.status === 'loading' ? (
            <View style={{ gap: t.spacing.sm }}>
              <Skeleton height={48} />
              <Skeleton height={48} />
            </View>
          ) : !courses.value?.length ? (
            <EmptyState icon="play" title={courses.error ? '读取失败' : '本学期没有课程'} message={courses.error} />
          ) : (
            <ListGroup title="选择课程">
              {courses.value.map((c) => (
                <ListRow key={c.id} icon="book" title={c.name} chevron onPress={() => setCourse(c)} />
              ))}
            </ListGroup>
          )}
        </View>
      </Screen>
    );

  return (
    <Screen title={course.name} subtitle="课程回放" back trailing={<Button title="换课程" size="sm" variant="ghost" onPress={() => setCourse(null)} />}>
      <View style={{ gap: t.spacing.lg }}>
        {error ? (
          <Text variant="callout" tone="down">
            {error}
          </Text>
        ) : null}
        {list == null && !error ? (
          <View style={{ gap: t.spacing.sm }}>
            <Skeleton height={48} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </View>
        ) : list && !list.length ? (
          <EmptyState icon="play" title="还没有回放" message="老师开启录播后，回放会出现在这里。" />
        ) : list ? (
          <ListGroup title={`${list.length} 个回放`} footer="点一下在浏览器里播放；链接只在本机生成，有效期较短。">
            {[...list].reverse().map((v) => (
              <ListRow key={v.url || v.title} icon={opening === v.url ? 'clock' : 'play'} title={v.title} subtitle={[v.time, v.teacher].filter(Boolean).join(' · ')} titleLines={2} onPress={v.url && !opening ? () => void play(v) : undefined} />
            ))}
          </ListGroup>
        ) : null}
      </View>
    </Screen>
  );
}
