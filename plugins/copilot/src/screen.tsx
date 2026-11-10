import type { NotifyPermission, PhoneApp, PhoneReadiness, PhonePreview, PluginScreenProps } from '@pku-harness/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, StyleSheet, View } from 'react-native';
import { fill, strings } from './strings';
import { indexApps } from './app-index';
import { LatestPhoneRead } from './latest-read';
import { becameReady, canEnable, connectionMode, deriveSetup, helperHint, type CopilotSetup, type SetupStep as Step, type SetupStepId } from './setup';
import { SetupStep } from './setup-step';

/** Height of one letter in the A–Z strip. */
const INDEX_ROW = 18;

type CopilotStatus = PhoneReadiness & { enabled: boolean; configuredPackages: string[] };

export function CopilotScreen({ host, services, invoke, focused = true }: PluginScreenProps) {
  const { Screen, Text, Button, Field, Switch, ListGroup, ListRow, Icon, IconButton, Segmented, Skeleton, EmptyState, FadeIn, Surface } = host.components;
  const s = strings[host.useLocale()];
  const theme = host.useTheme();
  const [status, setStatus] = useState<CopilotStatus | null>(null);
  const [preview, setPreview] = useState<(PhonePreview & { sessionId: string }) | null>(null);
  const [apps, setApps] = useState<PhoneApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const savingConfiguration = useRef(false);
  const scrollRef = useRef<{ scrollTo: (options: { y?: number; animated?: boolean }) => void }>(null);
  const appPanelY = useRef(0);
  const listY = useRef(0);
  const sectionY = useRef<Record<string, number>>({});
  const [activeLetter, setActiveLetter] = useState('');
  const [scrubbing, setScrubbing] = useState(false);
  const scrubOrigin = useRef(0);
  const [query, setQuery] = useState('');
  const [appFilter, setAppFilter] = useState('all');
  const initialFilter = useRef(false);
  // Helper form: pair a never-paired phone, else reconnect; the user can switch.
  const [pickedMode, setPickedMode] = useState<string | null>(null);
  // The step the user opened, remembered against the current step so finishing a step opens the next.
  const [opened, setOpened] = useState<{ id: SetupStepId | null; at: SetupStepId | null } | null>(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotifyPermission | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const lastPhase = useRef<CopilotSetup['phase'] | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [code, setCode] = useState('');
  const [port, setPort] = useState('');
  const [connectPort, setConnectPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reads] = useState(() => new LatestPhoneRead());
  const acceptStatus = useCallback((next: CopilotStatus) => {
    setStatus(next); setSelected(next.configuredPackages);
    // Fixed from the first read, so a failed pairing attempt doesn't swap the form under the user.
    setPickedMode((mode) => mode ?? connectionMode(next));
    if (!initialFilter.current) { setAppFilter(next.configuredPackages.length ? 'allowed' : 'all'); initialFilter.current = true; }
  }, []);
  const refresh = useCallback(async () => {
    const current = reads.begin();
    const next = await invoke('copilot.status') as CopilotStatus;
    if (current()) acceptStatus(next);
  }, [invoke, reads, acceptStatus]);
  const refreshNotifications = useCallback(async () => {
    try { setNotifications((await services.notify.readiness()).notifications); } catch { /* stays unknown; it never blocks */ }
  }, [services]);
  useEffect(() => {
    let alive = true;
    void refreshNotifications();
    void Promise.all([refresh(), services.phone.apps()]).then(([, a]) => {
      if (alive) { setApps(a); setAppsLoaded(true); }
    }).catch((e) => { if (alive) setError(String(e)); }).finally(() => { if (alive) setAppsLoading(false); });
    // Back from a system screen: re-read every requirement at once.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { void refresh().catch((e) => setError(String(e))); void refreshNotifications(); }
    });
    return () => { alive = false; reads.invalidate(); sub.remove(); };
  }, [services, refresh, reads, refreshNotifications]);
  const run = async (action: () => Promise<unknown>) => {
    reads.invalidate(); setPreview(null); setBusy(true); setError(null);
    try { await action(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const configure = async (enabled: boolean, packages: string[]) => {
    if (savingConfiguration.current) return;
    savingConfiguration.current = true;
    try { await run(() => invoke('copilot.configure', { enabled, packages })); }
    finally { savingConfiguration.current = false; }
  };
  const sessionId = status?.sessionId;
  useEffect(() => {
    if (!focused || busy) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (AppState.currentState === 'active') {
        const isCurrent = reads.begin();
        try {
          const current = await invoke('copilot.status') as CopilotStatus;
          const frame = showPreview && sessionId && current.sessionId === sessionId && !current.handedOver ? await services.phone.preview(sessionId) : null;
          if (alive && isCurrent()) {
            acceptStatus(current);
            setPreview(frame && sessionId && AppState.currentState === 'active' ? { ...frame, sessionId } : null);
          }
        } catch {
          if (alive && isCurrent()) setPreview(null);
        }
      }
      if (alive) timer = setTimeout(() => void poll(), 1000);
    };
    const sub = AppState.addEventListener('change', (state) => { if (state !== 'active') setPreview(null); });
    void poll();
    return () => { alive = false; reads.invalidate(); clearTimeout(timer); sub.remove(); setPreview(null); };
  }, [sessionId, services, invoke, focused, busy, reads, showPreview, acceptStatus]);
  const missingPackages = appsLoaded ? selected.filter((name) => !apps.some((app) => app.packageName === name)) : [];
  const visibleApps = apps.filter((app) => (appFilter === 'all' || selected.includes(app.packageName)) && `${app.label} ${app.packageName}`.toLowerCase().includes(query.trim().toLowerCase()));
  const indexedApps = indexApps(visibleApps);
  const showIndex = appFilter === 'all' && !query.trim() && !appsLoading && !sessionId;
  const letters = indexedApps.map((g) => g.letter);
  const jumpToLetter = (letter: string, animated = true) => {
    const y = sectionY.current[letter];
    if (y === undefined) return;
    setActiveLetter(letter);
    scrollRef.current?.scrollTo({ y: theme.spacing.lg + appPanelY.current + listY.current + y, animated });
  };
  const scrubTo = (y: number) => {
    const letter = letters[Math.min(letters.length - 1, Math.max(0, Math.floor((y - theme.spacing.sm) / INDEX_ROW)))];
    if (!letter || letter === activeLetter) return;
    host.haptics.select();
    jumpToLetter(letter, false);
  };
  const iconSize = theme.spacing.xl;
  const reload = () => run(async () => {
    setAppsLoading(true);
    try { setApps(await services.phone.apps()); setAppsLoaded(true); }
    finally { setAppsLoading(false); }
  });
  const setup = status ? deriveSetup({ readiness: status, enabled: status.enabled, configuredPackages: selected, missingPackages: missingPackages.length, notifications }) : null;
  // The A–Z rail floats over the whole screen, so it only appears once the setup checklist is gone.
  const rail = showIndex && setup?.phase === 'ready' && letters.length > 1;
  const phase = setup?.phase ?? null;
  // "You're set": only when this screen watched setup finish, never on a plain visit.
  useEffect(() => {
    if (!phase) return;
    if (becameReady(lastPhase.current, phase)) { setCelebrate(true); host.haptics.success(); }
    lastPhase.current = phase;
  }, [phase, host]);
  const expandedStep = setup && opened && opened.at === setup.current ? opened.id : setup?.current ?? null;
  const toggleStep = (id: SetupStepId) => setOpened({ id: expandedStep === id ? null : id, at: setup?.current ?? null });
  const mode = pickedMode ?? 'reconnect';
  const hint = helperHint(status?.helperFailure);
  const enableAllowed = !!setup && canEnable(setup);
  const goToApps = () => {
    setAppFilter('all');
    scrollRef.current?.scrollTo({ y: theme.spacing.lg + appPanelY.current, animated: true });
  };
  const stepTitle: Record<SetupStepId, string> = { helper: s.helperTitle, accessibility: s.accessibilityTitle, notifications: s.notificationsTitle, apps: s.appsTitle, enable: s.enableTitle };
  const stepStatus = (step: Step): string => {
    if (step.state === 'working') return s.connecting;
    switch (step.id) {
      case 'helper': return step.state === 'done' ? s.connected : step.state === 'attention' ? s.connectionFailed : s.stepNeeded;
      case 'accessibility': return step.state === 'done' ? s.enabled : s.stepNeeded;
      case 'notifications': return step.state === 'done' ? s.allowed : s.stepRecommended;
      case 'apps': return step.state === 'attention' ? fill(s.appsMissing, { n: missingPackages.length }) : step.state === 'done' ? fill(s.appsCount, { n: selected.length }) : s.stepNeeded;
      case 'enable': return step.state === 'done' ? s.on : s.stepNeeded;
    }
  };
  const numbered = (items: string[]) => items.map((text, i) => (
    <View key={text} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
      <Text variant="callout" tone="muted">{`${i + 1}.`}</Text>
      <View style={{ flex: 1 }}><Text variant="callout">{text}</Text></View>
    </View>
  ));
  const stepBody = (step: Step) => {
    if (!status) return null;
    const why = (text: string) => <Text variant="callout" tone="muted">{text}</Text>;
    switch (step.id) {
      case 'helper':
        return <>
          {why(s.helperWhy)}
          {step.state !== 'done' ? <>
            {hint ? <Text variant="callout" tone="down">{s[hint]}</Text> : null}
            <Segmented variant="tabs" options={[{ label: s.pairNew, value: 'pair' }, { label: s.reconnect, value: 'reconnect' }]} value={mode} onChange={setPickedMode} />
            {mode === 'pair' ? <>
              {numbered([s.pairStep1, s.pairStep2, s.pairStep3])}
              <Button title={s.openWirelessDebugging} variant="secondary" size="sm" disabled={busy} onPress={() => void run(() => services.phone.setup('wireless'))} />
              <Text variant="caption" tone="muted">{s.noDeveloperOptions}</Text>
              <Field label={s.pairingPort} value={port} onChangeText={setPort} keyboardType="number-pad" />
              <Field label={s.pairingCode} value={code} onChangeText={setCode} keyboardType="number-pad" secureTextEntry />
              <Button title={s.pair} loading={busy} disabled={busy || !/^\d{6}$/.test(code) || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535} onPress={() => void run(async () => { await services.phone.pair(code, Number(port)); setCode(''); })} />
            </> : <>
              <Text variant="caption" tone="muted">{s.reconnectHint}</Text>
              <Field label={s.connectionPort} value={connectPort} onChangeText={setConnectPort} keyboardType="number-pad" />
              <Button title={s.reconnect} loading={busy} disabled={busy || (connectPort !== '' && (!/^\d{1,5}$/.test(connectPort) || Number(connectPort) < 1 || Number(connectPort) > 65535))} onPress={() => void run(() => services.phone.connect(connectPort ? Number(connectPort) : undefined))} />
            </>}
          </> : null}
        </>;
      case 'accessibility':
        return <>
          {why(s.accessibilityWhy)}
          {step.state !== 'done' ? <>
            <Text variant="caption" tone="muted">{status.helper ? s.accessibilityViaHelper : status.restricted ? s.restrictedHint : s.accessibilitySettingsHint}</Text>
            <Button title={status.helper ? s.turnOnAccessibility : s.openAccessibilitySettings} loading={busy} disabled={busy} onPress={() => void run(() => services.phone.setup('accessibility'))} />
            {!status.helper && status.restricted ? <Button title={s.openAppInfo} variant="secondary" size="sm" disabled={busy} onPress={() => void run(() => services.phone.setup('appInfo'))} /> : null}
          </> : null}
        </>;
      case 'notifications':
        return <>
          {why(s.notificationsWhy)}
          {step.state !== 'done' ? <>
            {notifications === 'denied' ? <Text variant="caption" tone="muted">{s.notificationsDenied}</Text> : null}
            <Button title={notifications === 'denied' ? s.openNotificationSettings : s.allowNotifications} variant="secondary" size="sm" disabled={busy}
              onPress={() => void run(async () => { setNotifications((await services.notify.fix('notifications')).notifications); })} />
          </> : null}
        </>;
      case 'apps':
        return <>
          {why(s.appsWhy)}
          {step.state === 'attention' ? <Text variant="callout" tone="warn">{s.unavailableHint}</Text> : null}
          {!sessionId ? <Button title={s.chooseApps} variant={step.state === 'done' ? 'secondary' : 'primary'} size="sm" onPress={goToApps} /> : null}
        </>;
      case 'enable':
        return <>
          {why(s.enableWhy)}
          {step.state !== 'done' ? <>
            {!enableAllowed ? <Text variant="caption" tone="muted">{s.enableBlocked}</Text> : null}
            <Button title={s.enableTitle} loading={busy} disabled={busy || !enableAllowed} onPress={() => void configure(true, selected)} />
          </> : null}
        </>;
    }
  };
  const checklist = setup ? (
    <View>
      {setup.steps.map((step, i) => (
        <SetupStep key={step.id} host={host} index={i + 1} total={setup.steps.length} title={step.required ? stepTitle[step.id] : `${stepTitle[step.id]} · ${s.optional}`}
          status={stepStatus(step)} state={step.state} current={setup.current === step.id} stepLabel={fill(s.stepOf, { n: i + 1, total: setup.steps.length })}
          expanded={expandedStep === step.id} onToggle={() => toggleStep(step.id)}>
          {stepBody(step)}
        </SetupStep>
      ))}
    </View>
  ) : null;
  return (
    <Screen title="Copilot" appearance="plain" scrollRef={scrollRef} overlay={rail ? (
      <View pointerEvents="box-none" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, justifyContent: 'center' }}>
        {scrubbing && activeLetter ? (
          <View pointerEvents="none" style={{ position: 'absolute', right: theme.spacing.xxl + theme.spacing.sm, alignSelf: 'center', width: theme.spacing.xxxl + theme.spacing.md, height: theme.spacing.xxxl + theme.spacing.md,
            borderRadius: theme.radius.lg, borderCurve: 'continuous', backgroundColor: theme.colors.elevated, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="title">{activeLetter}</Text>
          </View>
        ) : null}
        {/* Fast scroller: touch or drag along the strip to jump; children ignore touches so locationY is the strip's. */}
        <View accessibilityRole="adjustable" accessibilityLabel={s.jumpToLetter} accessibilityValue={{ text: activeLetter || letters[0] }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => { const i = Math.max(0, letters.indexOf(activeLetter)); jumpToLetter(letters[Math.min(letters.length - 1, Math.max(0, i + (e.nativeEvent.actionName === 'increment' ? 1 : -1)))]!); }}
          onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderTerminationRequest={() => false}
          onResponderGrant={(e) => { scrubOrigin.current = e.nativeEvent.pageY - e.nativeEvent.locationY; setScrubbing(true); scrubTo(e.nativeEvent.locationY); }}
          onResponderMove={(e) => scrubTo(e.nativeEvent.pageY - scrubOrigin.current)}
          onResponderRelease={() => setScrubbing(false)} onResponderTerminate={() => setScrubbing(false)}
          style={{ width: theme.spacing.xl + theme.spacing.xs, paddingVertical: theme.spacing.sm, marginRight: theme.spacing.xxs, borderRadius: theme.radius.full, backgroundColor: scrubbing ? theme.colors.surface2 : 'transparent' }}>
          {letters.map((letter) => (
            <View key={letter} pointerEvents="none" style={{ height: INDEX_ROW, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="micro" tone={activeLetter === letter ? 'accent' : 'muted'}>{letter}</Text>
            </View>
          ))}
        </View>
      </View>
    ) : null} back trailing={<IconButton icon="refresh" label={s.refresh} variant="ghost" disabled={busy || appsLoading} onPress={() => void reload()} />}>
      <View style={{ gap: theme.spacing.xl, paddingRight: rail ? theme.spacing.xl : 0 }}>
        {error ? <View style={{ gap: theme.spacing.sm }}><Text tone="down">{error}</Text><Button title={s.retry} variant="ghost" size="sm" disabled={busy} onPress={() => void reload()} /></View> : null}
        {!status || !setup ? <View style={{ gap: theme.spacing.sm, padding: theme.spacing.lg }}>
          <Skeleton width="65%" height={theme.spacing.lg} />
          <Skeleton width="90%" height={theme.spacing.md} />
        </View> : setup.phase === 'unsupported' ? <EmptyState icon="phone" title={s.unsupported} /> : <>
          {celebrate && setup.phase === 'ready' ? <FadeIn>
            <Surface level={1} padded>
              <View style={{ gap: theme.spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <View style={{ width: theme.spacing.xxl, height: theme.spacing.xxl, borderRadius: theme.radius.full, backgroundColor: theme.colors.upMuted, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={theme.spacing.lg} color={theme.colors.up} />
                  </View>
                  <View style={{ flex: 1 }}><Text variant="headline">{s.readyTitle}</Text></View>
                  <IconButton icon="close" label={s.close} variant="ghost" onPress={() => setCelebrate(false)} />
                </View>
                <Text variant="callout" tone="muted">{s.readyBody}</Text>
                <Button title={s.goToChat} icon="chat" onPress={() => host.navigate('/')} />
              </View>
            </Surface>
          </FadeIn> : null}
          {setup.phase === 'ready' || status.enabled ? <ListGroup variant="plain">
            <ListRow compact title={s.enableCopilot} subtitle={status.enabled ? setup.phase === 'ready' ? s.readyForTasks : s.connectionNeeded : s.off} accessory={
              <Switch label={s.enableCopilot} value={status.enabled} disabled={busy || (!status.enabled && !enableAllowed)} onValueChange={(enabled) => void configure(enabled, selected)} />
            } />
          </ListGroup> : null}
          {setup.phase === 'ready' ? <ListGroup variant="plain">
            <ListRow compact leading={<Icon name="shield" size={theme.spacing.lg} color={theme.colors.textMuted} />} title={s.permissions} subtitle={s.permissionsReady}
              chevron={false} onPress={() => setPermissionsOpen(!permissionsOpen)} accessory={<Icon name={permissionsOpen ? 'chevronDown' : 'chevronRight'} size={theme.spacing.lg} color={theme.colors.textMuted} />} />
            {permissionsOpen ? checklist : null}
          </ListGroup> : <View style={{ gap: theme.spacing.md }}>
            <View style={{ gap: theme.spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}>
                <View style={{ flex: 1 }}><Text variant="headline">{s.setupTitle}</Text></View>
                <Text variant="caption" tone="muted">{fill(s.setupProgress, { done: setup.done, total: setup.required })}</Text>
              </View>
              <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
                {Array.from({ length: setup.required }, (_, i) => (
                  <View key={i} style={{ flex: 1, height: theme.spacing.xs, borderRadius: theme.radius.full, backgroundColor: i < setup.done ? theme.colors.up : theme.colors.surface2 }} />
                ))}
              </View>
              <Text variant="callout" tone="muted">{s.setupIntro}</Text>
            </View>
            {checklist}
          </View>}
        </>}
        {sessionId ? <View style={{ gap: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}><Text variant="bodyStrong">{s.currentTask}</Text></View>
            <IconButton icon={showPreview ? 'eyeOff' : 'eye'} label={showPreview ? s.hidePreview : s.showPreview} variant="ghost" onPress={() => setShowPreview(!showPreview)} />
            <IconButton icon="stop" label={s.stop} variant="danger" disabled={busy} onPress={() => void run(() => services.phone.end(sessionId))} />
          </View>
          <Text variant="callout" tone="muted">{status.handedOver ? s.userControl : s.active}</Text>
          {showPreview ? focused && preview?.sessionId === sessionId && !status.handedOver ? <Image source={{ uri: preview.uri }} accessibilityLabel={s.preview} resizeMode="contain" fadeDuration={0} style={{ width: '100%', height: theme.spacing.xxxl * 4 }} /> : <Text variant="caption" tone="muted">{status.handedOver ? s.userControl : s.waitingForApp}</Text> : null}
          <Button title={status.handedOver ? s.handback : s.takeover} variant="secondary" size="sm" disabled={busy} onPress={() => void run(() => status.handedOver ? services.phone.handback(sessionId) : services.phone.takeover(sessionId))} />
        </View> : <View onLayout={(e) => { appPanelY.current = e.nativeEvent.layout.y; }} style={{ gap: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}><Text variant="bodyStrong">{s.appAccess}</Text></View>
            <Text variant="caption" tone="muted">{selected.length} / 20</Text>
          </View>
          {missingPackages.length ? <View style={{ gap: theme.spacing.md }}>
            <ListGroup variant="plain" title={s.unavailableApps} footer={s.unavailableHint}>
              {missingPackages.map((name) => <ListRow compact key={name} title={name} titleLines={2} />)}
            </ListGroup>
            <Button title={s.removeUnavailable} variant="secondary" disabled={busy} onPress={() => {
              const packages = selected.filter((name) => !missingPackages.includes(name));
              void configure(status?.enabled === true && packages.length > 0, packages);
            }} />
          </View> : null}
          <Text variant="caption" tone="muted">{s.appScopeHint}</Text>
          <Segmented variant="tabs" options={[{ label: s.allApps, value: 'all' }, { label: `${s.allowedApps} (${selected.length})`, value: 'allowed' }]} value={appFilter} onChange={setAppFilter} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}><Field placeholder={s.searchApps} value={query} onChangeText={setQuery} autoCapitalize="none" /></View>
            {query ? <IconButton icon="close" label={s.clearSearch} variant="ghost" onPress={() => setQuery('')} /> : null}
          </View>
          <View onLayout={(e) => { listY.current = e.nativeEvent.layout.y; }}>
            {appsLoading ? [0, 1, 2].map((row) => <View key={row} style={{ padding: theme.spacing.lg }}><Skeleton width="65%" height={theme.spacing.xl} /></View>)
              : visibleApps.length ? (showIndex ? indexedApps : [{ letter: '', apps: visibleApps }]).map((group) => (
              <View key={group.letter} onLayout={(e) => { sectionY.current[group.letter] = e.nativeEvent.layout.y; }}>
                {group.letter ? <View style={{ paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xs }}><Text variant="caption" tone="muted">{group.letter}</Text></View> : null}
                <ListGroup variant="plain">{group.apps.map((app) => (
              <ListRow compact
                key={app.packageName}
                title={app.label}
                titleLines={2}
                subtitle={app.launchable === false ? s.companionApp : apps.some((other) => other.packageName !== app.packageName && other.label === app.label) ? app.packageName : undefined}
                leading={
                  <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: iconSize, height: iconSize, alignItems: 'center', justifyContent: 'center' }}>
                    {app.iconUri ? <Image source={{ uri: app.iconUri }} accessible={false} style={{ width: iconSize, height: iconSize }} resizeMode="contain" /> : <Icon name="dashboard" size={theme.spacing.xxl} color={theme.colors.textMuted} />}
                  </View>
                }
                accessory={
                  <Switch label={app.label} value={selected.includes(app.packageName)} disabled={busy || !status || (selected.length >= 20 && !selected.includes(app.packageName))} onValueChange={(checked) => {
                    const packages = checked ? [...new Set([...selected, app.packageName])].slice(0, 20) : selected.filter((name) => name !== app.packageName);
                    void configure(status?.enabled === true && packages.length > 0, packages);
                  }} />
                }
              />
                ))}</ListGroup>
              </View>
            )) : <View style={{ padding: theme.spacing.lg }}><Text tone="muted">{query.trim() ? s.noMatchingApps : appFilter === 'allowed' ? s.noAllowedApps : s.noApps}</Text></View>}
          </View>
        </View>}
      </View>
    </Screen>
  );
}
