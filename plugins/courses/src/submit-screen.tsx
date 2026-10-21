import { formatLocalDateTime, type PickedFile, type PluginScreenProps } from '@pku-harness/sdk';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { SubmitReceipt } from './api';
import { strings } from './strings';
import { CONFIRM_KEY, CONFIRM_TTL_MS, confirmationPayload, DRAFT_KEY, fileSize, MAX_FILE_BYTES, MAX_FILES, type Confirmation, type SubmitDraft } from './submit';

type Target = { courseId: string; contentId: string; title?: string; course?: string };
type Detail = { title: string; due: string | null; deadline: number | null; submitted: boolean; attempt: string | null; status: string | null };
type Item = { title: string; course: string; courseId: string; contentId: string; deadline: number | null; due: string | null; submitted: boolean };

/**
 * 交作业: choose the assignment, pick files and/or write text, review exactly what will be sent,
 * then confirm. The confirm tap mints a one-time token over that exact content; the
 * `courses.submitAssignment` tool refuses anything else, so neither the agent nor a stale screen
 * can submit without this review.
 */
export function SubmitScreen(props: PluginScreenProps) {
  const { host, params, kv } = props;
  const [target, setTarget] = useState<Target | null>(params.courseId && params.contentId ? { courseId: params.courseId, contentId: params.contentId } : null);
  const [draft, setDraft] = useState<SubmitDraft | null>(null);
  const [loaded, setLoaded] = useState(!!target);
  const s = strings[host.useLocale()];

  useEffect(() => {
    if (target) return;
    void kv.get<SubmitDraft>(DRAFT_KEY).then((d) => {
      // A draft the agent prepared in the last day opens directly.
      if (d && Date.now() - d.savedAt < 24 * 3600_000) {
        setDraft(d);
        setTarget({ courseId: d.courseId, contentId: d.contentId, title: d.title });
      }
      setLoaded(true);
    });
  }, [kv, target]);

  if (!loaded) return <host.components.SheetScreen title={s.submitTitle} primary={s.next} onPrimary={() => {}} primaryDisabled loading>{null}</host.components.SheetScreen>;
  if (!target) return <Chooser {...props} onPick={setTarget} />;
  return <Compose {...props} target={target} draft={draft?.courseId === target.courseId && draft.contentId === target.contentId ? draft : null} onChange={() => setTarget(null)} />;
}

function Chooser({ host, onPick }: PluginScreenProps & { onPick: (t: Target) => void }) {
  const { SheetScreen, ListGroup, ListRow, Skeleton, Text, EmptyState } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const data = host.useToolData<Item[]>('courses.assignments', {}, { ttlMinutes: 120 });
  const open = (data.value ?? []).filter((a) => !a.submitted);
  return (
    <SheetScreen title={s.submitTitle} primary={s.refresh} onPrimary={() => void data.refresh()} loading={data.fetching}>
      <View style={{ gap: t.spacing.lg }}>
        {data.status === 'loading' ? (
          <View style={{ gap: t.spacing.sm }}>
            <Skeleton height={48} />
            <Skeleton height={48} />
          </View>
        ) : !open.length ? (
          <EmptyState icon="check" title={data.error ? s.loadFailed : s.nothingDue} message={data.error ?? s.allSubmitted} />
        ) : (
          <ListGroup title={s.pickAssignment} footer={s.pickFooter}>
            {open.map((a) => (
              <ListRow key={`${a.courseId}:${a.contentId}`} icon="file" title={a.title} subtitle={`${a.course}${a.due ? ` · ${s.due(a.due)}` : ''}`} chevron onPress={() => onPick({ courseId: a.courseId, contentId: a.contentId, title: a.title, course: a.course })} />
            ))}
          </ListGroup>
        )}
        {data.error && open.length ? (
          <Text variant="caption" tone="warn">
            {data.error}
          </Text>
        ) : null}
      </View>
    </SheetScreen>
  );
}

