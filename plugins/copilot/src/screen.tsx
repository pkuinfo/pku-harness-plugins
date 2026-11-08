import type { PhoneApp, PhoneReadiness, PhonePreview, PluginScreenProps } from '@pku-harness/sdk';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Image, View } from 'react-native';
import { strings } from './strings';

export function CopilotScreen({ host, services, focused = true }: PluginScreenProps) {
  const { Screen, Text, Button, Field, Checkbox, Row, ListGroup, ListRow } = host.components;
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
  const refresh = useCallback(async () => setStatus(await services.phone.readiness()), [services]);
  useEffect(() => {
    let alive = true;
    void Promise.all([services.phone.readiness(), services.phone.apps()]).then(([s, a]) => {
      if (alive) { setStatus(s); setApps(a); }
    }).catch((e) => { if (alive) setError(String(e)); });
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh().catch((e) => setError(String(e))); });
    return () => { alive = false; sub.remove(); };
  }, [services, refresh]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const sessionId = status?.sessionId;
  useEffect(() => {
    if (!focused) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (AppState.currentState === 'active') {
        try {
          const current = await services.phone.readiness();
          const frame = sessionId && current.sessionId === sessionId && !current.handedOver ? await services.phone.preview(sessionId) : null;
          if (alive) {
            setStatus(current);
            setPreview(frame && sessionId && AppState.currentState === 'active' ? { ...frame, sessionId } : null);
          }
        } catch {
          if (alive) setPreview(null);
        }
      }
      if (alive) timer = setTimeout(() => void poll(), 1000);
    };
    const sub = AppState.addEventListener('change', (state) => { if (state !== 'active') setPreview(null); });
    void poll();
    return () => { alive = false; clearTimeout(timer); sub.remove(); setPreview(null); };
  }, [sessionId, services, focused]);
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
          <Field label={s.allowedApps} placeholder={s.searchApps} value={query} onChangeText={setQuery} />
          {apps.filter((a) => `${a.label} ${a.packageName}`.toLowerCase().includes(query.toLowerCase())).map((app) => (
            <Row key={app.packageName} gap="md" align="center">
              <Checkbox label={app.label} value={selected.includes(app.packageName)} onValueChange={(checked) => setSelected((old) => checked ? [...old, app.packageName] : old.filter((p) => p !== app.packageName))} />
              <View style={{ flex: 1 }}>
                <Text>{app.label}</Text>
                <Text variant="caption" tone="muted">{app.packageName}</Text>
              </View>
            </Row>
          ))}
          <Button title={s.start} disabled={busy || !status?.helper || !status.accessibility || selected.length === 0 || selected.length > 20} onPress={() => void run(() => services.phone.begin(selected))} />
        </View>}
        <Button title={s.refresh} disabled={busy} onPress={() => void run(refresh)} />
      </View>
    </Screen>
  );
}
