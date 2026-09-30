# NorthStar Control Room desktop app

Version 1.0.3 opens https://ops.northstarenergy.ca/northstar-clean.html directly in a sandboxed Electron window. It uses the website authentication, backend, records and releases. Internet access is required; connection failures show a retry link.

The app no longer starts or bundles a local Python server or exposes the local setup bridge. Existing local data and runtime folders remain untouched and are not merged into the website database.

Run `pnpm desktop:dev` to launch from source. Run `pnpm desktop:package` to create the installer in outputs/desktop-live-1.0.3/installer. Install version 1.0.3 to add the Teams pane. Website updates then use the same release-check mechanism as a browser. Desktop shell updates still require an installer until a signed release feed is configured.

Select the dashboard's Teams launcher or **Teams > Open Teams beside dashboard** (`Ctrl+Shift+T`). Sign in to Microsoft in the pane. **Teams > Expand Teams** gives Teams the full window; **Hide Teams** (`Ctrl+Shift+H`) restores the dashboard. Hiding preserves the Teams session. **Reload Teams** retries a failed connection. The menu also offers **Open Teams in browser** for organizations whose sign-in policy requires a supported browser. Normal Microsoft sign-in popups are supported; custom federation hosts and authenticated chat/calls require testing with the organization's account.

Teams uses its own persistent browser session inside a native Electron view. There is no iframe, Graph permission grant, bridge activation, or automatic message sending. The ordinary browser dashboard continues to open Teams externally because Teams blocks third-party framing. Context isolation and sandboxing remain enabled, with Node integration disabled and no preload bridge. Same-origin dashboard links stay in the app; ordinary external links open in the default browser. Teams camera/microphone and notification requests show a native permission prompt. Website access controls remain authoritative.
