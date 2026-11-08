import type { PhoneApp, PhoneReadiness, PhonePreview, PluginScreenProps } from '@pku-harness/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, View } from 'react-native';
import { strings } from './strings';
import { LatestPhoneRead } from './latest-read';

type CopilotStatus = PhoneReadiness & { enabled: boolean; configuredPackages: string[] };

export function CopilotScreen({ host, services, invoke, focused = true }: PluginScreenProps) {
  const { Screen, Text, Button, Field, Switch, ListGroup, ListRow, Icon, IconButton, Segmented, Skeleton } = host.components;
  const s = strings[host.useLocale()];
  const theme = host.useTheme();
  const [status, setStatus] = useState<CopilotStatus | null>(null);
  const [preview, setPreview] = useState<(PhonePreview & { sessionId: string }) | null>(null);
  const [apps, setApps] = useState<PhoneApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const savingConfiguration = useRef(false);
  const [query, setQuery] = useState('');
  const [appFilter, setAppFilter] = useState('all');
  const initialFilter = useRef(false);
  const [connectionExpanded, setConnectionExpanded] = useState<boolean | null>(null);
  const [connectionMode, setConnectionMode] = useState('reconnect');
  const [showPreview, setShowPreview] = useState(false);
  const [code, setCode] = useState('');
  const [port, setPort] = useState('');
  const [connectPort, setConnectPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reads] = useState(() => new LatestPhoneRead());
  const acceptStatus = useCallback((next: CopilotStatus) => {
    setStatus(next); setSelected(next.configuredPackages);
    if (!initialFilter.current) { setAppFilter(next.configuredPackages.length ? 'allowed' : 'all'); initialFilter.current = true; }
  }, []);
  const refresh = useCallback(async () => {
    const current = reads.begin();
    const next = await invoke('copilot.status') as CopilotStatus;
    if (current()) acceptStatus(next);
  }, [invoke, reads, acceptStatus]);
  useEffect(() => {
    let alive = true;
    void Promise.all([refresh(), services.phone.apps()]).then(([, a]) => {
      if (alive) { setApps(a); setAppsLoaded(true); }
    }).catch((e) => { if (alive) setError(String(e)); }).finally(() => { if (alive) setAppsLoading(false); });
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh().catch((e) => setError(String(e))); });
    return () => { alive = false; reads.invalidate(); sub.remove(); };
  }, [services, refresh, reads]);
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
  const iconSize = theme.spacing.xl;
  const ready = !!status?.helper && !!status?.accessibility;
  const connectionOpen = connectionExpanded ?? (!!status && !ready);
  const reload = () => run(async () => {
    setAppsLoading(true);
    try { setApps(await services.phone.apps()); setAppsLoaded(true); }
    finally { setAppsLoading(false); }
  });
  const helperStatus = status?.helper ? s.connected : status?.helperStatus === 'connecting' ? s.connecting : status?.helperStatus === 'wireless-off' ? s.wirelessOff : status?.helperStatus === 'failed' ? s.connectionFailed : s.setupNeeded;
  const helperFailure = status?.helperFailure;
  const setupHint = helperFailure === 'WrongCode' || helperFailure === 'PairingWindowClosed' ? s.pairingExpired
    : helperFailure === 'NoWifi' || helperFailure === 'WifiNotAllowed' ? s.wifiNeeded
    : helperFailure === 'AuthorizationRevoked' || helperFailure === 'KeyUnreadable' ? s.pairAgain
    : helperFailure === 'UsbHelperStopped' ? s.usbStopped
    : helperFailure ? s.retryConnection : null;
  return (
    <Screen title="Copilot" appearance="plain" back trailing={<IconButton icon="refresh" label={s.refresh} variant="ghost" disabled={busy || appsLoading} onPress={() => void reload()} />}>
      <View style={{ gap: theme.spacing.xl }}>
        {error ? <View style={{ gap: theme.spacing.sm }}><Text tone="down">{error}</Text><Button title={s.retry} variant="ghost" size="sm" disabled={busy} onPress={() => void reload()} /></View> : null}
        {!status ? <View style={{ gap: theme.spacing.sm, padding: theme.spacing.lg }}>
          <Skeleton width="65%" height={theme.spacing.lg} />
          <Skeleton width="90%" height={theme.spacing.md} />
        </View> : <>
          <ListGroup variant="plain">
            <ListRow compact title={s.enableCopilot} subtitle={status.enabled ? ready ? s.readyForTasks : s.connectionNeeded : s.off} accessory={
              <Switch label={s.enableCopilot} value={status.enabled} disabled={busy || (!status.enabled && (!ready || selected.length === 0 || missingPackages.length > 0))} onValueChange={(enabled) => void configure(enabled, selected)} />
            } />
          </ListGroup>
          <ListGroup variant="plain">
            <ListRow compact leading={<Icon name={ready ? 'check' : 'warning'} size={theme.spacing.lg} color={theme.colors.textMuted} />} title={s.connection} subtitle={ready ? s.connectionReady : s.connectionNeeded}
              chevron={false} onPress={() => setConnectionExpanded(!connectionOpen)} accessory={<Icon name={connectionOpen ? 'chevronDown' : 'chevronRight'} size={theme.spacing.lg} color={theme.colors.textMuted} />} />
            {connectionOpen ? <>
              <ListRow compact icon="phone" title={s.phoneHelper} subtitle={helperStatus} />
              <ListRow compact icon="shield" title={s.accessibility} subtitle={status.accessibility ? s.enabled : s.setupNeeded}
                onPress={!status.accessibility && !busy ? () => void run(() => services.phone.setup('accessibility')) : undefined} />
            </> : null}
          </ListGroup>
          {connectionOpen && !status.helper ? <View style={{ gap: theme.spacing.md }}>
            {setupHint ? <Text variant="callout" tone="down">{setupHint}</Text> : null}
            <Segmented variant="tabs" options={[{ label: s.reconnect, value: 'reconnect' }, { label: s.pairNew, value: 'pair' }]} value={connectionMode} onChange={setConnectionMode} />
            {connectionMode === 'pair' ? <>
              <Text variant="caption" tone="muted">{s.pairingGuide}</Text>
              <Button title={s.developerOptions} variant="secondary" size="sm" onPress={() => void run(() => services.phone.setup('wireless'))} disabled={busy} />
              <Field label={s.pairingPort} value={port} onChangeText={setPort} keyboardType="number-pad" />
              <Field label={s.pairingCode} value={code} onChangeText={setCode} keyboardType="number-pad" secureTextEntry />
              <Button title={s.pair} disabled={busy || !/^\d{6}$/.test(code) || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535} onPress={() => void run(async () => { await services.phone.pair(code, Number(port)); setCode(''); })} />
            </> : <>
              <Text variant="caption" tone="muted">{s.reconnectHint}</Text>
              <Field label={s.connectionPort} value={connectPort} onChangeText={setConnectPort} keyboardType="number-pad" />
              <Button title={s.reconnect} size="sm" disabled={busy || (connectPort !== '' && (!/^\d{1,5}$/.test(connectPort) || Number(connectPort) < 1 || Number(connectPort) > 65535))} onPress={() => void run(() => services.phone.connect(connectPort ? Number(connectPort) : undefined))} />
            </>}
          </View> : null}
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
        </View> : <View style={{ gap: theme.spacing.md }}>
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
          <ListGroup variant="plain">
            {appsLoading ? [0, 1, 2].map((row) => (
              <View key={row} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.lg }}>
                <Skeleton width={iconSize} height={iconSize} />
                <Skeleton width="55%" height={theme.spacing.lg} />
              </View>
            )) : visibleApps.length ? visibleApps.map((app) => (
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
            )) : <View style={{ padding: theme.spacing.lg }}><Text tone="muted">{query.trim() ? s.noMatchingApps : appFilter === 'allowed' ? s.noAllowedApps : s.noApps}</Text></View>}
          </ListGroup>
        </View>}
      </View>
    </Screen>
  );
}
