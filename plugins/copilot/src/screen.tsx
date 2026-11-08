import type { PhoneApp, PhoneReadiness, PhonePreview, PluginScreenProps } from '@pku-harness/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, View } from 'react-native';
import { strings } from './strings';
import { LatestPhoneRead } from './latest-read';

type CopilotStatus = PhoneReadiness & { enabled: boolean; configuredPackages: string[] };

export function CopilotScreen({ host, services, invoke, focused = true }: PluginScreenProps) {
  const { Screen, Text, Button, Field, Switch, ListGroup, ListRow, Icon, Skeleton } = host.components;
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
  const [code, setCode] = useState('');
  const [port, setPort] = useState('');
  const [connectPort, setConnectPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reads] = useState(() => new LatestPhoneRead());
  const refresh = useCallback(async () => {
    const current = reads.begin();
    const next = await invoke('copilot.status') as CopilotStatus;
    if (current()) { setStatus(next); setSelected(next.configuredPackages); }
  }, [invoke, reads]);
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
          const frame = sessionId && current.sessionId === sessionId && !current.handedOver ? await services.phone.preview(sessionId) : null;
          if (alive && isCurrent()) {
            setStatus(current);
            setSelected(current.configuredPackages);
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
  }, [sessionId, services, invoke, focused, busy, reads]);
  const missingPackages = appsLoaded ? selected.filter((name) => !apps.some((app) => app.packageName === name)) : [];
  const visibleApps = apps.filter((app) => `${app.label} ${app.packageName}`.toLowerCase().includes(query.trim().toLowerCase()));
  const iconSize = theme.spacing.xxxl;
  const helperStatus = status?.helper ? s.connected : status?.helperStatus === 'connecting' ? s.connecting : status?.helperStatus === 'wireless-off' ? s.wirelessOff : status?.helperStatus === 'failed' ? s.connectionFailed : s.setupNeeded;
  const helperFailure = status?.helperFailure;
  const setupHint = helperFailure === 'WrongCode' || helperFailure === 'PairingWindowClosed' ? s.pairingExpired
    : helperFailure === 'NoWifi' || helperFailure === 'WifiNotAllowed' ? s.wifiNeeded
    : helperFailure === 'AuthorizationRevoked' || helperFailure === 'KeyUnreadable' ? s.pairAgain
    : helperFailure === 'UsbHelperStopped' ? s.usbStopped
    : helperFailure ? s.retryConnection : null;
  return (
    <Screen title="Copilot" back>
      <View style={{ gap: theme.spacing.xl }}>
        <Text variant="body" tone="muted">{s.intro}</Text>
        {error ? <Text tone="down">{error}</Text> : null}
        <ListGroup>
          <ListRow title={s.phoneHelper} value={helperStatus} />
          <ListRow title={s.accessibility} value={status?.accessibility ? (s.enabled) : (s.setupNeeded)} />
        </ListGroup>
        {!status?.helper ? <View style={{ gap: theme.spacing.md }}>
          {setupHint ? <Text variant="callout" tone="down">{setupHint}</Text> : null}
          <Text variant="callout">{s.pairingGuide}</Text>
          <Button title={s.developerOptions} onPress={() => void run(() => services.phone.setup('wireless'))} disabled={busy} />
          <Field label={s.pairingPort} value={port} onChangeText={setPort} keyboardType="number-pad" />
          <Field label={s.pairingCode} value={code} onChangeText={setCode} keyboardType="number-pad" secureTextEntry />
          <Button title={s.pair} disabled={busy || !/^\d{6}$/.test(code) || !/^\d{1,5}$/.test(port)} onPress={() => void run(async () => { await services.phone.pair(code, Number(port)); setCode(''); })} />
          <Field label={s.connectionPort} value={connectPort} onChangeText={setConnectPort} keyboardType="number-pad" />
          <Button title={s.reconnect} disabled={busy || (connectPort !== '' && (!/^\d{1,5}$/.test(connectPort) || Number(connectPort) < 1 || Number(connectPort) > 65535))} onPress={() => void run(() => services.phone.connect(connectPort ? Number(connectPort) : undefined))} />
        </View> : null}
        {!status?.accessibility ? <Button title={s.enableAccessibility} disabled={busy} onPress={() => void run(() => services.phone.setup('accessibility'))} /> : null}
        <ListGroup footer={status?.enabled ? s.enabledHint : s.enableHint}>
          <ListRow title={s.enableCopilot} accessory={
            <Switch label={s.enableCopilot} value={status?.enabled === true} disabled={busy || !status || (!status.enabled && (!status.helper || !status.accessibility || selected.length === 0 || missingPackages.length > 0))} onValueChange={(enabled) => void configure(enabled, selected)} />
          } />
        </ListGroup>
        {sessionId ? <View style={{ gap: theme.spacing.md }}>
          <Text variant="body">{s.active}</Text>
          {focused && preview?.sessionId === sessionId && !status.handedOver ? <Image source={{ uri: preview.uri }} accessibilityLabel={s.preview} resizeMode="contain" fadeDuration={0} style={{ width: '100%', aspectRatio: preview.width / preview.height }} /> : <Text tone="muted">{status.handedOver ? s.userControl : s.waitingForApp}</Text>}
          <Button title={status.handedOver ? (s.handback) : (s.takeover)} disabled={busy} onPress={() => void run(() => status.handedOver ? services.phone.handback(sessionId) : services.phone.takeover(sessionId))} />
          <Button title={s.stop} disabled={busy} onPress={() => void run(() => services.phone.end(sessionId))} />
        </View> : <View style={{ gap: theme.spacing.md }}>
          <Text variant="callout" tone="muted">{s.selectedApps}: {selected.length} / 20</Text>
          {missingPackages.length ? <View style={{ gap: theme.spacing.md }}>
            <ListGroup title={s.unavailableApps} footer={s.unavailableHint}>
              {missingPackages.map((name) => <ListRow key={name} title={name} titleLines={2} />)}
            </ListGroup>
            <Button title={s.removeUnavailable} variant="secondary" disabled={busy} onPress={() => {
              const packages = selected.filter((name) => !missingPackages.includes(name));
              void configure(status?.enabled === true && packages.length > 0, packages);
            }} />
          </View> : null}
          <Field label={s.searchApps} placeholder={s.searchApps} value={query} onChangeText={setQuery} autoCapitalize="none" />
          <ListGroup title={s.allowedApps} footer={s.appScopeHint}>
            {appsLoading ? [0, 1, 2].map((row) => (
              <View key={row} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.lg }}>
                <Skeleton width={iconSize} height={iconSize} />
                <Skeleton width="55%" height={theme.spacing.lg} />
              </View>
            )) : visibleApps.length ? visibleApps.map((app) => (
              <ListRow
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
            )) : <View style={{ padding: theme.spacing.lg }}><Text tone="muted">{query.trim() ? s.noMatchingApps : s.noApps}</Text></View>}
          </ListGroup>
        </View>}
        <Button title={s.refresh} disabled={busy} onPress={() => void run(refresh)} />
      </View>
    </Screen>
  );
}