function Compose({ host, services, kv, invoke, target, draft, onChange }: PluginScreenProps & { target: Target; draft: SubmitDraft | null; onChange: () => void }) {
  const { SheetScreen, Text, Field, Button, ListGroup, ListRow, Surface, Chip, IconButton, Skeleton } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [text, setText] = useState(draft?.text ?? '');
  const [comment, setComment] = useState(draft?.comment ?? '');
  const [stage, setStage] = useState<'compose' | 'review' | 'done'>('compose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SubmitReceipt | null>(null);

  useEffect(() => {
    let live = true;
    invoke('courses.assignment', { courseId: target.courseId, contentId: target.contentId })
      .then((d) => live && setDetail(d as Detail))
      .catch((e: unknown) => live && setDetailError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [invoke, target.courseId, target.contentId]);

  const title = detail?.title || target.title || s.assignment;
  const closed = detail?.deadline != null && detail.deadline < Date.now();
  const tooBig = files.find((f) => f.size != null && f.size > MAX_FILE_BYTES);
  const canReview = (files.length > 0 || text.trim().length > 0) && !tooBig;

  const addFiles = async () => {
    setError(null);
    try {
      const picked = await services.files.pick({ multiple: MAX_FILES > 1 });
      if (picked.length) setFiles((cur) => [...cur, ...picked].slice(-MAX_FILES));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const input = { courseId: target.courseId, contentId: target.contentId, text, comment, files: files.map(({ name, mime, uri, size }) => ({ name, mime, uri, size })) };
      const digest = await services.crypto.sha256(confirmationPayload(input));
      const token = await services.crypto.sha256(`${Math.random()}:${Date.now()}:${Math.random()}:${digest}`);
      const confirmation: Confirmation = { token, digest, exp: Date.now() + CONFIRM_TTL_MS };
      await kv.set(CONFIRM_KEY, confirmation);
      const r = (await invoke('courses.submitAssignment', { ...input, confirmToken: token })) as SubmitReceipt & { submitted: boolean };
      if (!r.submitted) throw new Error(s.notSubmitted);
      host.haptics.success();
      setReceipt(r);
      setStage('done');
    } catch (e) {
      host.haptics.warning();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'done' && receipt)
    return (
      <SheetScreen title={s.submittedTitle} primary={s.done} onPrimary={() => host.dismiss('/')}>
        <View style={{ gap: t.spacing.lg }}>
          <Surface padded>
            <View style={{ gap: t.spacing.sm }}>
              <Chip label={receipt.verified ? s.recorded : s.sentPending} tone={receipt.verified ? 'up' : 'warn'} icon={receipt.verified ? 'check' : 'clock'} />
              <Text variant="headline">{title}</Text>
              {receipt.attempt ? <Text tone="muted">{receipt.attempt}</Text> : null}
              {receipt.message ? <Text variant="callout">{receipt.message}</Text> : null}
              <Text variant="caption" tone="muted">
                {[receipt.files.length ? s.receiptFiles(receipt.files) : '', receipt.textLength ? s.receiptText(receipt.textLength) : ''].filter(Boolean).join(' · ')}
              </Text>
              <Text variant="caption" tone="faint">
                {s.submittedAt(formatLocalDateTime(new Date(receipt.at), locale))}
              </Text>
            </View>
          </Surface>
          {!receipt.verified ? (
            <Text variant="caption" tone="warn">
              {s.notRecordedYet}
            </Text>
          ) : null}
        </View>
      </SheetScreen>
    );

  if (stage === 'review')
    return (
      <SheetScreen title={s.reviewTitle} primary={s.confirm} onPrimary={() => void submit()} loading={busy} secondary={s.back} onSecondary={() => setStage('compose')}>
        <View style={{ gap: t.spacing.lg }}>
          <ListGroup title={s.assignment}>
            <ListRow icon="book" title={title} subtitle={[target.course, detail?.due ? s.due(detail.due) : null].filter(Boolean).join(' · ') || undefined} titleLines={2} />
          </ListGroup>
          {files.length ? (
            <ListGroup title={s.filesCount(files.length)}>
              {files.map((f) => (
                <ListRow key={f.uri} icon="file" title={f.name} subtitle={[f.mime, fileSize(f.size)].filter(Boolean).join(' · ')} titleLines={2} />
              ))}
            </ListGroup>
          ) : null}
          {text.trim() ? (
            <Surface padded>
              <View style={{ gap: t.spacing.xs }}>
                <Text variant="caption" tone="muted">
                  {s.text}
                </Text>
                <Text selectable>{text.trim()}</Text>
              </View>
            </Surface>
          ) : null}
          {comment.trim() ? (
            <Surface padded>
              <View style={{ gap: t.spacing.xs }}>
                <Text variant="caption" tone="muted">
                  {s.comment}
                </Text>
                <Text selectable>{comment.trim()}</Text>
              </View>
            </Surface>
          ) : null}
          <Text variant="callout" tone="warn">
            {s.finalWarning}
          </Text>
          {error ? (
            <Text variant="callout" tone="down">
              {error}
            </Text>
          ) : null}
        </View>
      </SheetScreen>
    );

  return (
    <SheetScreen title={s.submitTitle} primary={s.nextReview} onPrimary={() => setStage('review')} primaryDisabled={!canReview}>
      <View style={{ gap: t.spacing.lg }}>
        <Surface padded>
          <View style={{ gap: t.spacing.xs }}>
            {detail || detailError ? <Text variant="headline">{title}</Text> : <Skeleton width="70%" height={20} />}
            <Text variant="caption" tone={closed ? 'down' : 'muted'}>
              {detailError
                ? detailError
                : detail
                  ? [target.course, detail.due ? `${s.due(detail.due)}${closed ? s.closedSuffix : ''}` : s.noDueDate, detail.attempt ? s.attempted(detail.attempt) : null].filter(Boolean).join(' · ')
                  : s.loadingDetail}
            </Text>
            <Button title={s.changeAssignment} size="sm" variant="ghost" icon="repeat" onPress={onChange} style={{ alignSelf: 'flex-start' }} />
          </View>
        </Surface>

        <ListGroup title={s.files} footer={s.filesFooter(MAX_FILES)}>
          {files.map((f) => (
            <ListRow
              key={f.uri}
              icon="file"
              title={f.name}
              subtitle={[fileSize(f.size), f.size != null && f.size > MAX_FILE_BYTES ? s.tooBig : null].filter(Boolean).join(' · ')}
              accessory={<IconButton icon="close" label={s.removeFile(f.name)} variant="ghost" onPress={() => setFiles((cur) => cur.filter((x) => x.uri !== f.uri))} />}
            />
          ))}
          <ListRow icon="plus" title={files.length >= MAX_FILES ? s.replaceFile : s.chooseFile} onPress={() => void addFiles()} chevron />
        </ListGroup>

        <Field label={s.textOptional} value={text} onChangeText={setText} placeholder={s.textPlaceholder} multiline />
        <Field label={s.commentOptional} value={comment} onChangeText={setComment} placeholder={s.commentPlaceholder} multiline />
        {draft ? (
          <Text variant="caption" tone="muted">
            {s.draftFilled}
          </Text>
        ) : null}
        {error ? (
          <Text variant="callout" tone="down">
            {error}
          </Text>
        ) : null}
      </View>
    </SheetScreen>
  );
}
