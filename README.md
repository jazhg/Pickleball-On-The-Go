# Pickleball On The Go — Singles + Nemotron coaching

Play singles to **11, win by 2**, with traditional side-out scoring (only the server scores).
The relay owns the rules and ball at 120 Hz; both screens receive 60 Hz snapshots.

- **Serve:** request the ball, then swing your phone.
  Only the serving player can request or hit the serve. Virtual players move to the
  correct right/even or left/odd service positions, and a highlighted box shows the
  diagonal target. Tracking remains relative to that placement.
- **Camera movement:** enable camera tracking and move your body to position.
- **Paddle direction:** turn the phone face to aim left/right; recenter establishes
  neutral. Neutral serves are assisted diagonally. Rally shots preserve face bearing;
  loft assistance compensates for drag. Brushing motion adds mild, decaying sidespin.
- **Rules:** valid diagonal serves beyond the kitchen, two-bounce opening, kitchen
  volleys and simulated follow-through entry, second-bounce faults, out balls, and
  service foot position. Game over stays locked until **Play again**.
- **Solo:** Blue is a return bot and takes its own serves. Connecting a Blue human
  disables the bot for the session, including reconnects.
- **Practice:** unlimited unscored feeds. Some coaching decisions expose **Practice
  this cue**, which selects lateral-movement, low-feed, or slower-touch drills.

The game uses an assisted virtual underhand serve; phone IMU and camera tracking do
not prove real-world wrist, waist, foot, or balance compliance. Kitchen contacts use
an estimated player ground position and follow-through until the next contact.
Ball/line calls use a ball-radius approximation. This is a playable rules-based
simulation, not a certified human-match referee.
Rules reference: [USA Pickleball rules](https://usapickleball.org/rules/).

## Run

```sh
npm install
npm run dev:http                 # localhost rendering preview
# For phones, configure trusted HTTPS as described below, then:
npm start
```

To use live Nemotron, copy `.env.example` to `.env`, set `NVIDIA_API_KEY`, and keep
`NEMOTRON_LIVE=1`. npm start/dev load `.env` automatically; it is gitignored and never
served as a public asset. No API key was available for this implementation session,
so **live-model behavior has not been verified**.

## Where Nemotron fits

The pipeline is **rally events → deterministic ruling → Nemotron cue selection →
validated coaching card / practice drill**. The existing shot classifier and sparse
recorded-commentary selector remain connected. The coaching decision uses NVIDIA's
[Nemotron 3.5 Lightning](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/modelcard)
through the existing Python NVIDIA adapter.

Nemotron selects an eligible cue and cites an event index. It cannot invent a score,
fault, or executable action. The relay commits the result immediately; model work
runs asynchronously with an 8-second request timeout and 9-second process deadline.
Only one coaching job runs at a time; a newer completed rally invalidates its result.
The interface explicitly labels live, baseline, and fallback paths. The old
rulebook-review-gated referee remains available for its standalone evaluations,
but it no longer controls match scoring.

See [HACKATHON.md](HACKATHON.md) for the demo, architecture, evidence, and limitations.

## Verification

```sh
npm run test:all                 # Node tests + Python Nemotron tests
node scripts/generate-coach-fixtures.js
python3 nemotron/eval_coach.py --output nemotron/coach-eval-offline.json
# With NVIDIA_API_KEY exported (Python does not load .env automatically):
python3 nemotron/eval_coach.py --live --output nemotron/coach-eval-live.json
node scripts/benchmark-gameplay.js
```

The committed coaching evaluation is **offline, 7/8 synthetic cases, zero human
reviewed**. It records a baseline failure on deep vs wide misses. Mock response tests
verify valid decisions, malformed outputs, invented score fields, invalid evidence,
and network failure. They do not establish live model quality.

Graphics retain the existing arena style while batching 382 static seats into three
instanced draws, capping pixel ratio at 1.5 and shadows at 1024, and interpolating ball
snapshots with a 35 ms buffer. CPU microbenchmarks are reproducible with the command
above; they are not GPU frame-rate or device-latency measurements.

---

The following setup notes describe the original controller/tracking integration.
Current match behavior is described above.


# Pickleball On The Go — Milestone 1

The relay owns the ball simulation. The laptop renders the relay’s state, and the phone sends the fixed section-3 `swing` message. The fastest way to check the connection is the phone page’s **Send test swing** button; it does not need motion permission and should launch the ball on the laptop.

## First run on one laptop

From this folder:

```sh
npm install
npm run dev:http
```

Open [http://localhost:8443/client-laptop/](http://localhost:8443/client-laptop/) to preview the court. Live play uses camera tracking and a phone connected over HTTPS. It is useful for verifying the game and does not make the server reachable from a phone.

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

Restart the server after pulling these changes and refresh both browsers. The court starts empty. Click **Spawn ball** on either device, then swing your phone. After each shot, the ball clears and waits for another button press. Spawn requests travel over the seat-attributed WebSocket. Phones receive their assigned seat and shared state, while laptops receive the opponent’s pose.

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
