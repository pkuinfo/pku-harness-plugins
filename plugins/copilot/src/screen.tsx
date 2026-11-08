import type { PhoneApp, PhoneReadiness, PhonePreview, PluginScreenProps } from '@pku-harness/sdk';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Image, View } from 'react-native';
import { strings } from './strings';
import { LatestPhoneRead } from './latest-read';

export function CopilotScreen({ host, services, focused = true }: PluginScreenProps) {
  const { Screen, Text, Button, Field, Switch, ListGroup, ListRow } = host.components;
  const s = strings[host.useLocale()];
  const theme = host.useTheme();
  const [status, setStatus] = useState<PhoneReadiness | null>(null);
  const [preview, setPreview] = useState<(PhonePreview & { sessionId: string }) | null>(null);
  const [apps, setApps] = useState<PhoneApp[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [port, setPort] = useState('');
  const [connectPort, setConnectPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reads] = useState(() => new LatestPhoneRead());
  const refresh = useCallback(async () => {
    const current = reads.begin();
    const next = await services.phone.readiness();
    if (current()) setStatus(next);
  }, [services, reads]);
  useEffect(() => {
    let alive = true;
    void Promise.all([refresh(), services.phone.apps()]).then(([, a]) => {
      if (alive) setApps(a);
    }).catch((e) => { if (alive) setError(String(e)); });
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh().catch((e) => setError(String(e))); });
    return () => { alive = false; reads.invalidate(); sub.remove(); };
  }, [services, refresh, reads]);
  const run = async (action: () => Promise<unknown>) => {
    reads.invalidate(); setPreview(null); setBusy(true); setError(null);
    try { await action(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
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
          const current = await services.phone.readiness();
          const frame = sessionId && current.sessionId === sessionId && !current.handedOver ? await services.phone.preview(sessionId) : null;
          if (alive && isCurrent()) {
            setStatus(current);
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
  }, [sessionId, services, focused, busy, reads]);
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
        {sessionId ? <View style={{ gap: theme.spacing.md }}>
          <Text variant="body">{s.active}</Text>
          {focused && preview?.sessionId === sessionId && !status.handedOver ? <Image source={{ uri: preview.uri }} accessibilityLabel={s.preview} resizeMode="contain" fadeDuration={0} style={{ width: '100%', aspectRatio: preview.width / preview.height }} /> : <Text tone="muted">{status.handedOver ? s.userControl : s.waitingForApp}</Text>}
          <Button title={status.handedOver ? (s.handback) : (s.takeover)} disabled={busy} onPress={() => void run(() => status.handedOver ? services.phone.handback(sessionId) : services.phone.takeover(sessionId))} />
          <Button title={s.stop} disabled={busy} onPress={() => void run(() => services.phone.end(sessionId))} />
        </View> : <View style={{ gap: theme.spacing.md }}>
          <Text variant="callout" tone="muted">{s.selectedApps}: {selected.length} / 20</Text>
          <Button title={s.start} disabled={busy || !status?.helper || !status.accessibility || selected.length === 0 || selected.length > 20} onPress={() => void run(() => services.phone.begin(selected))} />
          <Field label={s.searchApps} placeholder={s.searchApps} value={query} onChangeText={setQuery} />
          <ListGroup title={s.allowedApps} footer={s.appScopeHint}>
            {apps.filter((a) => `${a.label} ${a.packageName}`.toLowerCase().includes(query.toLowerCase())).map((app) => (
              <ListRow key={app.packageName} title={app.label} subtitle={app.packageName} accessory={
                <Switch label={app.label} value={selected.includes(app.packageName)} disabled={busy || (selected.length >= 20 && !selected.includes(app.packageName))} onValueChange={(checked) => setSelected((old) => checked ? [...new Set([...old, app.packageName])].slice(0, 20) : old.filter((p) => p !== app.packageName))} />
              } />
            ))}
          </ListGroup>
        </View>}
        <Button title={s.refresh} disabled={busy} onPress={() => void run(refresh)} />
      </View>
    </Screen>
  );
}
