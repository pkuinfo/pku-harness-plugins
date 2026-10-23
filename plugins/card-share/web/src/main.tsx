import { render } from "preact";
import { config } from "zod";

import { App } from "./App";
import { applySavedMode } from "./theme";
import "./styles.css";

// The relay's CSP forbids eval: skip zod's JIT probe (it would only log a CSP violation).
config({ jitless: true });
applySavedMode();
render(<App />, document.getElementById("app")!);
