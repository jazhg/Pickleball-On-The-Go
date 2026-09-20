# Pickleball On The Go — Milestone 1 + Nemotron

**Nemotron does real work here — not chatbot work.** Two NVIDIA Nemotron models are wired
into the live game loop: Nemotron 3 Nano classifies every swing (shot, target zone,
confidence) from phone IMU data, and a Nemotron referee adjudicates every rally from the
authoritative rally log, citing rulebook rules. Both run async and can never block or
corrupt the 120 Hz simulation; when the model is unavailable the game degrades to
honest, labeled fallbacks (heuristic classifier, provisional state-machine referee).

Run the game:

```sh
npm install
NEMOTRON_LIVE=1 NVIDIA_API_KEY=... npm start   # live models
npm start                                       # offline-safe default
```

## Evidence (honest labels)

- **All numbers below are OFFLINE unless a live run says otherwise.** Do not claim
  live-model results until `python3 nemotron/eval.py --live` has actually run.
- Referee: provisional state machine agrees with its own authored fixtures 50/50 —
  a regression check, not independent evaluation. The 50 fixtures are synthetic and
  **0 have been human-reviewed**; `nemotron/REVIEW_NOTES.md` is a non-authoritative
  AI pre-review only.
- Classifier: heuristic baseline 43/50 (86%) on synthetic swings; known drop→dink
  confusion (low acceleration + low wrist overlap). 0/100 required human swings captured.
- `nemotron/rules.json` now holds verbatim 2026 USA Pickleball Official Rulebook text,
  but `reviewed_by` is EMPTY — two humans must still verify it before any citation
  is trustworthy. The referee adapter refuses placeholder/unreviewed config.
- In-game rulings before that review are labeled **provisional** in the HUD.

See `server/INTEGRATION_NOTES.md` for architecture, timeouts, and guardrails, and
`DEMO_SCRIPT.md` for the 90-second SteelHacks demo.

---

# Pickleball On The Go — Milestone 1

The relay owns the ball simulation. The laptop renders the relay’s state, and the phone sends the fixed section-3 `swing` message. The fastest way to check the connection is the phone page’s **Send test swing** button; it does not need motion permission and should launch the ball on the laptop.

## First run on one laptop

From this folder:

```sh
npm install
npm run dev:http
```

Open [http://localhost:8443/client-laptop/](http://localhost:8443/client-laptop/) and press Space. This is keyboard-only localhost mode. It is useful for verifying the game and does not make the server reachable from a phone.

## Connect an iPhone on the same Wi-Fi

The phone must use HTTPS. Do this once on the laptop in Terminal:

```sh
brew install mkcert       # skip if already installed
mkcert -install           # macOS asks for your login password
npm run certs             # includes every current LAN address in the certificate
npm start
```

`npm start` prints the exact URL using this laptop’s current address, for example:

```text
https://192.168.1.25:8443/client-phone/
```

If you use a QR code, encode that exact HTTPS LAN URL. Do not encode the link from a laptop page opened at `http://localhost:8443`; a phone resolves `localhost` to itself, so it cannot reach the laptop. The current build has a phone link but does not create a QR code automatically.

If your Wi-Fi address changes, run `npm run certs` again before starting the server.

On the iPhone, install the public CA before opening that URL:

1. Run `mkcert -CAROOT` on the laptop and transfer **rootCA.pem** to the phone with AirDrop or a cable. Transfer only `rootCA.pem`; never transfer `rootCA-key.pem`.
2. Open the certificate on the phone and install the downloaded profile in Settings → General → VPN & Device Management (wording varies by iOS version).
3. Enable it in Settings → General → About → Certificate Trust Settings → **Enable Full Trust**.
4. In Safari, open the printed `https://<LAN-IP>:8443/client-phone/` URL. Both devices must be on the same non-isolated Wi-Fi network.

The phone page should show **Connected to the laptop**. Tap **Send test swing** first. Then tap **Enable motion access**, hold the phone still for a second, and swing. The phone page shows the live `peak_g`, pitch, roll, and detector state. The laptop page shows the ball launch.

## What the common failures mean

| Symptom | Fix |
| --- | --- |
| Phone cannot open the page | Do not use `localhost` on the phone. Use the LAN URL printed by `npm start`; check both devices are on the same Wi-Fi and macOS Firewall allows Node. |
| “Connection is not private” | Install `rootCA.pem` and enable full trust on the iPhone. On the laptop, run `mkcert -install`. |
| Page opens but says “Waiting for the laptop” | The laptop is probably running `npm run dev:http` (localhost-only HTTP), or the phone and laptop URLs use different ports. Stop it and run `npm start`. |
| Page says “HTTPS required” | Reopen the `https://` URL. iOS motion permission is not available on a LAN `http://` page. |
| Connected, but motion stays “NO DATA” | Tap **Enable motion access** in Safari, keep the page foregrounded, check iOS Settings → Safari → Motion & Orientation Access, and hold the phone still briefly. |
| Test swing connects but ball does not launch | Wait for the laptop ball to be ready, then press the phone test button once. The hit window is intentionally generous; repeated clicks are rate-limited. |

The server is authoritative at 120 Hz and broadcasts state at 60 Hz.

## Manual balls, gentler swings, and camera position

Restart the server after pulling these changes and refresh both browsers. The court starts empty. Click **Spawn ball** on either device, then swing or press Space. After each shot, the ball clears and waits for another button press. Spawn requests travel over the seat-attributed WebSocket. Phones receive their assigned seat and shared state, while laptops receive the opponent’s pose.

Phone motion needs a 2.5g start and a 600ms quiet recovery. Pitch has less influence, upward launch speed is capped at 3.8m/s, and power saturates at 11m/s. These values live in `shared/config.js`. Tap **Use defaults** on the phone to clear an old personal calibration.

On the laptop, click **Enable camera**, allow access, and stand still with shoulders and hips visible for calibration. A circle in the court map shows your estimated location, a ground ring marks your feet, and the view follows the server's position estimate. **Recenter position** resets the calibration. If tracking is lost or disabled, the last position is held. Video is processed locally; only pose coordinates go to the relay. The phone still measures swings.

Position uses hip midpoint and shoulder size; depth is approximate and turning your body can affect it. This is not room-scale position measurement. The tracker uses the MediaPipe library already named in the design and its lite pose model, following the [official Web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js). The first camera start needs internet to load the CDN library/model.

## Live two-player setup

Run `npm start` on **one** MacBook. Both MacBooks and both phones must use that
server's HTTPS LAN address on the same Wi-Fi; do not start separate servers.

1. Open `/client-laptop/?seat=A` on the first MacBook.
2. Under **Play with a friend**, open the displayed link on the second MacBook.
   It assigns the opposite seat and its own first-person court view.
3. Each player opens the phone link displayed on **their own** MacBook. Its
   `seat=A` or `seat=B` pairs the phone with that player.
4. On both phones, enable motion and recenter with the screen facing that
   player's MacBook. Enable camera tracking on each MacBook to move around.
5. Check the device connection indicators, then spawn a ball and rally.

The host's local HTTPS certificate must be trusted on the joining devices.
Player B joining disables the practice bot for that server session, including
across temporary disconnects. Restarting the server starts a new session.
This setup supports a shared LAN; internet matchmaking/hosting is not included.
